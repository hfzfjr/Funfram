package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var connClients sync.Map // *websocket.Conn -> *Client

var upgrader = websocket.Upgrader{
	CheckOrigin: CheckWSOrigin,
}

type WSMessage struct {
	Event   string          `json:"event"`
	Payload json.RawMessage `json:"payload"`
}

type FrameCreatePayload struct {
	Username string `json:"username"`
}

type PlayerJoinPayload struct {
	FrameID     string `json:"frameId"`
	Username    string `json:"username"`
	InviteToken string `json:"inviteToken,omitempty"`
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
	UserID       string `json:"userId"`
	FrameID      string `json:"frameId"`
	Username     string `json:"username"`
	SessionToken string `json:"sessionToken"`
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
func generateTempID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

func cleanupMatchForLobby(hub *Hub, lobbyID string) (string, string) {
	if lobbyID == "" {
		return "", ""
	}
	var otherLobbyID string
	var activeMatchID string

	hub.mu.Lock()
	if mID, ok := hub.lobbyToMatch[lobbyID]; ok {
		activeMatchID = mID
	} else {
		for mID, match := range hub.matches {
			if match.LobbyA.ID == lobbyID || match.LobbyB.ID == lobbyID {
				activeMatchID = mID
				break
			}
		}
	}

	if activeMatchID != "" {
		if match, exists := hub.matches[activeMatchID]; exists {
			otherLobby := match.LobbyA
			if otherLobby.ID == lobbyID {
				otherLobby = match.LobbyB
			}
			otherLobbyID = otherLobby.ID

			delete(hub.matches, activeMatchID)
			delete(hub.lobbyToMatch, match.LobbyA.ID)
			delete(hub.lobbyToMatch, match.LobbyB.ID)

			if currentLobby, ok := hub.lobbies[lobbyID]; ok {
				currentLobby.Status = "WAITING"
				currentLobby.LastMatchLobbyID = otherLobbyID
				for _, member := range currentLobby.Members {
					member.Presence = "MATCHING"
				}
			}

			if otherLobbyState, ok := hub.lobbies[otherLobbyID]; ok {
				otherLobbyState.Status = "WAITING"
				otherLobbyState.LastMatchLobbyID = lobbyID
				for _, member := range otherLobbyState.Members {
					member.Presence = "MATCHING"
				}
			}
		} else {
			delete(hub.lobbyToMatch, lobbyID)
			activeMatchID = ""
		}
	}
	hub.mu.Unlock()

	if activeMatchID != "" {
		StopBoardGames(activeMatchID)
		if ge := GetGameEngine(activeMatchID); ge != nil {
			ge.Stop()
			enginesMu.Lock()
			if engines[activeMatchID] == ge {
				delete(engines, activeMatchID)
			}
			enginesMu.Unlock()
		}
	}

	if activeMatchID != "" && db != nil {
		go func(mID, lID, oID string) {
			if err := EndMatchDB(mID); err != nil {
				slog.Warn("Error ending match in DB", "matchId", mID, "error", err)
			}
			_ = UpdateLobbyStatus(lID, "WAITING")
			if oID != "" {
				_ = UpdateLobbyStatus(oID, "WAITING")
			}
		}(activeMatchID, lobbyID, otherLobbyID)
	}

	return activeMatchID, otherLobbyID
}

func isUserInMatchLocked(match *Match, targetUserID string) bool {
	if match == nil || targetUserID == "" {
		return false
	}
	if match.LobbyA != nil {
		if _, ok := match.LobbyA.Members[targetUserID]; ok {
			return true
		}
	}
	if match.LobbyB != nil {
		if _, ok := match.LobbyB.Members[targetUserID]; ok {
			return true
		}
	}
	return false
}

func finalizeClientDisconnect(hub *Hub, client *Client) {
	hub.mu.RLock()
	lobbyID := client.LobbyID
	userID := client.ID
	isOwner := client.IsLobbyOwner
	var partnerLobbyIDForGuest string
	var activeMatchIDForGuest string
	if !isOwner && lobbyID != "" {
		if mID, ok := hub.lobbyToMatch[lobbyID]; ok {
			if match, mOk := hub.matches[mID]; mOk {
				activeMatchIDForGuest = mID
				if match.LobbyA.ID == lobbyID {
					partnerLobbyIDForGuest = match.LobbyB.ID
				} else {
					partnerLobbyIDForGuest = match.LobbyA.ID
				}
			}
		}
	}
	hub.mu.RUnlock()

	if isOwner && lobbyID != "" {
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
			_ = guestClient.Send(map[string]interface{}{
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
			"sessionId": activeMatchIDForGuest,
			"reason":    "DISCONNECT",
		})
		if partnerLobbyIDForGuest != "" {
			hub.broadcastEventToLobby(partnerLobbyIDForGuest, "PLAYER_LEFT", map[string]interface{}{
				"userId":    userID,
				"frameId":   lobbyID,
				"sessionId": activeMatchIDForGuest,
				"reason":    "DISCONNECT",
			})
		}
	}

	hub.LeaveLobby(userID)
	if db != nil && userID != "" {
		go func(uID string) {
			_ = UpsertUserPresence(uID, "OFFLINE", "")
		}(userID)
	}
	slog.Info("Client disconnected", "userId", userID)
}

func cleanupPreviousClientSession(hub *Hub, client *Client) {
	hub.mu.RLock()
	oldLobbyID := client.LobbyID
	oldUserID := client.ID
	wasOwner := client.IsLobbyOwner
	hub.mu.RUnlock()

	if oldLobbyID == "" {
		return
	}

	if wasOwner {
		activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, oldLobbyID)
		if otherLobbyID != "" {
			hub.broadcastEventToLobby(otherLobbyID, "PLAYER_LEFT", map[string]interface{}{
				"userId":    oldUserID,
				"frameId":   oldLobbyID,
				"sessionId": activeMatchID,
				"reason":    "FRAME_LEAVE",
			})
			hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
			hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  otherLobbyID,
				"presence": "MATCHING",
			})
			hub.AddToMatchmaking(otherLobbyID)
		}

		hub.mu.RLock()
		var guests []*Client
		if lobby, exists := hub.lobbies[oldLobbyID]; exists {
			for gID, gc := range lobby.Members {
				if gID != oldUserID {
					guests = append(guests, gc)
				}
			}
		}
		hub.mu.RUnlock()
		for _, gc := range guests {
			_ = gc.Send(map[string]interface{}{
				"event": "FRAME_DESTROYED",
				"payload": map[string]interface{}{
					"frameId": oldLobbyID,
				},
			})
			hub.LeaveLobby(gc.ID)
		}
	}
	hub.LeaveLobby(oldUserID)
}

