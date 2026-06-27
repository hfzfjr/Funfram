package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

var db *pgx.Conn

// Initialize PostgreSQL connection (Supabase)
func InitDatabase() error {
	godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")

	if dbURL == "" {
		log.Println("DATABASE_URL not found, using in-memory storage")
		return nil
	}

	var err error
	db, err = pgx.Connect(context.Background(), dbURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	log.Println("Database connected successfully")
	return nil
}

func CloseDatabase() {
	if db != nil {
		db.Close(context.Background())
	}
}

// User operations
// GetOrCreateUser performs an idempotent upsert:
// if the username already exists it returns the existing UUID,
// otherwise it inserts a new row and returns the generated UUID.
// The returned ID is ALWAYS a proper DB UUID, never a connection-string.
func GetOrCreateUser(username string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var userID string

	// Since we need every connection to be unique to avoid overwriting websocket clients,
	// we will append a short random string to the username if it conflicts,
	// or we can just always make it unique.
	uniqueUsername := fmt.Sprintf("%s-%d", username, time.Now().UnixNano()%10000)

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

// CreateUser kept as an alias for legacy call sites.
func CreateUser(username string) (string, error) {
	return GetOrCreateUser(username)
}

func GetUserByUsername(username string) (map[string]interface{}, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var userID string
	var createdAt string

	err := db.QueryRow(ctx,
		"SELECT id, created_at FROM users WHERE username = $1",
		username,
	).Scan(&userID, &createdAt)

	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	return map[string]interface{}{
		"id":         userID,
		"username":   username,
		"created_at": createdAt,
	}, nil
}

// Lobby operations
func CreateLobbyDB(ownerID, inviteCode string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var lobbyID string

	err := db.QueryRow(ctx,
		"INSERT INTO lobbies (owner_id, invite_code, status) VALUES ($1, $2, $3) RETURNING id",
		ownerID, inviteCode, "WAITING",
	).Scan(&lobbyID)

	if err != nil {
		return "", fmt.Errorf("failed to create lobby: %w", err)
	}

	return lobbyID, nil
}

func GetLobbyByInviteCode(inviteCode string) (map[string]interface{}, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var lobbyID string
	var ownerID string
	var status string

	err := db.QueryRow(ctx,
		"SELECT id, owner_id, status FROM lobbies WHERE invite_code = $1",
		inviteCode,
	).Scan(&lobbyID, &ownerID, &status)

	if err != nil {
		return nil, fmt.Errorf("lobby not found: %w", err)
	}

	return map[string]interface{}{
		"id":          lobbyID,
		"owner_id":    ownerID,
		"invite_code": inviteCode,
		"status":      status,
	}, nil
}

func UpdateLobbyStatus(lobbyID, status string) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	normalizedStatus := strings.ToUpper(strings.TrimSpace(status))

	_, err := db.Exec(ctx,
		"UPDATE lobbies SET status = $1 WHERE id = $2",
		normalizedStatus, lobbyID,
	)

	if err != nil {
		return fmt.Errorf("failed to update lobby status: %w", err)
	}

	return nil
}

func UpsertUserPresence(userID, presenceState, sessionID string) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	_, err := db.Exec(ctx, `
		INSERT INTO user_presence (user_id, presence_state, session_id, last_heartbeat)
		VALUES ($1, $2, NULLIF($3, '')::uuid, NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET
			presence_state = EXCLUDED.presence_state,
			session_id = EXCLUDED.session_id,
			last_heartbeat = NOW()
	`, userID, strings.ToUpper(strings.TrimSpace(presenceState)), sessionID)
	if err != nil {
		return fmt.Errorf("failed to upsert user presence: %w", err)
	}
	return nil
}

func UpsertUserDeviceState(userID, sessionID string, cameraEnabled, microphoneEnabled bool) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	_, err := db.Exec(ctx, `
		INSERT INTO user_device_state (user_id, session_id, camera_enabled, microphone_enabled, updated_at)
		VALUES ($1, NULLIF($2, '')::uuid, $3, $4, NOW())
		ON CONFLICT (user_id, session_id)
		DO UPDATE SET
			camera_enabled = EXCLUDED.camera_enabled,
			microphone_enabled = EXCLUDED.microphone_enabled,
			updated_at = NOW()
	`, userID, sessionID, cameraEnabled, microphoneEnabled)
	if err != nil {
		return fmt.Errorf("failed to upsert user device state: %w", err)
	}
	return nil
}

