package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"
)

func generateInviteCode12() string {
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func CreateSignedInvite(frameID, ownerID string) (inviteCode string, inviteToken string, expiresAt int64, err error) {
	inviteCode = generateInviteCode12()
	ttl := 15 * time.Minute
	expiresAt = time.Now().Add(ttl).Unix()
	inviteToken, err = SignRoomToken(ownerID, frameID, "invite", ttl)
	if err != nil {
		return "", "", 0, err
	}
	if db != nil {
		go func(fID, code, cBy string, exp time.Time) {
			_ = CreateInviteLinkDB(fID, code, cBy, exp)
		}(frameID, inviteCode, ownerID, time.Unix(expiresAt, 0))
	}
	return inviteCode, inviteToken, expiresAt, nil
}

func handleVerifyInviteHTTP(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		token := r.URL.Query().Get("token")
		if token == "" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": "missing token"})
			return
		}
		claims, err := VerifyRoomToken(token, "invite")
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": err.Error()})
			return
		}

		hub.mu.RLock()
		lobby, exists := hub.lobbies[claims.Room]
		active := exists && lobby.Status == "WAITING" && len(lobby.Members) < 2
		hub.mu.RUnlock()

		if !active {
			w.WriteHeader(http.StatusGone)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": "frame unavailable or full"})
			return
		}

		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"valid":     true,
			"frameId":   claims.Room,
			"expiresAt": claims.Exp,
		})
	}
}
