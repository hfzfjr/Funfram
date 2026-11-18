package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var connClients sync.Map // *websocket.Conn -> *Client

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

type ReportUserPayload struct {
	TargetUserID string `json:"targetUserId"`
	SessionID    string `json:"sessionId"`
	Reason       string `json:"reason"`
}

type RejoinSessionPayload struct {
	UserID   string `json:"userId"`
	FrameID  string `json:"frameId"`
	Username string `json:"username"`
}

type GameInvitePayload struct {
	SessionID string `json:"sessionId"`
	GameType  string `json:"gameType"`
	Rounds    int    `json:"rounds"`
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

type ChatMessagePayload struct {
	Text string `json:"text"`
}

type FrameLeavePayload struct {
	FrameID   string `json:"frameId"`
	SessionID string `json:"sessionId"`
}

type DeviceStateChangePayload struct {
	SessionID         string `json:"sessionId"`
	UserID            string `json:"userId"`
	CameraEnabled     bool   `json:"cameraEnabled"`
	MicrophoneEnabled bool   `json:"microphoneEnabled"`
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

func cleanupMatchForLobby(hub *Hub, lobbyID string) (string, string) {
	var otherLobbyID string
	var activeMatchID string

	hub.mu.Lock()
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
		otherLobbyID = otherLobby.ID

		delete(hub.matches, activeMatchID)

		if currentLobby, exists := hub.lobbies[lobbyID]; exists {
			currentLobby.Status = "WAITING"
			currentLobby.LastMatchLobbyID = otherLobbyID
			for _, member := range currentLobby.Members {
				member.Presence = "MATCHING"
			}
		}

		if otherLobbyState, exists := hub.lobbies[otherLobbyID]; exists {
			otherLobbyState.Status = "WAITING"
			otherLobbyState.LastMatchLobbyID = lobbyID
			for _, member := range otherLobbyState.Members {
				member.Presence = "MATCHING"
			}
		}
	}
	hub.mu.Unlock()

	if activeMatchID != "" {
		if ge := GetGameEngine(activeMatchID); ge != nil {
			ge.Stop()
			enginesMu.Lock()
			delete(engines, activeMatchID)
			enginesMu.Unlock()
		}
	}

	if activeMatchID != "" && db != nil {
		if err := EndMatchDB(activeMatchID); err != nil {
			fmt.Printf("Error ending match in DB: %v\n", err)
		}
		_ = UpdateLobbyStatus(lobbyID, "WAITING")
		if otherLobbyID != "" {
			_ = UpdateLobbyStatus(otherLobbyID, "WAITING")
		}
	}

	return activeMatchID, otherLobbyID
}

func finalizeClientDisconnect(hub *Hub, client *Client) {
	lobbyID := client.LobbyID
	userID := client.ID

	if client.IsLobbyOwner {
		activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, lobbyID)
		if otherLobbyID != "" {
			hub.broadcastEventToLobby(otherLobbyID, "PLAYER_LEFT", map[string]interface{}{
				"userId":    userID,
				"frameId":   lobbyID,
				"sessionId": activeMatchID,
				"reason":    "DISCONNECT",
			})
			hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
			hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  otherLobbyID,
				"presence": "MATCHING",
			})
			hub.AddToMatchmaking(otherLobbyID)
		}

		hub.mu.RLock()
		lobby, exists := hub.lobbies[lobbyID]
		var guests []*Client
		if exists {
			for guestID, guestClient := range lobby.Members {
				if guestID != userID {
					guests = append(guests, guestClient)
				}
			}
		}
		hub.mu.RUnlock()

		for _, guestClient := range guests {
			sendResponse(guestClient.Conn, map[string]interface{}{
				"event": "FRAME_DESTROYED",
				"payload": map[string]interface{}{
					"frameId": lobbyID,
				},
			})
			hub.LeaveLobby(guestClient.ID)
		}
	} else if lobbyID != "" {
		hub.broadcastEventToLobby(lobbyID, "PLAYER_LEFT", map[string]interface{}{
			"userId":    userID,
			"frameId":   lobbyID,
			"reason":    "DISCONNECT",
		})
	}

	hub.LeaveLobby(userID)
	if db != nil && userID != "" {
		_ = UpsertUserPresence(userID, "OFFLINE", "")
	}
	fmt.Printf("❌ Client disconnected: %s\n", userID)
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
	connClients.Store(ws, client)
	defer connClients.Delete(ws)

	// Set up ping/pong for detecting offline ghost users (45s tolerance for mobile/lag spikes)
	pongWait := 45 * time.Second
	pingPeriod := 15 * time.Second
	ws.SetReadDeadline(time.Now().Add(pongWait))
	ws.SetPongHandler(func(string) error { ws.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	go func() {
		ticker := time.NewTicker(pingPeriod)
		defer ticker.Stop()
		for range ticker.C {
			client.WriteMu.Lock()
			err := ws.WriteMessage(websocket.PingMessage, nil)
			client.WriteMu.Unlock()
			if err != nil {
				return
			}
		}
	}()

	fmt.Printf("✅ New WebSocket connection: %s from %s\n", userID, ws.RemoteAddr())

	defer func() {
		hub.mu.Lock()
		isActiveSocket := client.Conn == ws
		hub.mu.Unlock()

		ws.Close()
		if !isActiveSocket {
			return
		}

		// Give a 12-second grace period on unexpected network drops so brief lag/reconnects don't kill the match
		if !client.ExplicitLeave && client.LobbyID != "" {
			disconnectedClient := client
			disconnectedWS := ws
			disconnectedClient.Presence = "RECONNECTING"
			fmt.Printf("⏳ Client %s dropped unexpectedly; waiting 12s grace period before cleanup\n", disconnectedClient.ID)
			disconnectedClient.DisconnectTimer = time.AfterFunc(12*time.Second, func() {
				hub.mu.Lock()
				stillDisconnected := disconnectedClient.Conn == disconnectedWS
				hub.mu.Unlock()
				if stillDisconnected {
					finalizeClientDisconnect(hub, disconnectedClient)
				}
			})
			return
		}

		finalizeClientDisconnect(hub, client)
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

			if db != nil {
				_ = UpsertUserPresence(dbUserID, "ONLINE", "")
				_ = UpsertUserDeviceState(dbUserID, "", true, true)
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
				Status:     "WAITING",
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
				dbUserID, err = GetOrCreateUser(payload.Username)
				if err != nil {
					fmt.Printf("Error getting/creating user: %v\n", err)
					dbUserID = generateTempID()
				}
			} else {
				dbUserID = generateTempID()
			}

			// Prevent session overwrite if the same username is used (e.g. testing)
			hub.mu.RLock()
			if lobby, exists := hub.lobbies[payload.FrameID]; exists {
				if _, alreadyJoined := lobby.Members[dbUserID]; alreadyJoined {
					dbUserID = dbUserID + "-" + generateTempID()[:4]
				}
			}
			hub.mu.RUnlock()

			if db != nil {
				_ = UpsertUserPresence(dbUserID, "ONLINE", "")
				_ = UpsertUserDeviceState(dbUserID, "", true, true)
			}

			if db != nil {
				_ = UpsertUserPresence(dbUserID, "ONLINE", "")
				_ = UpsertUserDeviceState(dbUserID, "", true, true)
			}

			client.ID = dbUserID
			client.Username = payload.Username
			client.LobbyID = payload.FrameID

			err = hub.JoinLobby(payload.FrameID, dbUserID, payload.Username, client)
			if err != nil {
				sendError(ws, err.Error())
				continue
			}

			if db != nil {
				_ = AddLobbyMember(payload.FrameID, dbUserID)
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
				lobby.Status = "WAITING"
			}
			hub.mu.Unlock()

			hub.broadcastEventToLobby(payload.FrameID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  payload.FrameID,
				"presence": "MATCHING",
			})

			hub.AddToMatchmaking(payload.FrameID)

		case "FRAME_NEXT":
			if !client.IsLobbyOwner {
				sendError(ws, "Only the Host can perform Next Frame")
				continue
			}
			if time.Since(client.LastNextClick) < 2*time.Second {
				sendError(ws, "Rate limit active. Please wait.")
				continue
			}
			client.LastNextClick = time.Now()

			activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, client.LobbyID)
			
			// Broadcast MATCH_LEFT so both sides know the match ended (without removing players from their own lobbies)
			hub.broadcastEventToLobby(client.LobbyID, "MATCH_LEFT", map[string]interface{}{})
			hub.broadcastEventToLobby(client.LobbyID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  client.LobbyID,
				"presence": "MATCHING",
			})
			
			if db != nil && client.ID != "" {
				_ = UpsertUserPresence(client.ID, "MATCHING", activeMatchID)
			}

			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				hub.AddToMatchmaking(otherLobbyID)
			}

			hub.AddToMatchmaking(client.LobbyID)

		case "REPORT_USER":
			var payload ReportUserPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil || payload.TargetUserID == "" {
				continue
			}
			fmt.Printf("[REPORT] User %s (%s) reported %s in session %s (reason: %s)\n", client.ID, client.Username, payload.TargetUserID, payload.SessionID, payload.Reason)
			hub.BlockUser(client.ID, payload.TargetUserID)

			_ = client.Send(map[string]interface{}{
				"event": "REPORT_CONFIRMED",
				"payload": map[string]interface{}{
					"targetUserId": payload.TargetUserID,
				},
			})

			// Automatically skip current match if active
			if client.LobbyID != "" {
				activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, client.LobbyID)
				if activeMatchID != "" || otherLobbyID != "" {
					hub.broadcastEventToLobby(client.LobbyID, "MATCH_LEFT", map[string]interface{}{})
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
				}
			}

		case "REJOIN_SESSION":
			var payload RejoinSessionPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil || payload.UserID == "" || payload.FrameID == "" {
				continue
			}
			hub.mu.Lock()
			existing, ok := hub.clients[payload.UserID]
			if ok && existing.LobbyID == payload.FrameID {
				if existing.DisconnectTimer != nil {
					existing.DisconnectTimer.Stop()
					existing.DisconnectTimer = nil
				}
				existing.Conn = ws
				existing.Presence = "ONLINE"
				existing.ExplicitLeave = false
				if client.ID != existing.ID {
					delete(hub.clients, client.ID)
				}
				client = existing
				userID = existing.ID
				connClients.Store(ws, existing)
				hub.mu.Unlock()

				fmt.Printf("🔄 Client %s rejoined frame %s seamlessly\n", existing.ID, payload.FrameID)
				_ = existing.Send(map[string]interface{}{
					"event": "SESSION_RESTORED",
					"payload": map[string]interface{}{
						"userId":  existing.ID,
						"frameId": existing.LobbyID,
					},
				})
			} else {
				hub.mu.Unlock()
			}

		case "FRAME_LEAVE":
			client.ExplicitLeave = true
			var payload FrameLeavePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}
			if payload.FrameID != "" && payload.FrameID != client.LobbyID {
				sendError(ws, "frame mismatch")
				continue
			}

			if !client.IsLobbyOwner {
				// Guest is leaving
				hub.mu.RLock()
				var activeMatchID string
				var partnerLobbyID string
				for mID, match := range hub.matches {
					if match.LobbyA.ID == client.LobbyID {
						activeMatchID = mID
						partnerLobbyID = match.LobbyB.ID
						break
					} else if match.LobbyB.ID == client.LobbyID {
						activeMatchID = mID
						partnerLobbyID = match.LobbyA.ID
						break
					}
				}
				hub.mu.RUnlock()

				hub.LeaveLobby(client.ID)
				
				if db != nil && client.ID != "" {
					_ = UpsertUserPresence(client.ID, "ONLINE", "")
				}
				
				// Broadcast guest left to host's lobby
				hub.broadcastEventToLobby(client.LobbyID, "PLAYER_LEFT", map[string]interface{}{
					"userId":    client.ID,
					"frameId":   client.LobbyID,
					"sessionId": activeMatchID,
					"reason":    "GUEST_LEAVE",
				})
				// Broadcast guest left to partner lobby
				if partnerLobbyID != "" {
					hub.broadcastEventToLobby(partnerLobbyID, "PLAYER_LEFT", map[string]interface{}{
						"userId":    client.ID,
						"frameId":   client.LobbyID,
						"sessionId": activeMatchID,
						"reason":    "GUEST_LEAVE",
					})
				}
				continue
			}

			// Host is leaving -> destroy match and leave
			activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, client.LobbyID)
			if db != nil && client.ID != "" {
				_ = UpsertUserPresence(client.ID, "ONLINE", "")
			}

			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "PLAYER_LEFT", map[string]interface{}{
					"userId":    client.ID,
					"frameId":   client.LobbyID,
					"sessionId": activeMatchID,
					"reason":    "FRAME_LEAVE",
				})
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				hub.AddToMatchmaking(otherLobbyID)

				hub.broadcastEventToLobby(client.LobbyID, "MATCH_LEFT", map[string]interface{}{})
			}

			hub.mu.RLock()
			lobby, exists := hub.lobbies[client.LobbyID]
			var guests []*Client
			if exists {
				for guestID, guestClient := range lobby.Members {
					if guestID != client.ID {
						guests = append(guests, guestClient)
					}
				}
			}
			hub.mu.RUnlock()

			for _, guestClient := range guests {
				sendResponse(guestClient.Conn, map[string]interface{}{
					"event": "FRAME_DESTROYED",
					"payload": map[string]interface{}{
						"frameId": client.LobbyID,
					},
				})
				hub.LeaveLobby(guestClient.ID)
			}

			hub.LeaveLobby(client.ID)

		case "DEVICE_STATE_CHANGE":
			var payload DeviceStateChangePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			hub.mu.Lock()
			if targetClient, exists := hub.clients[payload.UserID]; exists {
				targetClient.IsCameraOff = !payload.CameraEnabled
				targetClient.IsMuted = !payload.MicrophoneEnabled
			}
			if lobby, exists := hub.lobbies[client.LobbyID]; exists {
				for _, member := range lobby.Members {
					if member.ID == payload.UserID {
						member.IsCameraOff = !payload.CameraEnabled
						member.IsMuted = !payload.MicrophoneEnabled
					}
				}
			}
			var activeMatchID string
			for mID, match := range hub.matches {
				if match.LobbyA.ID == client.LobbyID || match.LobbyB.ID == client.LobbyID {
					activeMatchID = mID
					break
				}
			}
			hub.mu.Unlock()

			if db != nil && payload.UserID != "" {
				_ = UpsertUserDeviceState(payload.UserID, payload.SessionID, payload.CameraEnabled, payload.MicrophoneEnabled)
			}

			devicePayload := map[string]interface{}{
				"userId":            payload.UserID,
				"sessionId":         payload.SessionID,
				"cameraEnabled":     payload.CameraEnabled,
				"microphoneEnabled": payload.MicrophoneEnabled,
			}
			if activeMatchID != "" {
				hub.broadcastEventToMatch(activeMatchID, "DEVICE_STATE_CHANGE", devicePayload)
			} else {
				hub.broadcastEventToLobby(client.LobbyID, "DEVICE_STATE_CHANGE", devicePayload)
			}

		case "GAME_INVITE":
			if !client.IsLobbyOwner {
				sendError(ws, "Only the Host can invite to games")
				continue
			}
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
				rounds := payload.Rounds
				if rounds < 1 {
					rounds = 1
				} else if rounds > 10 {
					rounds = 10
				}

				hub.mu.Lock()
				activeMatch.PendingGameType = payload.GameType
				activeMatch.PendingRounds = rounds
				hub.mu.Unlock()

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
							"rounds":     rounds,
						},
					})
				}
			}

		case "GAME_ACCEPT":
			if !client.IsLobbyOwner {
				sendError(ws, "Only the Host can accept games")
				continue
			}
			var payload GameAcceptPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				sendError(ws, "Invalid payload")
				continue
			}

			gameType := "guess_drawing"
			rounds := 1
			hub.mu.RLock()
			if match, exists := hub.matches[payload.SessionID]; exists {
				if match.PendingGameType != "" {
					gameType = match.PendingGameType
				}
				if match.PendingRounds > 0 {
					rounds = match.PendingRounds
				}
			}
			hub.mu.RUnlock()

			hub.broadcastEventToMatch(payload.SessionID, "GAME_START", map[string]interface{}{
				"sessionId": payload.SessionID,
				"gameType":  gameType,
				"rounds":    rounds,
			})

			if gameType == "guess_drawing" {
				StartGameWithRounds(hub, payload.SessionID, rounds)
			}

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
				ge.Stop()
				enginesMu.Lock()
				delete(engines, payload.SessionID)
				enginesMu.Unlock()
			}
			hub.broadcastEventToMatch(payload.SessionID, "GAME_END", map[string]interface{}{})

		case "GAME_ACTION":
			var actionPayload map[string]interface{}
			if err := json.Unmarshal(msg.Payload, &actionPayload); err != nil {
				sendError(ws, "Invalid game action payload")
				continue
			}
			actionPayload["senderId"] = client.ID

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
				hub.broadcastEventToMatch(activeMatchID, "GAME_ACTION", actionPayload)
			}

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

		case "RETURN_TO_LOBBY":
			// Return to lobby without destroying the frame.
			if !client.IsLobbyOwner {
				sendError(ws, "Only the Host can return to lobby")
				continue
			}

			lobbyID := client.LobbyID
			if lobbyID == "" {
				continue
			}

			// 1. Cleanup match if currently matched, and notify partner
			activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, lobbyID)
			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				// Put partner back in matchmaking so they get another match quickly
				hub.AddToMatchmaking(otherLobbyID)
			}
			if db != nil && activeMatchID != "" {
				_ = UpdateLobbyStatus(lobbyID, "WAITING")
			}

			// 2. Remove own lobby from matchmaking queue if it's in there
			hub.mu.Lock()
			newQueue := make([]*Lobby, 0, len(hub.waitingQueue))
			for _, waitingLobby := range hub.waitingQueue {
				if waitingLobby.ID != lobbyID {
					newQueue = append(newQueue, waitingLobby)
				}
			}
			hub.waitingQueue = newQueue

			// 3. Reset lobby status to WAITING and member presence to ONLINE
			if lobby, exists := hub.lobbies[lobbyID]; exists {
				lobby.Status = "WAITING"
				for _, member := range lobby.Members {
					member.Presence = "ONLINE"
				}
			}
			hub.mu.Unlock()

			// 4. Broadcast LOBBY_RETURNED to all members in own lobby
			hub.broadcastEventToLobby(lobbyID, "LOBBY_RETURNED", map[string]interface{}{
				"frameId": lobbyID,
			})

		default:
			fmt.Printf("Unknown message type: %s\n", msg.Event)
		}
	}
}

func sendResponse(ws *websocket.Conn, data interface{}) error {
	if val, ok := connClients.Load(ws); ok {
		if client, ok := val.(*Client); ok {
			return client.Send(data)
		}
	}
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
