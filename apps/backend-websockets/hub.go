package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	Conn       *websocket.Conn
	ID         string
	LobbyID    string
	Username   string
	IsLobbyOwner bool
}

type Lobby struct {
	ID          string
	OwnerID     string
	InviteCode  string
	Status      string // waiting, matched, closed
	Members     map[string]*Client
	CreatedAt   time.Time
}

type Match struct {
	ID         string
	LobbyA     *Lobby
	LobbyB     *Lobby
	CreatedAt  time.Time
	EndedAt    *time.Time
}

type GameMessage struct {
	Type      string `json:"type"`
	Game      string `json:"game,omitempty"`
	Move      string `json:"move,omitempty"`
	Score     int    `json:"score,omitempty"`
	Sender    string `json:"sender,omitempty"`
	Data      interface{} `json:"data,omitempty"`
}

type Hub struct {
	clients       map[string]*Client
	lobbies       map[string]*Lobby
	inviteCodes   map[string]string // invite_code -> lobby_id
	waitingQueue  []*Lobby
	matches       map[string]*Match
	mu            sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:     make(map[string]*Client),
		lobbies:     make(map[string]*Lobby),
		inviteCodes: make(map[string]string),
		waitingQueue: make([]*Lobby, 0),
		matches:     make(map[string]*Match),
	}
}

func (h *Hub) generateInviteCode() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	for {
		code := ""
		for i := 0; i < 8; i++ {
			code += string(chars[rand.Intn(len(chars))])
		}
		h.mu.RLock()
		_, exists := h.inviteCodes[code]
		h.mu.RUnlock()
		if !exists {
			return code
		}
	}
}

func (h *Hub) CreateLobby(ownerID, username string) *Lobby {
	h.mu.Lock()
	defer h.mu.Unlock()

	lobbyID := fmt.Sprintf("lobby-%d", time.Now().UnixNano())
	inviteCode := h.generateInviteCode()

	lobby := &Lobby{
		ID:         lobbyID,
		OwnerID:    ownerID,
		InviteCode: inviteCode,
		Status:     "waiting",
		Members:    make(map[string]*Client),
		CreatedAt:  time.Now(),
	}

	h.lobbies[lobbyID] = lobby
	h.inviteCodes[inviteCode] = lobbyID

	return lobby
}

func (h *Hub) JoinLobby(lobbyID, userID, username string, client *Client) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	lobby, exists := h.lobbies[lobbyID]
	if !exists {
		return fmt.Errorf("lobby not found")
	}

	if lobby.Status != "waiting" {
		return fmt.Errorf("lobby is not accepting new members")
	}

	client.LobbyID = lobbyID
	client.Username = username
	client.IsLobbyOwner = (userID == lobby.OwnerID)

	lobby.Members[userID] = client
	h.clients[userID] = client

	return nil
}

func (h *Hub) JoinByInviteCode(inviteCode, userID, username string, client *Client) error {
	h.mu.RLock()
	lobbyID, exists := h.inviteCodes[inviteCode]
	h.mu.RUnlock()

	if !exists {
		return fmt.Errorf("invalid invite code")
	}

	return h.JoinLobby(lobbyID, userID, username, client)
}

func (h *Hub) LeaveLobby(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, exists := h.clients[userID]
	if !exists {
		return
	}

	if client.LobbyID != "" {
		lobby, exists := h.lobbies[client.LobbyID]
		if exists {
			delete(lobby.Members, userID)

			// If lobby is empty, delete it
			if len(lobby.Members) == 0 {
				delete(h.lobbies, client.LobbyID)
				delete(h.inviteCodes, lobby.InviteCode)
			}
		}
	}

	delete(h.clients, userID)
}

func (h *Hub) AddToMatchmaking(lobbyID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	lobby, exists := h.lobbies[lobbyID]
	if !exists || lobby.Status != "waiting" {
		return
	}

	// Check if there's a waiting lobby to match with
	for i, waitingLobby := range h.waitingQueue {
		if waitingLobby.ID != lobbyID && waitingLobby.Status == "waiting" {
			// Match found!
			h.createMatch(lobby, waitingLobby)
			h.waitingQueue = append(h.waitingQueue[:i], h.waitingQueue[i+1:]...)
			return
		}
	}

	// No match found, add to queue
	h.waitingQueue = append(h.waitingQueue, lobby)
}

func (h *Hub) createMatch(lobbyA, lobbyB *Lobby) {
	matchID := fmt.Sprintf("match-%d", time.Now().UnixNano())

	match := &Match{
		ID:        matchID,
		LobbyA:    lobbyA,
		LobbyB:    lobbyB,
		CreatedAt: time.Now(),
	}

	lobbyA.Status = "matched"
	lobbyB.Status = "matched"

	h.matches[matchID] = match

	// Notify all members in both lobbies
	h.broadcastToLobby(lobbyA.ID, map[string]interface{}{
		"type":    "MATCHED",
		"matchID": matchID,
		"role":    "A",
	})

	h.broadcastToLobby(lobbyB.ID, map[string]interface{}{
		"type":    "MATCHED",
		"matchID": matchID,
		"role":    "B",
	})
}

func (h *Hub) broadcastToLobby(lobbyID string, message interface{}) {
	lobby, exists := h.lobbies[lobbyID]
	if !exists {
		return
	}

	data, _ := json.Marshal(message)
	for _, client := range lobby.Members {
		if client.Conn.WriteMessage(websocket.TextMessage, data) == nil {
			// Message sent successfully
		}
	}
}

func (h *Hub) HandleGameMessage(userID string, msg GameMessage) {
	h.mu.RLock()
	client, exists := h.clients[userID]
	h.mu.RUnlock()

	if !exists || client.LobbyID == "" {
		return
	}

	lobby, exists := h.lobbies[client.LobbyID]
	if !exists {
		return
	}

	// Broadcast game message to all members in the lobby
	msg.Sender = userID
	data, _ := json.Marshal(msg)

	for _, member := range lobby.Members {
		if member.ID != userID {
			member.Conn.WriteMessage(websocket.TextMessage, data)
		}
	}
}