package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRoomTokenSignAndVerify(t *testing.T) {
	t.Setenv("SIGNALING_HMAC_SECRET", "test-signaling-secret-32-bytes!!")
	t.Setenv("TURN_TOKEN_HMAC_SECRET", "test-turn-secret-32-bytes!!!!!!!")

	tok, err := SignRoomToken("user-1", "room-abc", "signaling", 5*time.Minute)
	if err != nil {
		t.Fatalf("SignRoomToken failed: %v", err)
	}
	claims, err := VerifyRoomToken(tok, "signaling")
	if err != nil {
		t.Fatalf("VerifyRoomToken failed: %v", err)
	}
	if claims.Sub != "user-1" || claims.Room != "room-abc" {
		t.Fatalf("unexpected claims: %+v", claims)
	}

	if _, err := VerifyRoomToken(tok, "turn"); err == nil {
		t.Fatal("expected scope mismatch error for turn")
	}

	expiredTok, err := SignRoomToken("user-1", "room-abc", "signaling", -1*time.Minute)
	if err != nil {
		t.Fatalf("SignRoomToken expired failed: %v", err)
	}
	if _, err := VerifyRoomToken(expiredTok, "signaling"); err == nil {
		t.Fatal("expected expired token error")
	}
}

func TestTrimLowerAndWordHint(t *testing.T) {
	if trimLower("Es Krim") != trimLower("  es   krim! ") {
		t.Fatalf("expected Es Krim to match, got %q vs %q", trimLower("Es Krim"), trimLower("  es   krim! "))
	}
	if trimLower("") != "" || trimLower("!!!") != "" {
		t.Fatal("expected empty normalized string")
	}
	if trimLower("e!s#123k") == trimLower("Es Krim") {
		t.Fatal("expected garbage input not to match Es Krim")
	}
	hint := buildWordHint("Es Krim")
	if !strings.Contains(hint, " ") {
		t.Fatalf("expected space preserved in hint, got %q", hint)
	}
}

func TestCheckWSOrigin(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("ALLOWED_ORIGINS", "https://funfram.id")

	reqGood := httptest.NewRequest(http.MethodGet, "/socket", nil)
	reqGood.Header.Set("Origin", "https://funfram.id")
	if !CheckWSOrigin(reqGood) {
		t.Fatal("expected allowed origin to pass")
	}

	reqEvil := httptest.NewRequest(http.MethodGet, "/socket", nil)
	reqEvil.Header.Set("Origin", "https://evil.example.com")
	if CheckWSOrigin(reqEvil) {
		t.Fatal("expected foreign origin to fail in production")
	}

	// Sibling subdomain fallback when ALLOWED_ORIGINS is unset
	t.Setenv("ALLOWED_ORIGINS", "")
	reqSibling := httptest.NewRequest(http.MethodGet, "/socket", nil)
	reqSibling.Host = "funfram-socket.roomify.space"
	reqSibling.Header.Set("Origin", "https://funfram.roomify.space")
	if !CheckWSOrigin(reqSibling) {
		t.Fatal("expected sibling subdomain over https to pass when ALLOWED_ORIGINS is empty")
	}

	reqForeign := httptest.NewRequest(http.MethodGet, "/socket", nil)
	reqForeign.Host = "funfram-socket.roomify.space"
	reqForeign.Header.Set("Origin", "https://evil.attacker.com")
	if CheckWSOrigin(reqForeign) {
		t.Fatal("expected different parent domain to fail")
	}
}