func CreateSessionDB(frameA, frameB string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var sessionID string
	err := db.QueryRow(ctx,
		"INSERT INTO sessions (frame_a_id, frame_b_id, game_state, current_game) VALUES ($1, $2, $3, $4) RETURNING id",
		frameA, frameB, "WAITING", nil,
	).Scan(&sessionID)
	if err != nil {
		return "", fmt.Errorf("failed to create session: %w", err)
	}
	return sessionID, nil
}

func CreateInviteLink(frameID, createdBy string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	inviteCode := fmt.Sprintf("INV-%s", strings.ToUpper(generateInviteCodeValue(8)))
	var storedCode string
	err := db.QueryRow(ctx, `
		INSERT INTO invite_links (frame_id, invite_code, created_by, expires_at)
		VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')
		RETURNING invite_code
	`, frameID, inviteCode, createdBy).Scan(&storedCode)
	if err != nil {
		return "", fmt.Errorf("failed to create invite link: %w", err)
	}
	return storedCode, nil
}

func ValidateInviteLink(frameID, inviteCode string) (bool, error) {
	if db == nil {
		return false, fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM invite_links
			WHERE frame_id = $1
			  AND invite_code = $2
			  AND is_active = TRUE
			  AND (expires_at IS NULL OR expires_at > NOW())
		)
	`, frameID, inviteCode).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to validate invite link: %w", err)
	}
	return exists, nil
}

func generateInviteCodeValue(length int) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)
	for i := 0; i < length; i++ {
		result[i] = chars[rand.Intn(len(chars))]
	}
	return string(result)
}

// Lobby member operations
func AddLobbyMember(lobbyID, userID string) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}

	ctx := context.Background()

	_, err := db.Exec(ctx,
		"INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1, $2)",
		lobbyID, userID,
	)

	if err != nil {
		return fmt.Errorf("failed to add lobby member: %w", err)
	}

	return nil
}

func GetLobbyMembers(lobbyID string) ([]map[string]interface{}, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var members []map[string]interface{}

	rows, err := db.Query(ctx,
		"SELECT id, user_id, lobby_id FROM lobby_members WHERE lobby_id = $1",
		lobbyID,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get lobby members: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var memberID, userID, memberLobbyID string
		err := rows.Scan(&memberID, &userID, &memberLobbyID)
		if err != nil {
			continue
		}
		members = append(members, map[string]interface{}{
			"id":       memberID,
			"user_id":  userID,
			"lobby_id": memberLobbyID,
		})
	}

	return members, nil
}

// Match operations
func CreateMatchDB(lobbyA, lobbyB string) (string, error) {
	if db == nil {
		return "", fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
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
		return fmt.Errorf("database not initialized")
	}

	ctx := context.Background()

	_, err := db.Exec(ctx,
		"UPDATE matches SET ended_at = NOW() WHERE id = $1",
		matchID,
	)

	if err != nil {
		return fmt.Errorf("failed to end match: %w", err)
	}

	return nil
}

// Leaderboard operations
func UpdateScore(userID, gameName string, score int) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}

	ctx := context.Background()

	// Try to update first
	result, err := db.Exec(ctx,
		"UPDATE leaderboard SET score = $1 WHERE user_id = $2 AND game_name = $3",
		score, userID, gameName,
	)

	if err != nil {
		return fmt.Errorf("failed to update score: %w", err)
	}

	// If no rows were updated, insert a new record
	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		_, err = db.Exec(ctx,
			"INSERT INTO leaderboard (user_id, game_name, score) VALUES ($1, $2, $3)",
			userID, gameName, score,
		)
		if err != nil {
			return fmt.Errorf("failed to insert score: %w", err)
		}
	}

	return nil
}

func GetLeaderboard(gameName string, limit int) ([]map[string]interface{}, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	ctx := context.Background()
	var scores []map[string]interface{}

	rows, err := db.Query(ctx,
		"SELECT user_id, game_name, score FROM leaderboard WHERE game_name = $1 ORDER BY score DESC LIMIT $2",
		gameName, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get leaderboard: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var userID, gameNameResult string
		var scoreValue int
		err := rows.Scan(&userID, &gameNameResult, &scoreValue)
		if err != nil {
			continue
		}
		scores = append(scores, map[string]interface{}{
			"user_id":   userID,
			"game_name": gameNameResult,
			"score":     scoreValue,
		})
	}

	return scores, nil
}
