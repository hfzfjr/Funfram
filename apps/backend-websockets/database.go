package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

var db *pgxpool.Pool

const dbQueryTimeout = 3 * time.Second

func isValidUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

func InitDatabase() error {
	_ = godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Info("DATABASE_URL not set; running in memory-only mode")
		return nil
	}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return fmt.Errorf("failed to parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 25
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	db, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	if err := db.Ping(ctx); err != nil {
		db.Close()
		db = nil
		return fmt.Errorf("failed to ping database: %w", err)
	}

	if err := ensureSchema(ctx); err != nil {
		slog.Warn("Schema initialization warning", "error", err)
	}

	slog.Info("Database connected successfully")
	return nil
}

func ensureSchema(ctx context.Context) error {
	if db == nil {
		return nil
	}

	schemaSQL := `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lobbies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    invite_code VARCHAR(10) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    is_owner_frame BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lobby_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(lobby_id, user_id)
);

CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lobby_a UUID REFERENCES lobbies(id) ON DELETE SET NULL,
    lobby_b UUID REFERENCES lobbies(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS leaderboard (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game_name VARCHAR(50) NOT NULL,
    score INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, game_name)
);

CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    presence_state VARCHAR(16) CHECK (presence_state IN ('ONLINE', 'MATCHING', 'PLAYING', 'DRAWING', 'GUESSING', 'RECONNECTING', 'IDLE', 'OFFLINE')),
    session_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_device_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    camera_enabled BOOLEAN DEFAULT TRUE,
    microphone_enabled BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);

CREATE TABLE IF NOT EXISTS invite_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    frame_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    invite_code VARCHAR(32) UNIQUE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    times_used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    reason VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ip_hash VARCHAR(64),
    device_hash VARCHAR(64),
    reason VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);`

	_, err := db.Exec(ctx, schemaSQL)
	return err
}

func CloseDatabase() {
	if db != nil {
		db.Close()
	}
}

func GetOrCreateUser(username string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	runes := []rune(username)
	if len(runes) > 40 {
		runes = runes[:40]
	}
	suffix := generateTempID()[:6]
	uniqueUsername := fmt.Sprintf("%s-%s", string(runes), suffix)

	var userID string
	err := db.QueryRow(ctx,
		`INSERT INTO users (username) VALUES ($1)
		 ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
		 RETURNING id`,
		uniqueUsername,
	).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("failed to get or create user: %w", err)
	}
	return userID, nil
}

func CreateLobbyDB(ownerID, inviteCode string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}
	if !isValidUUID(ownerID) {
		return "", fmt.Errorf("invalid ownerID UUID")
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	var lobbyID string
	err := db.QueryRow(ctx,
		"INSERT INTO lobbies (owner_id, invite_code, status) VALUES ($1, $2, 'WAITING') RETURNING id",
		ownerID, inviteCode,
	).Scan(&lobbyID)
	if err != nil {
		return "", fmt.Errorf("failed to create lobby: %w", err)
	}
	return lobbyID, nil
}

func AddLobbyMember(lobbyID, userID string) error {
	if db == nil {
		return nil
	}
	if !isValidUUID(lobbyID) || !isValidUUID(userID) {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	_, err := db.Exec(ctx,
		"INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		lobbyID, userID,
	)
	return err
}

func UpdateLobbyStatus(lobbyID, status string) error {
	if db == nil {
		return nil
	}
	if !isValidUUID(lobbyID) {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	_, err := db.Exec(ctx,
		"UPDATE lobbies SET status = $1, updated_at = NOW() WHERE id = $2",
		status, lobbyID,
	)
	return err
}

func CreateMatchDB(lobbyA, lobbyB string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}
	if !isValidUUID(lobbyA) || !isValidUUID(lobbyB) {
		return "", fmt.Errorf("invalid lobby UUID")
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	var matchID string
	err := db.QueryRow(ctx,
		"INSERT INTO matches (lobby_a, lobby_b) VALUES ($1, $2) RETURNING id",
		lobbyA, lobbyB,
	).Scan(&matchID)
	if err != nil {
		return "", fmt.Errorf("failed to create match: %w", err)
	}
	return matchID, nil
}

func EndMatchDB(matchID string) error {
	if db == nil {
		return nil
	}
	if !isValidUUID(matchID) {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	_, err := db.Exec(ctx,
		"UPDATE matches SET ended_at = NOW() WHERE id = $1",
		matchID,
	)
	return err
}

func UpsertUserPresence(userID, presenceState, sessionID string) error {
	if db == nil || !isValidUUID(userID) {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	var sessionVal interface{}
	if isValidUUID(sessionID) {
		sessionVal = sessionID
	}

	_, err := db.Exec(ctx,
		`INSERT INTO user_presence (user_id, presence_state, session_id, last_heartbeat)
		 VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (user_id)
		 DO UPDATE SET presence_state = EXCLUDED.presence_state,
		               session_id = EXCLUDED.session_id,
		               last_heartbeat = NOW()`,
		userID, presenceState, sessionVal,
	)
	return err
}

func UpsertUserDeviceState(userID, sessionID string, cameraEnabled, microphoneEnabled bool) error {
	if db == nil || !isValidUUID(userID) {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	var sessionVal interface{}
	if isValidUUID(sessionID) {
		sessionVal = sessionID
	}

	_, err := db.Exec(ctx,
		`INSERT INTO user_device_state (user_id, session_id, camera_enabled, microphone_enabled, updated_at)
		 VALUES ($1, $2, $3, $4, NOW())
		 ON CONFLICT (user_id, session_id)
		 DO UPDATE SET camera_enabled = EXCLUDED.camera_enabled,
		               microphone_enabled = EXCLUDED.microphone_enabled,
		               updated_at = NOW()`,
		userID, sessionVal, cameraEnabled, microphoneEnabled,
	)
	return err
}

func UpdateScore(userID, gameName string, deltaScore int) error {
	if db == nil || !isValidUUID(userID) || deltaScore <= 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	_, err := db.Exec(ctx,
		`INSERT INTO leaderboard (user_id, game_name, score)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, game_name)
		 DO UPDATE SET score = leaderboard.score + EXCLUDED.score, updated_at = NOW()`,
		userID, gameName, deltaScore,
	)
	return err
}

func CreateInviteLinkDB(frameID, inviteCode, createdBy string, expiresAt time.Time) error {
	if db == nil || !isValidUUID(frameID) || !isValidUUID(createdBy) {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	_, err := db.Exec(ctx,
		`INSERT INTO invite_links (frame_id, invite_code, created_by, expires_at, is_active)
		 VALUES ($1, $2, $3, $4, TRUE)`,
		frameID, inviteCode, createdBy, expiresAt,
	)
	return err
}

func ValidateAndUseInviteLinkDB(inviteCode string) (string, bool, error) {
	if db == nil {
		return "", false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), dbQueryTimeout)
	defer cancel()

	var frameID string
	err := db.QueryRow(ctx,
		`UPDATE invite_links
		 SET times_used = times_used + 1
		 WHERE invite_code = $1
		   AND is_active = TRUE
		   AND (expires_at IS NULL OR expires_at > NOW())
		 RETURNING frame_id`,
		inviteCode,
	).Scan(&frameID)
	if err != nil {
		return "", false, err
	}
	return frameID, true, nil
}