func TestRejoinSessionRejectsHijackAndRepeatedCreate(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("SIGNALING_HMAC_SECRET", "test-secret")
	hub := NewHub()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		handleConnections(hub, ws)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	c1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial c1: %v", err)
	}
	defer c1.Close()

	// Drain initial ONLINE_COUNT
	var initMsg map[string]interface{}
	if err := c1.ReadJSON(&initMsg); err != nil {
		t.Fatalf("read init: %v", err)
	}

	// Create frame 3 times sequentially -> should leave exactly 1 lobby
	var frameID, ownerID string
	for i := 0; i < 3; i++ {
		if err := c1.WriteJSON(map[string]interface{}{
			"event":   "FRAME_CREATE",
			"payload": map[string]string{"username": "Budi"},
		}); err != nil {
			t.Fatalf("write FRAME_CREATE: %v", err)
		}
		for {
			var resp struct {
				Event   string                 `json:"event"`
				Payload map[string]interface{} `json:"payload"`
			}
			if err := c1.ReadJSON(&resp); err != nil {
				t.Fatalf("read FRAME_CREATED: %v", err)
			}
			if resp.Event == "FRAME_CREATED" {
				frameID, _ = resp.Payload["frameId"].(string)
				ownerID, _ = resp.Payload["ownerId"].(string)
				if tok, _ := resp.Payload["sessionToken"].(string); tok == "" {
					t.Fatal("expected non-empty sessionToken in FRAME_CREATED")
				}
				break
			}
		}
	}

	hub.mu.RLock()
	lobbyCount := len(hub.lobbies)
	hub.mu.RUnlock()
	if lobbyCount != 1 {
		t.Fatalf("expected 1 lobby after repeated FRAME_CREATE, got %d", lobbyCount)
	}

	// Attacker tries to hijack c1's active session without valid sessionToken
	c2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial c2: %v", err)
	}
	defer c2.Close()

	_ = c2.ReadJSON(&initMsg)
	if err := c2.WriteJSON(map[string]interface{}{
		"event": "REJOIN_SESSION",
		"payload": map[string]string{
			"userId":       ownerID,
			"frameId":      frameID,
			"sessionToken": "forged-token",
		},
	}); err != nil {
		t.Fatalf("write REJOIN_SESSION: %v", err)
	}

	var hijackResp struct {
		Event   string          `json:"event"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := c2.ReadJSON(&hijackResp); err != nil {
		t.Fatalf("read hijack response: %v", err)
	}
	if hijackResp.Event != "REJOIN_FAILED" {
		t.Fatalf("expected REJOIN_FAILED, got %s", hijackResp.Event)
	}
}

func TestAuthoritativeBoardGamesAndIdleJanitor(t *testing.T) {
	hub := NewHub()
	lA := hub.CreateLobby("owner-a", "Ayu")
	lB := hub.CreateLobby("owner-b", "Budi")
	cA := NewClient(nil, "owner-a")
	cB := NewClient(nil, "owner-b")
	if err := hub.JoinLobby(lA.ID, "owner-a", "Ayu", cA); err != nil {
		t.Fatal(err)
	}
	if err := hub.JoinLobby(lB.ID, "owner-b", "Budi", cB); err != nil {
		t.Fatal(err)
	}

	// Test idle janitor
	lIdle := hub.CreateLobby("owner-idle", "Idle")
	cIdle := NewClient(nil, "owner-idle")
	_ = hub.JoinLobby(lIdle.ID, "owner-idle", "Idle", cIdle)
	hub.mu.Lock()
	lIdle.LastActivity = time.Now().Add(-10 * time.Minute)
	hub.mu.Unlock()
	reapIdleLobbies(hub, 5*time.Minute)
	hub.mu.RLock()
	if _, stillExists := hub.lobbies[lIdle.ID]; stillExists {
		hub.mu.RUnlock()
		t.Fatal("expected idle lobby to be reaped")
	}
	hub.mu.RUnlock()

	// Setup match for board games
	hub.mu.Lock()
	matchID := "match-test-1"
	hub.matches[matchID] = &Match{ID: matchID, LobbyA: lA, LobbyB: lB, CreatedAt: time.Now()}
	hub.lobbyToMatch[lA.ID] = matchID
	hub.lobbyToMatch[lB.ID] = matchID
	hub.mu.Unlock()

	// Chess: Frame B tries to move on Frame A's turn -> rejected
	StartChessServer(hub, matchID)
	HandleChessAction(hub, matchID, lB.ID, map[string]interface{}{
		"action": "MOVE", "fromRow": float64(1), "fromCol": float64(0), "toRow": float64(2), "toCol": float64(0),
	})
	boardGames.mu.Lock()
	if boardGames.chess[matchID].Turn != "w" {
		boardGames.mu.Unlock()
		t.Fatal("expected turn to remain white when black tries out-of-turn move")
	}
	boardGames.mu.Unlock()

	// Drain previous chess messages before UNO test
	for len(cA.sendCh) > 0 {
		<-cA.sendCh
	}

	// UNO: verify filtered payload hides opponent cards & deck
	StartUnoServer(hub, matchID)
	select {
	case raw := <-cA.sendCh:
		var msg map[string]interface{}
		_ = json.Unmarshal(raw, &msg)
		payload := msg["payload"].(map[string]interface{})
		st := payload["state"].(map[string]interface{})
		if _, hasDeck := st["deck"]; hasDeck {
			t.Fatal("UNO payload must not expose deck")
		}
		if _, hasHands := st["hands"]; hasHands {
			t.Fatal("UNO payload must not expose all hands")
		}
		if _, hasMyHand := st["myHand"]; !hasMyHand {
			t.Fatal("UNO payload must include myHand")
		}
	default:
		t.Fatal("expected UNO initial state delivery to client A")
	}
}
