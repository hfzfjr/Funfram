package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

type RoomTokenClaims struct {
	Sub   string `json:"sub"`
	Room  string `json:"room"`
	Scope string `json:"scope"`
	Jti   string `json:"jti"`
	Exp   int64  `json:"exp"`
}

var (
	ephemeralSecretOnce sync.Once
	ephemeralSecret     []byte
)

func getDevFallbackSecret() []byte {
	ephemeralSecretOnce.Do(func() {
		appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		if appEnv == "production" {
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				panic("crypto/rand failed: " + err.Error())
			}
			ephemeralSecret = b
			slog.Error("HMAC secret env var is missing in production; cross-service tokens will fail")
			return
		}
		ephemeralSecret = []byte("funfram-dev-only-secret-do-not-use-in-prod")
		slog.Warn("HMAC secret env var not set; using shared development-only secret")
	})
	return ephemeralSecret
}

func getSecretForScope(scope string) []byte {
	switch scope {
	case "turn":
		if v := strings.TrimSpace(os.Getenv("TURN_TOKEN_HMAC_SECRET")); v != "" {
			return []byte(v)
		}
		if v := strings.TrimSpace(os.Getenv("SIGNALING_HMAC_SECRET")); v != "" {
			return []byte(v)
		}
	case "signaling":
		if v := strings.TrimSpace(os.Getenv("SIGNALING_HMAC_SECRET")); v != "" {
			return []byte(v)
		}
		if v := strings.TrimSpace(os.Getenv("TURN_TOKEN_HMAC_SECRET")); v != "" {
			return []byte(v)
		}
	case "invite":
		if v := strings.TrimSpace(os.Getenv("INVITE_HMAC_SECRET")); v != "" {
			return []byte(v)
		}
		if v := strings.TrimSpace(os.Getenv("SIGNALING_HMAC_SECRET")); v != "" {
			return []byte(v)
		}
	}
	return getDevFallbackSecret()
}

func GenerateSessionToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return generateTempID() + generateTempID()
	}
	return hex.EncodeToString(b)
}

func generateJTI() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func ConstantTimeEqual(a, b string) bool {
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func SignRoomToken(userID, roomID, scope string, ttl time.Duration) (string, error) {
	if userID == "" || roomID == "" || scope == "" {
		return "", errors.New("missing token claims")
	}
	claims := RoomTokenClaims{
		Sub:   userID,
		Room:  roomID,
		Scope: scope,
		Jti:   generateJTI(),
		Exp:   time.Now().Add(ttl).Unix(),
	}
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	secret := getSecretForScope(scope)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(encodedPayload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encodedPayload + "." + sig, nil
}

func VerifyRoomToken(token, expectedScope string) (*RoomTokenClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, errors.New("malformed token")
	}
	encodedPayload, encodedSig := parts[0], parts[1]
	secret := getSecretForScope(expectedScope)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(encodedPayload))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !ConstantTimeEqual(encodedSig, expectedSig) {
		return nil, errors.New("invalid token signature")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(encodedPayload)
	if err != nil {
		return nil, errors.New("invalid token encoding")
	}
	var claims RoomTokenClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, errors.New("invalid token claims")
	}
	if claims.Scope != expectedScope {
		return nil, errors.New("invalid token scope")
	}
	if time.Now().Unix() > claims.Exp {
		return nil, errors.New("token expired")
	}
	return &claims, nil
}
