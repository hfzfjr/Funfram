package main

import (
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

type ClientMessage struct {
	Type       string      `json:"type"`
	UserID     string      `json:"userId,omitempty"`
	Username   string      `json:"username,omitempty"`
	LobbyID    string      `json:"lobbyId,omitempty"`
	InviteCode string      `json:"inviteCode,omitempty"`
	Game       string      `json:"game,omitempty"`
	Move       string      `json:"move,omitempty"`
	Data       interface{} `json:"data,omitempty"`
}

func handleConnections(hub *Hub, ws *websocket.Conn) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("❌ PANIC in handleConnections: %v\n", r)
		}
	}()

	// Membuat client baru
	userID := fmt.Sprintf("user-%d", time.Now().UnixNano())
	client := &Client{
		Conn:     ws,
		ID:       userID,
		LobbyID:  "",
		Username: "",
	}

	fmt.Printf("✅ New WebSocket connection: %s from %s\n", userID, ws.RemoteAddr())

	defer func() {
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

		fmt.Printf("📨 Raw message from %s: %s\n", userID, string(message))

		// Parse message
		var msg ClientMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			fmt.Printf("❌ Error parsing message: %v\n", err)
			continue
		}

		fmt.Printf("Pesan dari %s: %s\n", userID, msg.Type)

		// Handle different message types
		switch msg.Type {
		case "CREATE_LOBBY":
			fmt.Printf("🎯 CREATE_LOBBY from %s (username: %s)\n", userID, msg.Username)

			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("❌ PANIC in CREATE_LOBBY: %v\n", r)
					sendError(ws, "Internal server error")
				}
			}()

			lobby := hub.CreateLobby(userID, msg.Username)
			if lobby == nil {
				fmt.Printf("❌ CreateLobby returned nil\n")
				sendError(ws, "Failed to create lobby")
				continue
			}
			fmt.Printf("✅ Lobby created: %s with code %s\n", lobby.ID, lobby.InviteCode)

			err := hub.JoinLobby(lobby.ID, userID, msg.Username, client)
			if err != nil {
				fmt.Printf("❌ JoinLobby error: %v\n", err)
				sendError(ws, err.Error())
				continue
			}
			fmt.Printf("✅ JoinLobby successful\n")

			response := map[string]interface{}{
				"type":       "LOBBY_CREATED",
				"lobbyId":    lobby.ID,
				"inviteCode": lobby.InviteCode,
			}
			fmt.Printf("📤 Sending response: %+v\n", response)
			err = sendResponse(ws, response)
			if err != nil {
				fmt.Printf("❌ sendResponse error: %v\n", err)
			} else {
				fmt.Printf("✅ Response sent successfully\n")
			}

		case "JOIN_LOBBY":
			if msg.LobbyID != "" {
				err := hub.JoinLobby(msg.LobbyID, userID, msg.Username, client)
				if err != nil {
					sendError(ws, err.Error())
					continue
				}
				sendResponse(ws, map[string]interface{}{
					"type":    "LOBBY_JOINED",
					"lobbyId": msg.LobbyID,
				})
			} else if msg.InviteCode != "" {
				err := hub.JoinByInviteCode(msg.InviteCode, userID, msg.Username, client)
				if err != nil {
					sendError(ws, err.Error())
					continue
				}
				sendResponse(ws, map[string]interface{}{
					"type":    "LOBBY_JOINED",
					"lobbyId": client.LobbyID,
				})
			}

		case "START_MATCHMAKING":
			if client.LobbyID == "" {
				sendError(ws, "Not in a lobby")
				continue
			}
			hub.AddToMatchmaking(client.LobbyID)
			sendResponse(ws, map[string]interface{}{
				"type": "SEARCHING",
			})

		case "GAME_MOVE":
			gameMsg := GameMessage{
				Type: msg.Type,
				Game: msg.Game,
				Move: msg.Move,
				Data: msg.Data,
			}
			hub.HandleGameMessage(userID, gameMsg)

		case "LEAVE_LOBBY":
			hub.LeaveLobby(userID)
			sendResponse(ws, map[string]interface{}{
				"type": "LEFT_LOBBY",
			})

		default:
			fmt.Printf("Unknown message type: %s\n", msg.Type)
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
		"type":  "ERROR",
		"error": errorMsg,
	})
}
