package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// Upgrader dideklarasikan di sini agar bisa diakses semua file dalam package main
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WSMessage struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

type FrameCreatePayload struct {
	Username string `json:"username"`
}

type PlayerJoinPayload struct {
	FrameID  string `json:"frameId"`
	Username string `json:"username"`
}

type SearchStartPayload struct {
	FrameID string `json:"frameId"`
}

type FrameNextPayload struct {
	FrameID   string `json:"frameId"`
	SessionID string `json:"sessionId"`
}

type GameInvitePayload struct {
	SessionID string `json:"sessionId"`
	GameType  string `json:"gameType"`
}

type GameAcceptPayload struct {
	SessionID string `json:"sessionId"`
}

type GameDeclinePayload struct {
	SessionID string `json:"sessionId"`
}

type GuessSubmitPayload struct {
	SessionID string `json:"sessionId"`
	PlayerID  string `json:"playerId"`
	GuessText string `json:"guessText"`
}

type MuteUserPayload struct {
	TargetUserID string `json:"targetUserId"`
	IsMuted      bool   `json:"isMuted"`
}

type ReportUserPayload struct {
	TargetUserID string `json:"targetUserId"`
	Reason       string `json:"reason"`
}

type ChatMessagePayload struct {
	Text string `json:"text"`
}

// generateTempID returns a UUID v4-formatted string using crypto/rand.
// Used when the DB is unavailable so no non-UUID strings enter UUID columns on reconnect.
func generateTempID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant bits
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

