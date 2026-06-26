package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	Conn          *websocket.Conn `json:"-"`
	WriteMu       sync.Mutex      `json:"-"`
	ID            string          `json:"id"`
	LobbyID       string          `json:"-"`
	Username      string          `json:"name"`
	IsLobbyOwner  bool            `json:"isOwner"`
	IsMuted       bool            `json:"isMuted"`
	IsCameraOff   bool            `json:"isCameraOff"`
	Presence      string          `json:"presence"` // ONLINE, MATCHING, PLAYING, DRAWING, GUESSING, IDLE, OFFLINE
	JoinOrder     int             `json:"joinOrder"`
	LastNextClick time.Time       `json:"-"`
}

func (c *Client) Send(message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	c.WriteMu.Lock()
	defer c.WriteMu.Unlock()
	return c.Conn.WriteMessage(websocket.TextMessage, data)
}

type Lobby struct {
	ID         string
	OwnerID    string
	InviteCode string
	Status     string // WAITING, MATCHING, MATCHED, PLAYING, CLOSED
	Members    map[string]*Client
	CreatedAt  time.Time
}

type Frame struct {
	ID      string    `json:"id"`
	OwnerID string    `json:"ownerId"`
	Members []*Client `json:"members"`
}

type Session struct {
	SessionID   string    `json:"sessionId"`
	FrameA      Frame     `json:"frameA"`
	FrameB      Frame     `json:"frameB"`
	CreatedAt   string    `json:"createdAt"`
	State       string    `json:"state"`
	CurrentGame *string   `json:"currentGame"`
	Players     []*Client `json:"players"`
	Events      []string  `json:"events"`
}

type Match struct {
	ID        string
	LobbyA    *Lobby
	LobbyB    *Lobby
	CreatedAt time.Time
	EndedAt   *time.Time
}

func (l *Lobby) ToFrame() Frame {
	membersList := make([]*Client, 0)
	for _, m := range l.Members {
		membersList = append(membersList, m)
	}
	sort.Slice(membersList, func(i, j int) bool {
		return membersList[i].JoinOrder < membersList[j].JoinOrder
	})
	return Frame{
		ID:      l.ID,
		OwnerID: l.OwnerID,
		Members: membersList,
	}
}

func (m *Match) ToSession() Session {
	frameA := m.LobbyA.ToFrame()
	frameB := m.LobbyB.ToFrame()

	players := make([]*Client, 0)
	players = append(players, frameA.Members...)
	players = append(players, frameB.Members...)

	currentGame := "guess_drawing"
	return Session{
		SessionID:   m.ID,
		FrameA:      frameA,
		FrameB:      frameB,
		CreatedAt:   m.CreatedAt.Format(time.RFC3339),
		State:       "ActiveMeeting",
		CurrentGame: &currentGame,
		Players:     players,
		Events:      make([]string, 0),
	}
}

type GameMessage struct {
	Type   string      `json:"type"`
	Game   string      `json:"game,omitempty"`
	Move   string      `json:"move,omitempty"`
	Score  int         `json:"score,omitempty"`
	Sender string      `json:"sender,omitempty"`
	Data   interface{} `json:"data,omitempty"`
}

type Hub struct {
	clients      map[string]*Client
	lobbies      map[string]*Lobby
	inviteCodes  map[string]string // invite_code -> lobby_id
	waitingQueue []*Lobby
	matches      map[string]*Match
	mu           sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:      make(map[string]*Client),
		lobbies:      make(map[string]*Lobby),
		inviteCodes:  make(map[string]string),
		waitingQueue: make([]*Lobby, 0),
		matches:      make(map[string]*Match),
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
		Status:     "WAITING",
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

	if len(lobby.Members) >= 4 {
		return fmt.Errorf("lobby is full")
	}

	if lobby.Status != "WAITING" {
		return fmt.Errorf("lobby is not accepting new members")
	}

	client.LobbyID = lobbyID
	client.Username = username
	client.IsLobbyOwner = (userID == lobby.OwnerID)
	client.Presence = "ONLINE"
	client.JoinOrder = len(lobby.Members) + 1

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
				newQueue := make([]*Lobby, 0, len(h.waitingQueue))
				for _, waitingLobby := range h.waitingQueue {
					if waitingLobby.ID != client.LobbyID {
						newQueue = append(newQueue, waitingLobby)
					}
				}
				h.waitingQueue = newQueue
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
	if !exists || lobby.Status != "WAITING" {
		return
	}

	// Check if there's a waiting lobby to match with
	for i, waitingLobby := range h.waitingQueue {
		if waitingLobby.ID != lobbyID && waitingLobby.Status == "WAITING" {
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

	if db != nil {
		_, err := CreateMatchDB(lobbyA.ID, lobbyB.ID)
		if err != nil {
			fmt.Printf("Error creating match in DB: %v\n", err)
		}
		UpdateLobbyStatus(lobbyA.ID, "MATCHED")
		UpdateLobbyStatus(lobbyB.ID, "MATCHED")
	}

	match := &Match{
		ID:        matchID,
		LobbyA:    lobbyA,
		LobbyB:    lobbyB,
		CreatedAt: time.Now(),
	}

	lobbyA.Status = "MATCHED"
	lobbyB.Status = "MATCHED"

	for _, client := range lobbyA.Members {
		client.Presence = "PLAYING"
	}
	for _, client := range lobbyB.Members {
		client.Presence = "PLAYING"
	}

	h.matches[matchID] = match

	session := match.ToSession()

	h.broadcastToLobby(lobbyA.ID, map[string]interface{}{
		"event":   "MATCH_FOUND",
		"payload": session,
	})

	h.broadcastToLobby(lobbyB.ID, map[string]interface{}{
		"event":   "MATCH_FOUND",
		"payload": session,
	})
}

func (h *Hub) broadcastEventToLobby(lobbyID string, event string, payload interface{}) {
	h.broadcastToLobby(lobbyID, map[string]interface{}{
		"event":   event,
		"payload": payload,
	})
}

func (h *Hub) broadcastEventToMatch(matchID string, event string, payload interface{}) {
	h.mu.RLock()
	match, exists := h.matches[matchID]
	h.mu.RUnlock()
	if !exists {
		return
	}
	h.broadcastEventToLobby(match.LobbyA.ID, event, payload)
	h.broadcastEventToLobby(match.LobbyB.ID, event, payload)
}

func (h *Hub) broadcastToLobby(lobbyID string, message interface{}) {
	lobby, exists := h.lobbies[lobbyID]
	if !exists {
		return
	}

	for _, client := range lobby.Members {
		if client.Send(message) == nil {
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
	for _, member := range lobby.Members {
		if member.ID != userID {
			member.Send(msg)
		}
	}
}
