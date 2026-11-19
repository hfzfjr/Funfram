package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 5 * time.Second
	pongWait       = 45 * time.Second
	pingPeriod     = 15 * time.Second
	sendBufferSize = 128
)

type Client struct {
	Conn            *websocket.Conn  `json:"-"`
	ID              string           `json:"id"`
	LobbyID         string           `json:"-"`
	Username        string           `json:"name"`
	IsLobbyOwner    bool             `json:"isOwner"`
	IsMuted         bool             `json:"isMuted"`
	IsCameraOff     bool             `json:"isCameraOff"`
	Presence        string           `json:"presence"` // ONLINE, MATCHING, PLAYING, DRAWING, GUESSING, RECONNECTING, IDLE, OFFLINE
	JoinOrder       int              `json:"joinOrder"`
	LastNextClick   time.Time        `json:"-"`
	LastReportClick time.Time        `json:"-"`
	BlockedUsers    map[string]bool  `json:"-"`
	ExplicitLeave   bool             `json:"-"`
	DisconnectTimer *time.Timer      `json:"-"`
	SessionToken    string           `json:"-"`
	RateLimiter     *ConnRateLimiter `json:"-"`

	sendMu    sync.RWMutex
	sendCh    chan []byte
	done      chan struct{}
	closeOnce sync.Once
}

func NewClient(ws *websocket.Conn, userID string) *Client {
	return &Client{
		Conn:         ws,
		ID:           userID,
		Presence:     "OFFLINE",
		BlockedUsers: make(map[string]bool),
		RateLimiter:  NewConnRateLimiter(),
		sendCh:       make(chan []byte, sendBufferSize),
		done:         make(chan struct{}),
	}
}

// snapshot returns a value copy safe to marshal after releasing hub.mu.
func (c *Client) snapshot() *Client {
	return &Client{
		ID:           c.ID,
		Username:     c.Username,
		IsLobbyOwner: c.IsLobbyOwner,
		IsMuted:      c.IsMuted,
		IsCameraOff:  c.IsCameraOff,
		Presence:     c.Presence,
		JoinOrder:    c.JoinOrder,
	}
}

func (c *Client) Send(message interface{}) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}

	c.sendMu.RLock()
	ch := c.sendCh
	done := c.done
	c.sendMu.RUnlock()

	if ch == nil || done == nil {
		return errors.New("client not initialized")
	}

	select {
	case <-done:
		return errors.New("client closed")
	case ch <- data:
		return nil
	default:
		return errors.New("client send buffer full")
	}
}

func (c *Client) closeCurrentTransport() *websocket.Conn {
	c.sendMu.Lock()
	ws := c.Conn
	if c.done != nil {
		c.closeOnce.Do(func() {
			close(c.done)
		})
	}
	c.sendMu.Unlock()
	if ws != nil {
		_ = ws.Close()
	}
	return ws
}

func (c *Client) reattachTransport(ws *websocket.Conn) *websocket.Conn {
	c.sendMu.Lock()
	oldWS := c.Conn
	if c.done != nil {
		c.closeOnce.Do(func() {
			close(c.done)
		})
	}
	c.Conn = ws
	c.sendCh = make(chan []byte, sendBufferSize)
	c.done = make(chan struct{})
	c.closeOnce = sync.Once{}
	c.RateLimiter = NewConnRateLimiter()
	ch := c.sendCh
	done := c.done
	c.sendMu.Unlock()

	if oldWS != nil && oldWS != ws {
		_ = oldWS.Close()
	}
	go writePump(ws, ch, done)
	return oldWS
}

func (c *Client) StartWritePump() {
	c.sendMu.RLock()
	ws := c.Conn
	ch := c.sendCh
	done := c.done
	c.sendMu.RUnlock()
	if ws != nil {
		go writePump(ws, ch, done)
	}
}