func handleConnections(hub *Hub, ws *websocket.Conn) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("PANIC in handleConnections", "recover", r)
		}
	}()

	userID := fmt.Sprintf("user-%s", generateTempID())
	client := NewClient(ws, userID)
	connClients.Store(ws, client)
	defer connClients.Delete(ws)

	ws.SetReadLimit(32 * 1024) // 32 KB max frame
	_ = ws.SetReadDeadline(time.Now().Add(pongWait))
	ws.SetPongHandler(func(string) error {
		_ = ws.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	client.StartWritePump()

	slog.Info("New WebSocket connection", "userId", userID)
	_ = client.Send(map[string]interface{}{
		"event": "ONLINE_COUNT",
		"payload": map[string]interface{}{
			"count": hub.GetOnlineCount(),
		},
	})

	defer func() {
		hub.mu.Lock()
		isActiveSocket := client.Conn == ws
		explicitLeave := client.ExplicitLeave
		lobbyID := client.LobbyID
		if !isActiveSocket {
			hub.mu.Unlock()
			_ = ws.Close()
			return
		}

		if !explicitLeave && lobbyID != "" {
			disconnectedClient := client
			disconnectedWS := ws
			disconnectedClient.Presence = "RECONNECTING"
			if disconnectedClient.DisconnectTimer != nil {
				disconnectedClient.DisconnectTimer.Stop()
			}
			gracePeriod := 5 * time.Minute
			if _, inMatch := hub.lobbyToMatch[lobbyID]; inMatch {
				gracePeriod = 15 * time.Second
			}
			disconnectedClient.DisconnectTimer = time.AfterFunc(gracePeriod, func() {
				hub.mu.Lock()
				stillDisconnected := disconnectedClient.Conn == disconnectedWS
				hub.mu.Unlock()
				if stillDisconnected {
					finalizeClientDisconnect(hub, disconnectedClient)
				}
			})
			hub.mu.Unlock()
			disconnectedClient.closeCurrentTransport()
			slog.Info("Client dropped unexpectedly; waiting grace period", "userId", disconnectedClient.ID, "gracePeriod", gracePeriod.String())
			return
		}
		hub.mu.Unlock()

		client.closeCurrentTransport()
		finalizeClientDisconnect(hub, client)
	}()

	for {
		_, message, err := ws.ReadMessage()
		if err != nil {
			break
		}

		var msg WSMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		hub.mu.RLock()
		currentClient := client
		rl := currentClient.RateLimiter
		hub.mu.RUnlock()

		switch msg.Event {
		case "FRAME_CREATE":
			if !rl.control.Allow() {
				_ = currentClient.Send(errorMsg("Terlalu banyak permintaan. Tunggu sebentar."))
				continue
			}
			var payload FrameCreatePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}
			username := SanitizeText(payload.Username, 24)
			if username == "" {
				username = "Tamu"
			}

			cleanupPreviousClientSession(hub, currentClient)

			inviteCode := hub.generateInviteCode()
			var dbUserID string
			var dbLobbyID string

			if db != nil {
				var dbErr error
				dbUserID, dbErr = GetOrCreateUser(username)
				if dbErr != nil {
					dbUserID = generateTempID()
				}
				dbLobbyID, dbErr = CreateLobbyDB(dbUserID, inviteCode)
				if dbErr != nil {
					dbLobbyID = "lobby-" + generateTempID()
				} else {
					_ = AddLobbyMember(dbLobbyID, dbUserID)
				}
				go func(uID string) {
					_ = UpsertUserPresence(uID, "ONLINE", "")
					_ = UpsertUserDeviceState(uID, "", true, true)
				}(dbUserID)
			} else {
				dbUserID = generateTempID()
				dbLobbyID = "lobby-" + generateTempID()
			}

			sessionToken := GenerateSessionToken()
			turnToken, _ := SignRoomToken(dbUserID, dbLobbyID, "turn", 15*time.Minute)
			signalingToken, _ := SignRoomToken(dbUserID, dbLobbyID, "signaling", 15*time.Minute)

			hub.mu.Lock()
			currentClient.ID = dbUserID
			currentClient.Username = username
			currentClient.LobbyID = dbLobbyID
			currentClient.IsLobbyOwner = true
			currentClient.Presence = "ONLINE"
			currentClient.ExplicitLeave = false
			currentClient.JoinOrder = 1
			currentClient.SessionToken = sessionToken

			lobby := &Lobby{
				ID:           dbLobbyID,
				OwnerID:      dbUserID,
				InviteCode:   inviteCode,
				Status:       "WAITING",
				Members:      make(map[string]*Client),
				CreatedAt:    time.Now(),
				LastActivity: time.Now(),
			}
			lobby.Members[dbUserID] = currentClient
			hub.lobbies[dbLobbyID] = lobby
			hub.inviteCodes[inviteCode] = dbLobbyID
			hub.clients[dbUserID] = currentClient
			frame := lobby.ToFrame()
			hub.mu.Unlock()

			userID = dbUserID
			go hub.BroadcastOnlineCount()

			_ = currentClient.Send(map[string]interface{}{
				"event": "FRAME_CREATED",
				"payload": map[string]interface{}{
					"frameId":        dbLobbyID,
					"ownerId":        dbUserID,
					"members":        frame.Members,
					"sessionToken":   sessionToken,
					"turnToken":      turnToken,
					"signalingToken": signalingToken,
				},
			})

		case "PLAYER_JOIN":
			if !rl.control.Allow() {
				_ = currentClient.Send(errorMsg("Terlalu banyak permintaan. Tunggu sebentar."))
				continue
			}
			var payload PlayerJoinPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil || payload.FrameID == "" {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}
			username := SanitizeText(payload.Username, 24)
			if username == "" {
				username = "Tamu"
			}

			if payload.InviteToken != "" {
				claims, err := VerifyRoomToken(payload.InviteToken, "invite")
				if err != nil || claims.Room != payload.FrameID {
					_ = currentClient.Send(errorMsg("invalid invite"))
					continue
				}
			}

			cleanupPreviousClientSession(hub, currentClient)

			var dbUserID string
			if db != nil {
				var dbErr error
				dbUserID, dbErr = GetOrCreateUser(username)
				if dbErr != nil {
					dbUserID = generateTempID()
				}
			} else {
				dbUserID = generateTempID()
			}

			hub.mu.RLock()
			if lobby, exists := hub.lobbies[payload.FrameID]; exists {
				if _, alreadyJoined := lobby.Members[dbUserID]; alreadyJoined {
					dbUserID = dbUserID + "-" + generateTempID()[:4]
				}
			}
			hub.mu.RUnlock()

			if err := hub.JoinLobby(payload.FrameID, dbUserID, username, currentClient); err != nil {
				_ = currentClient.Send(errorMsg(err.Error()))
				continue
			}

			sessionToken := GenerateSessionToken()
			turnToken, _ := SignRoomToken(dbUserID, payload.FrameID, "turn", 15*time.Minute)
			signalingToken, _ := SignRoomToken(dbUserID, payload.FrameID, "signaling", 15*time.Minute)

			hub.mu.Lock()
			currentClient.ID = dbUserID
			currentClient.SessionToken = sessionToken
			var frame Frame
			if lobby, ok := hub.lobbies[payload.FrameID]; ok {
				frame = lobby.ToFrame()
			}
			clientSnap := currentClient.snapshot()
			hub.mu.Unlock()
			userID = dbUserID

			if db != nil {
				go func(fID, uID string) {
					_ = AddLobbyMember(fID, uID)
					_ = UpsertUserPresence(uID, "ONLINE", "")
					_ = UpsertUserDeviceState(uID, "", true, true)
				}(payload.FrameID, dbUserID)
			}

			hub.broadcastEventToLobby(payload.FrameID, "PLAYER_JOIN", map[string]interface{}{
				"frameId":     payload.FrameID,
				"participant": clientSnap,
			})

			_ = currentClient.Send(map[string]interface{}{
				"event": "FRAME_JOINED",
				"payload": map[string]interface{}{
					"frameId":        payload.FrameID,
					"ownerId":        frame.OwnerID,
					"members":        frame.Members,
					"joinedUserId":   dbUserID,
					"sessionToken":   sessionToken,
					"turnToken":      turnToken,
					"signalingToken": signalingToken,
				},
			})

		case "INVITE_CREATE":
			if !rl.control.Allow() {
				continue
			}
			hub.mu.RLock()
			isOwner := currentClient.IsLobbyOwner
			myLobbyID := currentClient.LobbyID
			myID := currentClient.ID
			lobby, exists := hub.lobbies[myLobbyID]
			isWaiting := exists && lobby.Status == "WAITING"
			hub.mu.RUnlock()

			if !isOwner || myLobbyID == "" || !isWaiting {
				_ = currentClient.Send(errorMsg("Only the Host in WAITING state can create invites"))
				continue
			}

			inviteCode, inviteToken, expiresAt, err := CreateSignedInvite(myLobbyID, myID)
			if err != nil {
				_ = currentClient.Send(errorMsg("Failed to create invite"))
				continue
			}

			_ = currentClient.Send(map[string]interface{}{
				"event": "INVITE_CREATED",
				"payload": map[string]interface{}{
					"frameId":     myLobbyID,
					"inviteCode":  inviteCode,
					"inviteToken": inviteToken,
					"expiresAt":   expiresAt,
				},
			})

		case "SEARCH_START":
			if !rl.control.Allow() {
				_ = currentClient.Send(errorMsg("Terlalu banyak permintaan."))
				continue
			}
			var payload SearchStartPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" || payload.FrameID != currentClient.LobbyID {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Unauthorized SEARCH_START"))
				continue
			}
			lobby, exists := hub.lobbies[payload.FrameID]
			if !exists || lobby.Status != "WAITING" {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Lobby is not in WAITING state"))
				continue
			}
			for _, member := range lobby.Members {
				member.Presence = "MATCHING"
			}
			lobby.LastActivity = time.Now()
			hub.mu.Unlock()

			hub.broadcastEventToLobby(payload.FrameID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  payload.FrameID,
				"presence": "MATCHING",
			})

			hub.AddToMatchmaking(payload.FrameID)

		case "FRAME_NEXT":
			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Only the Host can perform Next Frame"))
				continue
			}
			if time.Since(currentClient.LastNextClick) < 2*time.Second {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Terlalu cepat. Tunggu 2 detik."))
				continue
			}
			currentClient.LastNextClick = time.Now()
			myLobbyID := currentClient.LobbyID
			myUserID := currentClient.ID
			hub.mu.Unlock()

			activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, myLobbyID)

			hub.broadcastEventToLobby(myLobbyID, "MATCH_LEFT", map[string]interface{}{})
			hub.broadcastEventToLobby(myLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
				"frameId":  myLobbyID,
				"presence": "MATCHING",
			})

			if db != nil && myUserID != "" {
				go func(uID, mID string) {
					_ = UpsertUserPresence(uID, "MATCHING", mID)
				}(myUserID, activeMatchID)
			}

			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				hub.AddToMatchmaking(otherLobbyID)
			}

			hub.AddToMatchmaking(myLobbyID)

		case "REPORT_USER":
			if !rl.report.Allow() {
				_ = currentClient.Send(errorMsg("Tunggu beberapa detik sebelum melapor lagi."))
				continue
			}
			var payload ReportUserPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil || payload.TargetUserID == "" {
				continue
			}
			reason := SanitizeText(payload.Reason, 40)
			if reason == "" {
				reason = "other"
			}
			if !IsAllowedReportReason(reason) {
				reason = "other"
			}

			hub.mu.RLock()
			myLobbyID := currentClient.LobbyID
			myUserID := currentClient.ID
			isOwner := currentClient.IsLobbyOwner
			if myLobbyID == "" || payload.TargetUserID == myUserID {
				hub.mu.RUnlock()
				continue
			}
			mID, hasMatch := hub.lobbyToMatch[myLobbyID]
			if !hasMatch {
				hub.mu.RUnlock()
				continue
			}
			match, mOk := hub.matches[mID]
			if !mOk || !isUserInMatchLocked(match, payload.TargetUserID) {
				hub.mu.RUnlock()
				continue
			}
			hub.mu.RUnlock()

			slog.Info("User reported", "reporterId", myUserID, "targetId", payload.TargetUserID, "matchId", mID, "reason", reason)
			hub.BlockUser(myUserID, payload.TargetUserID)

			_ = currentClient.Send(map[string]interface{}{
				"event": "REPORT_CONFIRMED",
				"payload": map[string]interface{}{
					"targetUserId": payload.TargetUserID,
				},
			})

			if isOwner {
				activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, myLobbyID)
				if activeMatchID != "" || otherLobbyID != "" {
					hub.broadcastEventToLobby(myLobbyID, "MATCH_LEFT", map[string]interface{}{})
					hub.broadcastEventToLobby(myLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
						"frameId":  myLobbyID,
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
					hub.AddToMatchmaking(myLobbyID)
				}
			}

		case "REJOIN_SESSION":
			if !rl.control.Allow() {
				continue
			}
			var payload RejoinSessionPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil ||
				payload.UserID == "" || payload.FrameID == "" || payload.SessionToken == "" {
				_ = currentClient.Send(map[string]interface{}{
					"event":   "REJOIN_FAILED",
					"payload": map[string]interface{}{"reason": "missing credentials"},
				})
				continue
			}

			hub.mu.Lock()
			existing, ok := hub.clients[payload.UserID]
			if !ok ||
				existing.LobbyID != payload.FrameID ||
				!ConstantTimeEqual(existing.SessionToken, payload.SessionToken) {
				hub.mu.Unlock()
				_ = currentClient.Send(map[string]interface{}{
					"event":   "REJOIN_FAILED",
					"payload": map[string]interface{}{"reason": "invalid or expired session"},
				})
				continue
			}

			if existing.DisconnectTimer != nil {
				existing.DisconnectTimer.Stop()
				existing.DisconnectTimer = nil
			}
			restoredPresence := "ONLINE"
			if lobby, lOk := hub.lobbies[existing.LobbyID]; lOk {
				lobby.LastActivity = time.Now()
				if lobby.Status == "MATCHING" {
					restoredPresence = "MATCHING"
				}
			}
			activeRoomID := existing.LobbyID
			if mID, mOk := hub.lobbyToMatch[existing.LobbyID]; mOk {
				activeRoomID = mID
				restoredPresence = "PLAYING"
			}
			existing.Presence = restoredPresence
			existing.ExplicitLeave = false
			if currentClient.ID != existing.ID {
				delete(hub.clients, currentClient.ID)
			}
			if existing.Conn != ws {
				existing.reattachTransport(ws)
			}
			client = existing
			userID = existing.ID
			connClients.Store(ws, existing)
			hub.mu.Unlock()

			turnToken, _ := SignRoomToken(existing.ID, activeRoomID, "turn", 15*time.Minute)
			signalingToken, _ := SignRoomToken(existing.ID, activeRoomID, "signaling", 15*time.Minute)

			slog.Info("Client rejoined seamlessly", "userId", existing.ID, "frameId", payload.FrameID)
			_ = existing.Send(map[string]interface{}{
				"event": "SESSION_RESTORED",
				"payload": map[string]interface{}{
					"userId":         existing.ID,
					"frameId":        existing.LobbyID,
					"turnToken":      turnToken,
					"signalingToken": signalingToken,
				},
			})

		case "FRAME_LEAVE":
			var payload FrameLeavePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			myLobbyID := currentClient.LobbyID
			myUserID := currentClient.ID
			isOwner := currentClient.IsLobbyOwner
			if payload.FrameID != "" && payload.FrameID != myLobbyID {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("frame mismatch"))
				continue
			}
			currentClient.ExplicitLeave = true

			var activeMatchID string
			var partnerLobbyID string
			if myLobbyID != "" {
				if mID, ok := hub.lobbyToMatch[myLobbyID]; ok {
					activeMatchID = mID
					if match, mOk := hub.matches[mID]; mOk {
						if match.LobbyA.ID == myLobbyID {
							partnerLobbyID = match.LobbyB.ID
						} else {
							partnerLobbyID = match.LobbyA.ID
						}
					}
				}
			}
			hub.mu.Unlock()

			if !isOwner {
				hub.LeaveLobby(myUserID)
				if db != nil && myUserID != "" {
					go func(uID string) { _ = UpsertUserPresence(uID, "ONLINE", "") }(myUserID)
				}
				if myLobbyID != "" {
					hub.broadcastEventToLobby(myLobbyID, "PLAYER_LEFT", map[string]interface{}{
						"userId":    myUserID,
						"frameId":   myLobbyID,
						"sessionId": activeMatchID,
						"reason":    "GUEST_LEAVE",
					})
				}
				if partnerLobbyID != "" {
					hub.broadcastEventToLobby(partnerLobbyID, "PLAYER_LEFT", map[string]interface{}{
						"userId":    myUserID,
						"frameId":   myLobbyID,
						"sessionId": activeMatchID,
						"reason":    "GUEST_LEAVE",
					})
				}
				continue
			}

			activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, myLobbyID)
			if db != nil && myUserID != "" {
				go func(uID string) { _ = UpsertUserPresence(uID, "ONLINE", "") }(myUserID)
			}

			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "PLAYER_LEFT", map[string]interface{}{
					"userId":    myUserID,
					"frameId":   myLobbyID,
					"sessionId": activeMatchID,
					"reason":    "FRAME_LEAVE",
				})
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				hub.AddToMatchmaking(otherLobbyID)
				hub.broadcastEventToLobby(myLobbyID, "MATCH_LEFT", map[string]interface{}{})
			}

			hub.mu.RLock()
			var guests []*Client
			if lobby, exists := hub.lobbies[myLobbyID]; exists {
				for guestID, guestClient := range lobby.Members {
					if guestID != myUserID {
						guests = append(guests, guestClient)
					}
				}
			}
			hub.mu.RUnlock()

			for _, guestClient := range guests {
				_ = guestClient.Send(map[string]interface{}{
					"event": "FRAME_DESTROYED",
					"payload": map[string]interface{}{
						"frameId": myLobbyID,
					},
				})
				hub.LeaveLobby(guestClient.ID)
			}
			hub.LeaveLobby(myUserID)

		case "DEVICE_STATE_CHANGE":
			if !rl.control.Allow() {
				continue
			}
			var payload DeviceStateChangePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			if currentClient.LobbyID == "" {
				hub.mu.Unlock()
				continue
			}
			// Always enforce sender's own client.ID (prevents spoofing other users)
			myID := currentClient.ID
			myLobbyID := currentClient.LobbyID
			currentClient.IsCameraOff = !payload.CameraEnabled
			currentClient.IsMuted = !payload.MicrophoneEnabled
			activeMatchID := hub.lobbyToMatch[myLobbyID]
			hub.mu.Unlock()

			if db != nil && myID != "" {
				go func(uID, sID string, cam, mic bool) {
					_ = UpsertUserDeviceState(uID, sID, cam, mic)
				}(myID, activeMatchID, payload.CameraEnabled, payload.MicrophoneEnabled)
			}

			devicePayload := map[string]interface{}{
				"userId":            myID,
				"sessionId":         activeMatchID,
				"cameraEnabled":     payload.CameraEnabled,
				"microphoneEnabled": payload.MicrophoneEnabled,
			}
			if activeMatchID != "" {
				hub.broadcastEventToMatch(activeMatchID, "DEVICE_STATE_CHANGE", devicePayload)
			} else {
				hub.broadcastEventToLobby(myLobbyID, "DEVICE_STATE_CHANGE", devicePayload)
			}

		case "GAME_INVITE":
			if !rl.control.Allow() {
				continue
			}
			var payload GameInvitePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}
			if !IsAllowedGameType(payload.GameType) {
				_ = currentClient.Send(errorMsg("Game tidak dikenal"))
				continue
			}

			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Only the Host can invite to games"))
				continue
			}
			activeMatchID, ok := hub.lobbyToMatch[currentClient.LobbyID]
			activeMatch := hub.matches[activeMatchID]
			if !ok || activeMatch == nil {
				hub.mu.Unlock()
				continue
			}
			if GetGameEngine(activeMatch.ID) != nil {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Game sedang berlangsung"))
				continue
			}

			rounds := payload.Rounds
			if rounds < 1 {
				rounds = 1
			} else if rounds > 10 {
				rounds = 10
			}
			activeMatch.PendingGameType = payload.GameType
			activeMatch.PendingRounds = rounds
			activeMatch.PendingInviterLobbyID = currentClient.LobbyID

			otherLobby := activeMatch.LobbyA
			if otherLobby.ID == currentClient.LobbyID {
				otherLobby = activeMatch.LobbyB
			}
			otherOwner := hub.clients[otherLobby.OwnerID]
			senderID := currentClient.ID
			senderName := currentClient.Username
			matchID := activeMatch.ID
			hub.mu.Unlock()

			if otherOwner != nil {
				_ = otherOwner.Send(map[string]interface{}{
					"event": "GAME_INVITE_RECEIVED",
					"payload": map[string]interface{}{
						"senderId":   senderID,
						"senderName": senderName,
						"sessionId":  matchID,
						"gameType":   payload.GameType,
						"rounds":     rounds,
					},
				})
			}

		case "GAME_ACCEPT":
			if !rl.control.Allow() {
				continue
			}
			var payload GameAcceptPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Only the Host can accept games"))
				continue
			}
			activeMatchID := hub.lobbyToMatch[currentClient.LobbyID]
			match, exists := hub.matches[activeMatchID]
			if !exists || (payload.SessionID != "" && payload.SessionID != activeMatchID) {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Unauthorized GAME_ACCEPT"))
				continue
			}
			if match.PendingGameType == "" || match.PendingInviterLobbyID == currentClient.LobbyID {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("No pending invite from partner"))
				continue
			}
			gameType := match.PendingGameType
			rounds := match.PendingRounds
			if rounds < 1 {
				rounds = 1
			}
			match.PendingGameType = ""
			match.PendingRounds = 0
			match.PendingInviterLobbyID = ""
			hub.mu.Unlock()

			hub.broadcastEventToMatch(activeMatchID, "GAME_START", map[string]interface{}{
				"sessionId": activeMatchID,
				"gameType":  gameType,
				"rounds":    rounds,
			})

			switch gameType {
			case "guess_drawing":
				StartGameWithRounds(hub, activeMatchID, rounds)
			case "chess":
				StartChessServer(hub, activeMatchID)
			case "ludo":
				StartLudoServer(hub, activeMatchID)
			case "uno":
				StartUnoServer(hub, activeMatchID)
			}

		case "GAME_DECLINE":
			if !rl.control.Allow() {
				continue
			}
			var payload GameDeclinePayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" {
				hub.mu.Unlock()
				continue
			}
			activeMatchID := hub.lobbyToMatch[currentClient.LobbyID]
			match, exists := hub.matches[activeMatchID]
			if !exists || (payload.SessionID != "" && payload.SessionID != activeMatchID) {
				hub.mu.Unlock()
				continue
			}
			if match.PendingGameType == "" || match.PendingInviterLobbyID == currentClient.LobbyID {
				hub.mu.Unlock()
				continue
			}
			match.PendingGameType = ""
			match.PendingRounds = 0
			match.PendingInviterLobbyID = ""
			hub.mu.Unlock()

			hub.broadcastEventToMatch(activeMatchID, "GAME_DECLINED", map[string]interface{}{})

		case "GAME_STOP":
			if !rl.control.Allow() {
				continue
			}
			var payload GameAcceptPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Only the Host can stop games"))
				continue
			}
			activeMatchID := hub.lobbyToMatch[currentClient.LobbyID]
			match, exists := hub.matches[activeMatchID]
			if !exists || (payload.SessionID != "" && payload.SessionID != activeMatchID) {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Unauthorized GAME_STOP"))
				continue
			}
			for _, m := range match.LobbyA.Members {
				m.Presence = "ONLINE"
			}
			for _, m := range match.LobbyB.Members {
				m.Presence = "ONLINE"
			}
			hub.mu.Unlock()

			StopBoardGames(activeMatchID)
			if ge := GetGameEngine(activeMatchID); ge != nil {
				ge.Stop()
				enginesMu.Lock()
				if engines[activeMatchID] == ge {
					delete(engines, activeMatchID)
				}
				enginesMu.Unlock()
			}
			hub.broadcastEventToMatch(activeMatchID, "GAME_END", map[string]interface{}{})

		case "GAME_ACTION":
			if !rl.control.Allow() {
				continue
			}
			var actionPayload map[string]interface{}
			if err := json.Unmarshal(msg.Payload, &actionPayload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid game action payload"))
				continue
			}

			hub.mu.RLock()
			myID := currentClient.ID
			myLobbyID := currentClient.LobbyID
			activeMatchID := hub.lobbyToMatch[myLobbyID]
			hub.mu.RUnlock()

			if activeMatchID != "" {
				gameName, _ := actionPayload["game"].(string)
				switch gameName {
				case "chess":
					HandleChessAction(hub, activeMatchID, myLobbyID, actionPayload)
				case "ludo":
					HandleLudoAction(hub, activeMatchID, myLobbyID, actionPayload)
				case "uno":
					HandleUnoAction(hub, activeMatchID, myID, actionPayload)
				default:
					actionPayload["senderId"] = myID
					hub.broadcastEventToMatch(activeMatchID, "GAME_ACTION", actionPayload)
				}
			}

		case "CANVAS_START", "CANVAS_MOVE", "CANVAS_END":
			if !rl.canvas.Allow() {
				continue
			}
			hub.mu.RLock()
			myID := currentClient.ID
			activeMatchID := hub.lobbyToMatch[currentClient.LobbyID]
			hub.mu.RUnlock()

			if activeMatchID == "" {
				continue
			}
			ge := GetGameEngine(activeMatchID)
			if ge == nil {
				continue
			}
			ge.mu.RLock()
			isDrawer := ge.State.CurrentDrawerID == myID
			ge.mu.RUnlock()
			if !isDrawer {
				continue
			}

			var canvasPayload interface{}
			if err := json.Unmarshal(msg.Payload, &canvasPayload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid canvas payload"))
				continue
			}
			ge.AppendCanvasEvent(map[string]interface{}{
				"event":   msg.Event,
				"payload": canvasPayload,
			})
			hub.broadcastEventToMatchExcept(activeMatchID, myID, msg.Event, canvasPayload)

		case "GUESS_SUBMIT":
			if !rl.chat.Allow() {
				continue
			}
			hub.mu.RLock()
			myID := currentClient.ID
			myName := currentClient.Username
			activeMatchID := hub.lobbyToMatch[currentClient.LobbyID]
			hub.mu.RUnlock()

			if activeMatchID != "" {
				StopBoardGames(activeMatchID)
			if ge := GetGameEngine(activeMatchID); ge != nil {
					var submitPayload struct {
						GuessText string `json:"guessText"`
					}
					if err := json.Unmarshal(msg.Payload, &submitPayload); err == nil {
						cleaned := SanitizeText(submitPayload.GuessText, 64)
						if cleaned != "" {
							ge.SubmitGuess(myID, myName, cleaned)
						}
					}
				}
			}

		case "CHAT_MESSAGE":
			if !rl.chat.Allow() {
				_ = currentClient.Send(errorMsg("Terlalu cepat mengirim pesan."))
				continue
			}
			var chatPayload ChatMessagePayload
			if err := json.Unmarshal(msg.Payload, &chatPayload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}
			cleanedText := SanitizeText(chatPayload.Text, 200)
			if cleanedText == "" {
				continue
			}

			hub.mu.RLock()
			myID := currentClient.ID
			myName := currentClient.Username
			myLobbyID := currentClient.LobbyID
			matchID := hub.lobbyToMatch[myLobbyID]
			hub.mu.RUnlock()

			if myLobbyID == "" {
				continue
			}

			chatMsg := map[string]interface{}{
				"id":         fmt.Sprintf("msg-%d", time.Now().UnixNano()),
				"senderId":   myID,
				"senderName": myName,
				"text":       cleanedText,
				"side":       "left",
				"timestamp":  time.Now().Format("15:04"),
			}

			if matchID != "" {
				hub.broadcastEventToMatch(matchID, "CHAT_MESSAGE", chatMsg)
			} else {
				hub.broadcastEventToLobby(myLobbyID, "CHAT_MESSAGE", chatMsg)
			}

		case "MUTE_USER":
			if !rl.control.Allow() {
				continue
			}
			var mutePayload MuteUserPayload
			if err := json.Unmarshal(msg.Payload, &mutePayload); err != nil {
				_ = currentClient.Send(errorMsg("Invalid payload"))
				continue
			}

			hub.mu.Lock()
			if !currentClient.IsLobbyOwner || currentClient.LobbyID == "" {
				hub.mu.Unlock()
				_ = currentClient.Send(errorMsg("Only the Host can mute users"))
				continue
			}
			myLobbyID := currentClient.LobbyID
			activeMatchID := hub.lobbyToMatch[myLobbyID]
			var allowed bool
			if targetClient, exists := hub.clients[mutePayload.TargetUserID]; exists {
				if targetClient.LobbyID == myLobbyID {
					allowed = true
				} else if activeMatchID != "" {
					if m, mOk := hub.matches[activeMatchID]; mOk && isUserInMatchLocked(m, mutePayload.TargetUserID) {
						allowed = true
					}
				}
				if allowed {
					targetClient.IsMuted = mutePayload.IsMuted
				}
			}
			hub.mu.Unlock()

			if allowed {
				payload := map[string]interface{}{
					"userId":  mutePayload.TargetUserID,
					"isMuted": mutePayload.IsMuted,
				}
				if activeMatchID != "" {
					hub.broadcastEventToMatch(activeMatchID, "MUTE_UPDATE", payload)
				} else {
					hub.broadcastEventToLobby(myLobbyID, "MUTE_UPDATE", payload)
				}
			}

		case "RETURN_TO_LOBBY":
			if !rl.control.Allow() {
				continue
			}
			hub.mu.RLock()
			isOwner := currentClient.IsLobbyOwner
			lobbyID := currentClient.LobbyID
			myID := currentClient.ID
			hub.mu.RUnlock()

			if !isOwner || lobbyID == "" {
				_ = currentClient.Send(errorMsg("Only the Host can return to lobby"))
				continue
			}

			activeMatchID, otherLobbyID := cleanupMatchForLobby(hub, lobbyID)
			if otherLobbyID != "" {
				hub.broadcastEventToLobby(otherLobbyID, "MATCH_LEFT", map[string]interface{}{})
				hub.broadcastEventToLobby(otherLobbyID, "PRESENCE_UPDATE", map[string]interface{}{
					"frameId":  otherLobbyID,
					"presence": "MATCHING",
				})
				hub.AddToMatchmaking(otherLobbyID)
			}
			if db != nil && activeMatchID != "" {
				go func(lID, uID string) {
					_ = UpdateLobbyStatus(lID, "WAITING")
					_ = UpsertUserPresence(uID, "ONLINE", "")
				}(lobbyID, myID)
			}

			hub.mu.Lock()
			newQueue := make([]*Lobby, 0, len(hub.waitingQueue))
			for _, waitingLobby := range hub.waitingQueue {
				if waitingLobby.ID != lobbyID {
					newQueue = append(newQueue, waitingLobby)
				}
			}
			hub.waitingQueue = newQueue

			if lobby, exists := hub.lobbies[lobbyID]; exists {
				lobby.Status = "WAITING"
				lobby.LastActivity = time.Now()
				for _, member := range lobby.Members {
					member.Presence = "ONLINE"
				}
			}
			hub.mu.Unlock()

			hub.broadcastEventToLobby(lobbyID, "LOBBY_RETURNED", map[string]interface{}{
				"frameId": lobbyID,
			})

		default:
			slog.Debug("Unknown message event", "event", SanitizeText(msg.Event, 32))
		}
	}
}

func errorMsg(msg string) map[string]interface{} {
	return map[string]interface{}{
		"event": "ERROR",
		"payload": map[string]interface{}{
			"error": msg,
		},
	}
}

func sendResponse(ws *websocket.Conn, data interface{}) error {
	if val, ok := connClients.Load(ws); ok {
		if client, ok := val.(*Client); ok {
			return client.Send(data)
		}
	}
	return nil
}

func sendError(ws *websocket.Conn, errStr string) error {
	return sendResponse(ws, errorMsg(errStr))
}
