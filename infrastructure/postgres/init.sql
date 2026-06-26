-- Funfram.com Database Schema for Supabase
-- This file contains all tables and initial setup for the application

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lobbies table
CREATE TABLE IF NOT EXISTS lobbies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    invite_code VARCHAR(10) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    is_owner_frame BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lobby members table
CREATE TABLE IF NOT EXISTS lobby_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(lobby_id, user_id)
);

-- Matches table
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lobby_a UUID REFERENCES lobbies(id) ON DELETE SET NULL,
    lobby_b UUID REFERENCES lobbies(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE
);

-- Leaderboard table
CREATE TABLE IF NOT EXISTS leaderboard (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    game_name VARCHAR(50) NOT NULL,
    score INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, game_name)
);

-- User presence tracking
CREATE TABLE IF NOT EXISTS user_presence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    presence_state VARCHAR(16) CHECK (presence_state IN ('ONLINE', 'MATCHING', 'PLAYING', 'IDLE', 'OFFLINE')),
    session_id UUID REFERENCES matches(id),
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Active sessions for matched frames
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    frame_a_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    frame_b_id UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    game_state VARCHAR(20) DEFAULT 'WAITING',
    current_game VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device state tracking per session
CREATE TABLE IF NOT EXISTS user_device_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    camera_enabled BOOLEAN DEFAULT TRUE,
    microphone_enabled BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);

-- Invite links for shared frames
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

-- Create indexes for better performance
CREATE INDEX idx_lobbies_invite_code ON lobbies(invite_code);
CREATE INDEX idx_lobbies_status ON lobbies(status);
CREATE INDEX idx_lobbies_updated_at ON lobbies(updated_at DESC);
CREATE INDEX idx_lobby_members_lobby_id ON lobby_members(lobby_id);
CREATE INDEX idx_lobby_members_user_id ON lobby_members(user_id);
CREATE INDEX idx_matches_created_at ON matches(created_at);
CREATE INDEX idx_leaderboard_user_id ON leaderboard(user_id);
CREATE INDEX idx_leaderboard_game_name ON leaderboard(game_name);
CREATE INDEX idx_leaderboard_score ON leaderboard(score DESC);
CREATE INDEX idx_user_presence_state ON user_presence(presence_state);
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_user_device_state_session ON user_device_state(session_id);
CREATE INDEX idx_invite_links_code ON invite_links(invite_code);

-- Function to update updated_at timestamp on leaderboard
CREATE OR REPLACE FUNCTION update_leaderboard_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update lobby updated_at
CREATE OR REPLACE FUNCTION update_lobbies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_leaderboard_updated_at
    BEFORE UPDATE ON leaderboard
    FOR EACH ROW
    EXECUTE FUNCTION update_leaderboard_updated_at();

CREATE TRIGGER trigger_update_lobbies_updated_at
    BEFORE UPDATE ON lobbies
    FOR EACH ROW
    EXECUTE FUNCTION update_lobbies_updated_at();

-- Function to generate unique invite code
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS VARCHAR(10) AS $$
DECLARE
    chars VARCHAR(36) := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result VARCHAR(10) := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || SUBSTRING(chars, FLOOR(RANDOM() * LENGTH(chars))::INTEGER + 1, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Keep legacy lowercase data compatible with the new enum-like status model.
UPDATE lobbies SET status = UPPER(status) WHERE status IS NOT NULL;
ALTER TABLE lobbies DROP CONSTRAINT IF EXISTS lobbies_status_check;
ALTER TABLE lobbies ADD CONSTRAINT lobbies_status_check
  CHECK (status IN ('WAITING', 'MATCHING', 'MATCHED', 'PLAYING', 'CLOSED'));

-- Insert sample data for testing (optional)
-- Uncomment to add sample data
/*
INSERT INTO users (username) VALUES 
    ('user1'),
    ('user2'),
    ('user3');

INSERT INTO lobbies (owner_id, invite_code, status) 
SELECT id, generate_invite_code(), 'waiting' FROM users LIMIT 2;
*/