func writePump(ws *websocket.Conn, sendCh <-chan []byte, done <-chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = ws.Close()
		if r := recover(); r != nil {
			slog.Error("panic in writePump", "recover", r)
		}
	}()

	for {
		select {
		case <-done:
			return
		case msg := <-sendCh:
			_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

type Lobby struct {
	ID               string
	OwnerID          string
	InviteCode       string
	Status           string // WAITING, MATCHING, MATCHED, PLAYING, CLOSED
	Members          map[string]*Client
	Interests        []string
	CreatedAt        time.Time
	LastActivity     time.Time
	LastMatchLobbyID string
}

type Frame struct {
	ID      string    `json:"id"`
	OwnerID string    `json:"ownerId"`
	Members []*Client `json:"members"`
}

type Session struct {
	SessionID      string    `json:"sessionId"`
	FrameA         Frame     `json:"frameA"`
	FrameB         Frame     `json:"frameB"`
	CreatedAt      string    `json:"createdAt"`
	State          string    `json:"state"`
	CurrentGame    *string   `json:"currentGame"`
	Players        []*Client `json:"players"`
	Events         []string  `json:"events"`
	SignalingToken string    `json:"signalingToken,omitempty"`
	TurnToken      string    `json:"turnToken,omitempty"`
}

type Match struct {
	ID                    string
	LobbyA                *Lobby
	LobbyB                *Lobby
	PendingGameType       string
	PendingRounds         int
	PendingInviterLobbyID string
	CreatedAt             time.Time
	EndedAt               *time.Time
}

func (l *Lobby) ToFrame() Frame {
	membersList := make([]*Client, 0, len(l.Members))
	for _, m := range l.Members {
		if m != nil {
			membersList = append(membersList, m.snapshot())
		}
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

	players := make([]*Client, 0, len(frameA.Members)+len(frameB.Members))
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
	lobbyToMatch map[string]string
	mu           sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:      make(map[string]*Client),
		lobbies:      make(map[string]*Lobby),
		inviteCodes:  make(map[string]string),
		waitingQueue: make([]*Lobby, 0),
		matches:      make(map[string]*Match),
		lobbyToMatch: make(map[string]string),
	}
}

func (h *Hub) generateInviteCode() string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.generateInviteCodeLocked()
}

func (h *Hub) generateInviteCodeLocked() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	maxIdx := big.NewInt(int64(len(chars)))
	for {
		buf := make([]byte, 8)
		for i := 0; i < 8; i++ {
			n, err := rand.Int(rand.Reader, maxIdx)
			if err != nil {
				buf[i] = chars[i]
			} else {
				buf[i] = chars[n.Int64()]
			}
		}
		code := string(buf)
		if _, exists := h.inviteCodes[code]; !exists {
			return code
		}
	}
}

func (h *Hub) CreateLobby(ownerID, username string) *Lobby {
	h.mu.Lock()
	defer h.mu.Unlock()

	lobbyID := fmt.Sprintf("lobby-%s", generateTempID())
	inviteCode := h.generateInviteCodeLocked()

	lobby := &Lobby{
		ID:               lobbyID,
		OwnerID:          ownerID,
		InviteCode:       inviteCode,
		Status:           "WAITING",
		Members:          make(map[string]*Client),
		CreatedAt:        time.Now(),
		LastActivity:     time.Now(),
		LastMatchLobbyID: "",
	}

	h.lobbies[lobbyID] = lobby
	h.inviteCodes[inviteCode] = lobbyID

	return lobby
}

func (h *Hub) JoinLobby(lobbyID, userID, username string, client *Client) error {
	h.mu.Lock()

	lobby, exists := h.lobbies[lobbyID]
	if !exists {
		h.mu.Unlock()
		return fmt.Errorf("lobby not found")
	}

	if len(lobby.Members) >= 2 {
		h.mu.Unlock()
		return fmt.Errorf("lobby is full")
	}

	if lobby.Status != "WAITING" {
		h.mu.Unlock()
		return fmt.Errorf("lobby is not accepting new members")
	}

	client.LobbyID = lobbyID
	client.Username = username
	client.IsLobbyOwner = (userID == lobby.OwnerID)
	client.Presence = "ONLINE"
	client.ExplicitLeave = false
	client.JoinOrder = len(lobby.Members) + 1
	lobby.LastActivity = time.Now()

	lobby.Members[userID] = client
	h.clients[userID] = client
	h.mu.Unlock()

	go h.BroadcastOnlineCount()
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

	client, exists := h.clients[userID]
	if !exists {
		h.mu.Unlock()
		return
	}

	lobbyID := client.LobbyID
	if lobbyID != "" {
		lobby, lobbyExists := h.lobbies[lobbyID]
		if lobbyExists {
			delete(lobby.Members, userID)

			if len(lobby.Members) == 0 {
				newQueue := make([]*Lobby, 0, len(h.waitingQueue))
				for _, waitingLobby := range h.waitingQueue {
					if waitingLobby.ID != lobbyID {
						newQueue = append(newQueue, waitingLobby)
					}
				}
				h.waitingQueue = newQueue
				delete(h.lobbies, lobbyID)
				delete(h.inviteCodes, lobby.InviteCode)
			}
		}
	}

	client.LobbyID = ""
	client.IsLobbyOwner = false
	client.Presence = "ONLINE"
	delete(h.clients, userID)
	h.mu.Unlock()

	go h.BroadcastOnlineCount()
}