func handleConnections(hub *Hub, ws *websocket.Conn) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("❌ PANIC in handleConnections: %v\n", r)
		}
	}()

	// Membuat client baru sementara
	userID := fmt.Sprintf("user-%d", time.Now().UnixNano())
	client := &Client{
		Conn:      ws,
		ID:        userID,
		LobbyID:   "",
		Username:  "",
		Presence:  "OFFLINE",
		JoinOrder: 0,
	}

	fmt.Printf("✅ New WebSocket connection: %s from %s\n", userID, ws.RemoteAddr())

	defer func() {
		var otherLobbyID string
		hub.mu.Lock()
		lobbyID := client.LobbyID
		userID := client.ID

		// If matched, cleanup match
		var activeMatchID string
		for mID, match := range hub.matches {
			if match.LobbyA.ID == lobbyID || match.LobbyB.ID == lobbyID {
				activeMatchID = mID
				break
			}
		}
		if activeMatchID != "" {
			match := hub.matches[activeMatchID]
			otherLobby := match.LobbyA
			if otherLobby.ID == lobbyID {
				otherLobby = match.LobbyB
			}
			delete(hub.matches, activeMatchID)

			// Stop game loop if active
			ge := GetGameEngine(activeMatchID)
			if ge != nil {
				close(ge.stopChan)
				enginesMu.Lock()
				delete(engines, activeMatchID)
				enginesMu.Unlock()
			}

			// Reset other frame back to searching and notify them
			otherLobbyID = otherLobby.ID
			otherLobby.Status = "waiting"
			for _, member := range otherLobby.Members {
				member.Presence = "MATCHING"
			}
		}
		hub.mu.Unlock()

		if otherLobbyID != "" {
			hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
			hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  otherLobbyID,
				"presence": "MATCHING",
			})
			hub.AddToMatchmaking(otherLobbyID)
		}

		hub.LeaveLobby(userID)
		ws.Close()
		fmt.Printf("❌ Client disconnected: %s\n", userID)
	}()

	for {
		// Membaca pesan dari client
		_, message, err := ws.ReadMessage()
		if err != nil {
			fmt.Printf("❌ Error reading message from %s: %v\n", userID, err)
			break
		}

		// Parse message
		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			fmt.Printf("❌ Error parsing message: %v\n", err)
			continue
		}

		fmt.Printf("📩 Event: %s from %s\n", msg.Event, client.ID)

		switch msg.Event {
		case "FRAME_CREATE":
			var payload FrameCreatePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			inviteCode := hub.generateInviteCode()
			var dbUserID string
			var dbLobbyID string

			if db != nil {
				var err error
				// Upsert: returns existing UUID or creates a new one. No duplicate error.
				dbUserID, err = GetOrCreateUser(payload.Username)
				if err != nil {
					fmt.Printf("Error getting/creating user: %v\n", err)
					dbUserID = generateTempID()
				}
				dbLobbyID, err = CreateLobbyDB(dbUserID, inviteCode)
				if err != nil {
					fmt.Printf("Error creating lobby: %v\n", err)
					dbLobbyID = "lobby-" + generateTempID()
				} else {
					AddLobbyMember(dbLobbyID, dbUserID)
				}
			} else {
				dbUserID = generateTempID()
				dbLobbyID = "lobby-" + generateTempID()
			}

			client.ID = dbUserID
			client.Username = payload.Username
			client.LobbyID = dbLobbyID
			client.IsLobbyOwner = true
			client.Presence = "ONLINE"
			client.JoinOrder = 1

			hub.mu.Lock()
			lobby := &Lobby{
				ID:         dbLobbyID,
				OwnerID:    dbUserID,
				InviteCode: inviteCode,
				Status:     "waiting",
				Members:    make(map[string]*Client),
				CreatedAt:  time.Now(),
			}
			lobby.Members[dbUserID] = client
			hub.lobbies[dbLobbyID] = lobby
			hub.inviteCodes[inviteCode] = dbLobbyID
			hub.clients[dbUserID] = client
			hub.mu.Unlock()

			sendResponse(ws, map[string]interface{}{
				"event": "FRAME_CREATED",
				"payload": map[string]interface{}{
					"frameId": dbLobbyID,
					"ownerId": dbUserID,
					"members": lobby.ToFrame().Members,
				},
			})

		case "PLAYER_JOIN":
			var payload PlayerJoinPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			var dbUserID string
			if db != nil {
				var err error
				// Upsert: idempotent, returns UUID.
				dbUserID, err = GetOrCreateUser(payload.Username)
				if err != nil {
					fmt.Printf("Error getting/creating user: %v\n", err)
					dbUserID = generateTempID()
				}
				AddLobbyMember(payload.FrameID, dbUserID)
			} else {
				dbUserID = generateTempID()
			}

			client.ID = dbUserID
			client.Username = payload.Username
			client.LobbyID = payload.FrameID

			err = hub.JoinLobby(payload.FrameID, dbUserID, payload.Username, client)
			if err != nil {
				sendError(ws, err.Error())
				continue
			}

			hub.mu.RLock()
			lobby, ok := hub.lobbies[payload.FrameID]
			var frame Frame
			if ok {
				frame = lobby.ToFrame()
			}
			hub.mu.RUnlock()

			hub.broadcastEventToLobby(payload.FrameID, "PLAYER_JOIN", map[string]interface{}{
				"frameId":     payload.FrameID,
				"participant": client,
			})

			sendResponse(ws, map[string]interface{}{
				"event": "FRAME_JOINED",
				"payload": map[string]interface{}{
					"frameId":      payload.FrameID,
					"ownerId":      frame.OwnerID,
					"members":      frame.Members,
					"joinedUserId": dbUserID,
				},
			})

		case "SEARCH_START":
			var payload SearchStartPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			hub.mu.Lock()
			lobby, exists := hub.lobbies[payload.FrameID]
			if exists {
				for _, member := range lobby.Members {
					member.Presence = "MATCHING"
				}
				lobby.Status = "waiting"
			}
			hub.mu.Unlock()

			hub.broadcastEventToLobby(payload.FrameID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  payload.FrameID,
				"presence": "MATCHING",
			})

			hub.AddToMatchmaking(payload.FrameID)

		case "FRAME_NEXT":
			if time.Since(client.LastNextClick) < 2*time.Second {
				sendError(ws, "Rate limit active. Please wait.")
				continue
			}
			client.LastNextClick = time.Now()

			var otherLobbyID string
			hub.mu.Lock()
			var activeMatchID string
			for mID, match := range hub.matches {
				if match.LobbyA.ID == client.LobbyID || match.LobbyB.ID == client.LobbyID {
					activeMatchID = mID
					break
				}
			}
			if activeMatchID != "" {
				match := hub.matches[activeMatchID]
				otherLobby := match.LobbyA
				if otherLobby.ID == client.LobbyID {
					otherLobby = match.LobbyB
				}
				delete(hub.matches, activeMatchID)

				ge := GetGameEngine(activeMatchID)
				if ge != nil {
					close(ge.stopChan)
					enginesMu.Lock()
					delete(engines, activeMatchID)
					enginesMu.Unlock()
				}

				otherLobbyID = otherLobby.ID
				otherLobby.Status = "waiting"
				for _, member := range otherLobby.Members {
					member.Presence = "MATCHING"
				}
			}

			lobby, exists := hub.lobbies[client.LobbyID]
			if exists {
				for _, member := range lobby.Members {
					member.Presence = "MATCHING"
				}
				lobby.Status = "waiting"
			}
			hub.mu.Unlock()

			hub.broadcastEventToLobby(client.LobbyID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  client.LobbyID,
				"presence": "MATCHING",
			})
			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				hub.AddToMatchmaking(otherLobbyID)
			}

			hub.AddToMatchmaking(client.LobbyID)

		case "GAME_INVITE":
			var payload GameInvitePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			hub.mu.RLock()
			var activeMatch *Match
			for _, match := range hub.matches {
				if match.LobbyA.ID == client.LobbyID || match.LobbyB.ID == client.LobbyID {
					activeMatch = match
					break
				}
			}
			hub.mu.RUnlock()

			if activeMatch != nil {
				otherLobby := activeMatch.LobbyA
				if otherLobby.ID == client.LobbyID {
					otherLobby = activeMatch.LobbyB
				}

				hub.mu.RLock()
				otherOwner, ok := hub.clients[otherLobby.OwnerID]
				hub.mu.RUnlock()

				if ok {
					otherOwner.Send(map[string]interface{}{
						"event": "GAME_INVITE_RECEIVED",
						"payload": map[string]interface{}{
							"senderId":   client.ID,
							"senderName": client.Username,
							"sessionId":  activeMatch.ID,
							"gameType":   payload.GameType,
						},
					})
				}
			}

		case "GAME_ACCEPT":
			var payload GameAcceptPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			hub.broadcastEventToMatch(payload.SessionID, "GAME_START", map[string]interface{}{
				"sessionId": payload.SessionID,
				"gameType":  "guess_drawing",
			})

			StartGame(hub, payload.SessionID)

		case "GAME_DECLINE":
			var payload GameDeclinePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			hub.broadcastEventToMatch(payload.SessionID, "GAME_DECLINED", map[string]interface{}{})

		case "GAME_STOP":
			var payload GameAcceptPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			ge := GetGameEngine(payload.SessionID)
			if ge != nil {
				close(ge.stopChan)
				enginesMu.Lock()
				delete(engines, payload.SessionID)
				enginesMu.Unlock()
			}
			hub.broadcastEventToMatch(payload.SessionID, "GAME_END", map[string]interface{}{})

		case "CANVAS_START", "CANVAS_MOVE", "CANVAS_END":
			hub.mu.RLock()
			var partnerLobbyID string
			for _, match := range hub.matches {
				if match.LobbyA.ID == client.LobbyID {
					partnerLobbyID = match.LobbyB.ID
					break
				} else if match.LobbyB.ID == client.LobbyID {
					partnerLobbyID = match.LobbyA.ID
					break
				}
			}
			hub.mu.RUnlock()

			if partnerLobbyID != "" {
				var canvasPayload interface{}
				if err := json.Unmarshal(msg.Payload, &canvasPayload); err != nil {
					sendError(ws, "Invalid canvas payload")
					continue
				}
				hub.broadcastToLobby(partnerLobbyID, map[string]interface{}{
					"event":   msg.Event,
					"payload": canvasPayload,
				})
			}

		case "GUESS_SUBMIT":
			hub.mu.RLock()
			var activeMatchID string
			for mID, match := range hub.matches {
				if match.LobbyA.ID == client.LobbyID || match.LobbyB.ID == client.LobbyID {
					activeMatchID = mID
					break
				}
			}
			hub.mu.RUnlock()

			if activeMatchID != "" {
				ge := GetGameEngine(activeMatchID)
				if ge != nil {
					var submitPayload struct {
						GuessText string `json:"guessText"`
					}
					json.Unmarshal(msg.Payload, &submitPayload)
					ge.SubmitGuess(client.ID, client.Username, submitPayload.GuessText)
				}
			}

		case "CHAT_MESSAGE":
			var chatPayload ChatMessagePayload
			if err := json.Unmarshal(msg.Payload, &chatPayload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			chatMsg := map[string]interface{}{
				"id":         fmt.Sprintf("msg-%d", time.Now().UnixNano()),
				"senderId":   client.ID,
				"senderName": client.Username,
				"text":       chatPayload.Text,
				"side":       "left",
				"timestamp":  time.Now().Format("15:04"),
			}

			hub.mu.RLock()
			var matched bool
			var matchID string
			for mID, match := range hub.matches {
				if match.LobbyA.ID == client.LobbyID || match.LobbyB.ID == client.LobbyID {
					matched = true
					matchID = mID
					break
				}
			}
			hub.mu.RUnlock()

			if matched {
				hub.broadcastEventToMatch(matchID, "CHAT_MESSAGE", chatMsg)
			} else {
				hub.broadcastEventToLobby(client.LobbyID, "CHAT_MESSAGE", chatMsg)
			}

		case "MUTE_USER":
			var mutePayload MuteUserPayload
			if err := json.Unmarshal(msg.Payload, &mutePayload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			hub.mu.Lock()
			targetClient, exists := hub.clients[mutePayload.TargetUserID]
			if exists {
				targetClient.IsMuted = mutePayload.IsMuted
			}
			hub.mu.Unlock()

			hub.broadcastEventToLobby(client.LobbyID, "MUTE_UPDATE", map[string]interface{}{
				"userId":  mutePayload.TargetUserID,
				"isMuted": mutePayload.IsMuted,
			})

		case "REPORT_USER":
			var reportPayload ReportUserPayload
			if err := json.Unmarshal(msg.Payload, &reportPayload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}
			fmt.Printf("⚠️ REPORT USER: %s reported %s for: %s\n", client.Username, reportPayload.TargetUserID, reportPayload.Reason)

		default:
			fmt.Printf("Unknown message type: %s\n", msg.Event)
		}
	}
}

func sendResponse(ws *websocket.Conn, data interface{}) error {
	message, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return ws.WriteMessage(websocket.TextMessage, message)
}

func sendError(ws *websocket.Conn, errorMsg string) error {
	return sendResponse(ws, map[string]interface{}{
		"event": "ERROR",
		"payload": map[string]interface{}{
			"error": errorMsg,
		},
	})
}
