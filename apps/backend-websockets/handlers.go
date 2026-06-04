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
	// Membuat client baru
	userID := fmt.Sprintf("user-%d", time.Now().UnixNano())
	client := &Client{
		Conn:     ws,
		ID:       userID,
		LobbyID:  "",
		Username: "",
	}

	defer func() {
		hub.LeaveLobby(userID)
		ws.Close()
		fmt.Printf("Klien putus: %s\n", userID)
	}()

	for {
		// Membaca pesan dari client
		_, message, err := ws.ReadMessage()
		if err != nil {
			fmt.Printf("Error reading message: %v\n", err)
			break
		}

		// Parse message
		var msg ClientMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			fmt.Printf("Error parsing message: %v\n", err)
			continue
		}

		fmt.Printf("Pesan dari %s: %s\n", userID, msg.Type)

		// Handle different message types
		switch msg.Type {
		case "CREATE_LOBBY":
			lobby := hub.CreateLobby(userID, msg.Username)
			err := hub.JoinLobby(lobby.ID, userID, msg.Username, client)
			if err != nil {
				sendError(ws, err.Error())
				continue
			}
			sendResponse(ws, map[string]interface{}{
				"type":       "LOBBY_CREATED",
				"lobbyId":    lobby.ID,
				"inviteCode": lobby.InviteCode,
			})

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