func (h *Hub) GetOnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) BroadcastOnlineCount() {
	h.mu.RLock()
	count := len(h.clients)
	targets := make([]*Client, 0, count)
	for _, c := range h.clients {
		if c != nil {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	msg := map[string]interface{}{
		"event": "ONLINE_COUNT",
		"payload": map[string]interface{}{
			"count": count,
		},
	}
	for _, c := range targets {
		_ = c.Send(msg)
	}
}

func lobbiesShareInterest(a, b *Lobby) bool {
	if a == nil || b == nil || len(a.Interests) == 0 || len(b.Interests) == 0 {
		return false
	}
	set := make(map[string]bool, len(a.Interests))
	for _, tag := range a.Interests {
		set[tag] = true
	}
	for _, tag := range b.Interests {
		if set[tag] {
			return true
		}
	}
	return false
}

func lobbiesHaveMutualBlock(a, b *Lobby) bool {
	if a == nil || b == nil {
		return false
	}
	for _, mA := range a.Members {
		for _, mB := range b.Members {
			if (mA.BlockedUsers != nil && mA.BlockedUsers[mB.ID]) ||
				(mB.BlockedUsers != nil && mB.BlockedUsers[mA.ID]) {
				return true
			}
		}
	}
	return false
}

func (h *Hub) BlockUser(reporterID, targetID string) {
	if reporterID == "" || targetID == "" || reporterID == targetID {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	client, ok := h.clients[reporterID]
	if !ok {
		return
	}
	if client.BlockedUsers == nil {
		client.BlockedUsers = make(map[string]bool)
	}
	client.BlockedUsers[targetID] = true
}

func (h *Hub) AddToMatchmaking(lobbyID string) {
	type delivery struct {
		target *Client
		msg    interface{}
	}
	var deliveries []delivery

	h.mu.Lock()
	lobby, exists := h.lobbies[lobbyID]
	if !exists || (lobby.Status != "WAITING" && lobby.Status != "MATCHING") {
		h.mu.Unlock()
		return
	}

	lobby.LastActivity = time.Now()
	lobby.Status = "MATCHING"

	for _, member := range lobby.Members {
		member.Presence = "MATCHING"
		deliveries = append(deliveries, delivery{
			target: member,
			msg: map[string]interface{}{
				"event":   "MATCHMAKING_STARTED",
				"payload": map[string]interface{}{},
			},
		})
	}

	validAlternatives := 0
	for _, waitingLobby := range h.waitingQueue {
		if waitingLobby.ID != lobbyID &&
			(waitingLobby.Status == "WAITING" || waitingLobby.Status == "MATCHING") &&
			len(waitingLobby.Members) > 0 &&
			!lobbiesHaveMutualBlock(lobby, waitingLobby) &&
			!(lobby.LastMatchLobbyID == waitingLobby.ID || waitingLobby.LastMatchLobbyID == lobby.ID) {
			validAlternatives++
		}
	}

	var matchedPartner *Lobby
	matchedIdx := -1
	for pass := 0; pass < 2 && matchedPartner == nil; pass++ {
		requireInterestMatch := (pass == 0 && len(lobby.Interests) > 0)
		for i, waitingLobby := range h.waitingQueue {
			if waitingLobby.ID != lobbyID &&
				(waitingLobby.Status == "WAITING" || waitingLobby.Status == "MATCHING") &&
				len(waitingLobby.Members) > 0 &&
				!lobbiesHaveMutualBlock(lobby, waitingLobby) {
				if requireInterestMatch && !lobbiesShareInterest(lobby, waitingLobby) {
					continue
				}
				if validAlternatives >= 1 {
					if lobby.LastMatchLobbyID != "" && lobby.LastMatchLobbyID == waitingLobby.ID {
						continue
					}
					if waitingLobby.LastMatchLobbyID != "" && waitingLobby.LastMatchLobbyID == lobby.ID {
						continue
					}
				}
				matchedPartner = waitingLobby
				matchedIdx = i
				break
			}
		}
	}

	var matchDeliveries []delivery
	var createdMatchID string
	var lobbyAID, lobbyBID string

	if matchedPartner != nil {
		h.waitingQueue = append(h.waitingQueue[:matchedIdx], h.waitingQueue[matchedIdx+1:]...)
		// Also ensure current lobby isn't still in waitingQueue
		cleanQueue := make([]*Lobby, 0, len(h.waitingQueue))
		for _, w := range h.waitingQueue {
			if w.ID != lobbyID {
				cleanQueue = append(cleanQueue, w)
			}
		}
		h.waitingQueue = cleanQueue

		createdMatchID = generateTempID()
		match := &Match{
			ID:        createdMatchID,
			LobbyA:    lobby,
			LobbyB:    matchedPartner,
			CreatedAt: time.Now(),
		}
		lobby.Status = "MATCHED"
		matchedPartner.Status = "MATCHED"
		for _, c := range lobby.Members {
			c.Presence = "PLAYING"
		}
		for _, c := range matchedPartner.Members {
			c.Presence = "PLAYING"
		}
		h.matches[createdMatchID] = match
		h.lobbyToMatch[lobby.ID] = createdMatchID
		h.lobbyToMatch[matchedPartner.ID] = createdMatchID
		lobbyAID = lobby.ID
		lobbyBID = matchedPartner.ID

		baseSession := match.ToSession()
		for _, c := range lobby.Members {
			sCopy := baseSession
			sCopy.SignalingToken, _ = SignRoomToken(c.ID, createdMatchID, "signaling", 15*time.Minute)
			sCopy.TurnToken, _ = SignRoomToken(c.ID, createdMatchID, "turn", 15*time.Minute)
			matchDeliveries = append(matchDeliveries, delivery{
				target: c,
				msg: map[string]interface{}{
					"event":   "MATCH_FOUND",
					"payload": sCopy,
				},
			})
		}
		for _, c := range matchedPartner.Members {
			sCopy := baseSession
			sCopy.SignalingToken, _ = SignRoomToken(c.ID, createdMatchID, "signaling", 15*time.Minute)
			sCopy.TurnToken, _ = SignRoomToken(c.ID, createdMatchID, "turn", 15*time.Minute)
			matchDeliveries = append(matchDeliveries, delivery{
				target: c,
				msg: map[string]interface{}{
					"event":   "MATCH_FOUND",
					"payload": sCopy,
				},
			})
		}
	} else {
		alreadyQueued := false
		for _, existing := range h.waitingQueue {
			if existing.ID == lobbyID {
				alreadyQueued = true
				break
			}
		}
		if !alreadyQueued {
			h.waitingQueue = append(h.waitingQueue, lobby)
		}
	}
	h.mu.Unlock()

	for _, d := range deliveries {
		_ = d.target.Send(d.msg)
	}
	for _, d := range matchDeliveries {
		_ = d.target.Send(d.msg)
	}

	if createdMatchID != "" && db != nil {
		go func(mID, lA, lB string) {
			if _, err := CreateMatchDB(lA, lB); err != nil {
				slog.Warn("CreateMatchDB failed", "matchId", mID, "error", err)
			}
			_ = UpdateLobbyStatus(lA, "MATCHED")
			_ = UpdateLobbyStatus(lB, "MATCHED")
		}(createdMatchID, lobbyAID, lobbyBID)
	}
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
	if !exists {
		h.mu.RUnlock()
		return
	}
	members := make([]*Client, 0, len(match.LobbyA.Members)+len(match.LobbyB.Members))
	for _, c := range match.LobbyA.Members {
		members = append(members, c)
	}
	for _, c := range match.LobbyB.Members {
		members = append(members, c)
	}
	h.mu.RUnlock()

	msg := map[string]interface{}{
		"event":   event,
		"payload": payload,
	}
	for _, c := range members {
		_ = c.Send(msg)
	}
}

func (h *Hub) broadcastEventToMatchExcept(matchID, excludeUserID, event string, payload interface{}) {
	h.mu.RLock()
	match, exists := h.matches[matchID]
	if !exists {
		h.mu.RUnlock()
		return
	}
	members := make([]*Client, 0, len(match.LobbyA.Members)+len(match.LobbyB.Members))
	for _, c := range match.LobbyA.Members {
		if c.ID != excludeUserID {
			members = append(members, c)
		}
	}
	for _, c := range match.LobbyB.Members {
		if c.ID != excludeUserID {
			members = append(members, c)
		}
	}
	h.mu.RUnlock()

	msg := map[string]interface{}{
		"event":   event,
		"payload": payload,
	}
	for _, c := range members {
		_ = c.Send(msg)
	}
}

func (h *Hub) broadcastToLobby(lobbyID string, message interface{}) {
	h.mu.RLock()
	lobby, exists := h.lobbies[lobbyID]
	if !exists {
		h.mu.RUnlock()
		return
	}
	members := make([]*Client, 0, len(lobby.Members))
	for _, client := range lobby.Members {
		members = append(members, client)
	}
	h.mu.RUnlock()

	for _, client := range members {
		_ = client.Send(message)
	}
}

func (h *Hub) HandleGameMessage(userID string, msg GameMessage) {
	h.mu.RLock()
	client, exists := h.clients[userID]
	if !exists || client.LobbyID == "" {
		h.mu.RUnlock()
		return
	}

	lobby, exists := h.lobbies[client.LobbyID]
	if !exists {
		h.mu.RUnlock()
		return
	}

	members := make([]*Client, 0, len(lobby.Members))
	for _, member := range lobby.Members {
		if member.ID != userID {
			members = append(members, member)
		}
	}
	h.mu.RUnlock()

	msg.Sender = userID
	for _, member := range members {
		_ = member.Send(msg)
	}
}
