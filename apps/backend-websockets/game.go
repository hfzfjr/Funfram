package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

var (
	WordsPool = []string{"Apple", "Banana", "Cat", "Dog", "Elephant", "Flower", "Giraffe", "House", "Ice", "Jungle", "Kite", "Lemon", "Monkey", "Notebook", "Orange", "Penguin", "Queen", "Rabbit", "Sun", "Tree", "Umbrella", "Violin", "Water", "Xylophone", "Yacht", "Zebra"}

	engines   = make(map[string]*GameEngine)
	enginesMu sync.RWMutex
)

type GuessEvent struct {
	ID         string `json:"id"`
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
	Text       string `json:"text"`
	IsCorrect  bool   `json:"isCorrect"`
	Timestamp  string `json:"timestamp"`
}

type GuessDrawingState struct {
	CurrentRound    int            `json:"currentRound"`
	CurrentDrawerID string         `json:"currentDrawerId"`
	CurrentWord     string         `json:"currentWord"`
	WordHint        string         `json:"wordHint"`
	TimeRemaining   int            `json:"timeRemaining"`
	DrawTimer       int            `json:"drawTimer"`
	CanvasEvents    []interface{}  `json:"canvasEvents"`
	GuessEvents     []GuessEvent   `json:"guessEvents"`
	Score           map[string]int `json:"score"`
	Queue           []string       `json:"queue"`
	Winner          *string        `json:"winner"`
	Status          string         `json:"status"` // Waiting, Countdown, Drawing, Reveal, NextRound, Finished
}

type GameEngine struct {
	MatchID  string
	Hub      *Hub
	State    GuessDrawingState
	mu       sync.RWMutex
	stopChan chan struct{}
}

func StartGame(hub *Hub, matchID string) *GameEngine {
	enginesMu.Lock()
	defer enginesMu.Unlock()

	// Stop existing engine for this match if any
	if existing, ok := engines[matchID]; ok {
		close(existing.stopChan)
	}

	hub.mu.RLock()
	match, exists := hub.matches[matchID]
	hub.mu.RUnlock()

	if !exists {
		return nil
	}

	// Construct queue: alternating Frame A and Frame B players
	leftIds := make([]string, 0)
	for id := range match.LobbyA.Members {
		leftIds = append(leftIds, id)
	}
	rightIds := make([]string, 0)
	for id := range match.LobbyB.Members {
		rightIds = append(rightIds, id)
	}

	queue := make([]string, 0)
	maxLength := len(leftIds)
	if len(rightIds) > maxLength {
		maxLength = len(rightIds)
	}
	for i := 0; i < maxLength; i++ {
		if i < len(leftIds) {
			queue = append(queue, leftIds[i])
		}
		if i < len(rightIds) {
			queue = append(queue, rightIds[i])
		}
	}

	// Initialize scores
	scoreMap := make(map[string]int)
	for _, id := range queue {
		scoreMap[id] = 0
	}

	engine := &GameEngine{
		MatchID: matchID,
		Hub:     hub,
		State: GuessDrawingState{
			CurrentRound: 1,
			Score:        scoreMap,
			Queue:        queue,
			Status:       "Waiting",
		},
		stopChan: make(chan struct{}),
	}

	engines[matchID] = engine

	go engine.run()

	return engine
}

func GetGameEngine(matchID string) *GameEngine {
	enginesMu.RLock()
	defer enginesMu.RUnlock()
	return engines[matchID]
}

func (ge *GameEngine) run() {
	// 2 seconds Waiting period
	select {
	case <-time.After(2 * time.Second):
	case <-ge.stopChan:
		return
	}

	ge.runRound(0)
}

func (ge *GameEngine) runRound(queueIndex int) {
	ge.mu.Lock()
	if queueIndex >= len(ge.State.Queue) {
		ge.mu.Unlock()
		ge.finishGame()
		return
	}

	currentDrawerID := ge.State.Queue[queueIndex]

	ge.Hub.mu.RLock()
	// Check if drawer is still online
	_, exists := ge.Hub.clients[currentDrawerID]
	ge.Hub.mu.RUnlock()

	if !exists {
		ge.mu.Unlock()
		// Drawer is offline, skip
		ge.runRound(queueIndex + 1)
		return
	}

	// Pick random word
	secretWord := WordsPool[rand.Intn(len(WordsPool))]

	// Create word hint
	hintRunes := []rune(secretWord)
	hintStr := ""
	for i, r := range hintRunes {
		if i == 0 || i == len(hintRunes)-1 {
			hintStr += string(r) + " "
		} else {
			hintStr += "_ "
		}
	}
	if len(hintStr) > 0 {
		hintStr = hintStr[:len(hintStr)-1] // trim trailing space
	}

	// Update players presence states: DRAWING for drawer, GUESSING for others in session
	ge.Hub.mu.Lock()
	match, matchExists := ge.Hub.matches[ge.MatchID]
	if matchExists {
		for _, member := range match.LobbyA.Members {
			if member.ID == currentDrawerID {
				member.Presence = "DRAWING"
			} else {
				member.Presence = "GUESSING"
			}
		}
		for _, member := range match.LobbyB.Members {
			if member.ID == currentDrawerID {
				member.Presence = "DRAWING"
			} else {
				member.Presence = "GUESSING"
			}
		}
	}
	ge.Hub.mu.Unlock()

	ge.State.CurrentDrawerID = currentDrawerID
	ge.State.CurrentWord = secretWord
	ge.State.WordHint = hintStr
	ge.State.Status = "Countdown"
	ge.State.DrawTimer = 10
	ge.State.TimeRemaining = 60
	ge.State.CanvasEvents = make([]interface{}, 0)
	ge.State.Winner = nil
	ge.mu.Unlock()

	// Broadcast DRAW_START to all match members
	ge.broadcastDrawStart(currentDrawerID, secretWord, hintStr)

	// 10s Countdown loop
	for i := 9; i >= 0; i-- {
		select {
		case <-time.After(1 * time.Second):
			ge.mu.Lock()
			if ge.State.Status != "Countdown" {
				ge.mu.Unlock()
				return
			}
			ge.State.DrawTimer = i
			ge.mu.Unlock()
			ge.broadcastStateUpdate()
		case <-ge.stopChan:
			return
		}
	}

	// Transition to Drawing
	ge.mu.Lock()
	ge.State.Status = "Drawing"
	ge.mu.Unlock()
	ge.broadcastStateUpdate()

	// 60s Drawing timer loop
	for i := 59; i >= 0; i-- {
		select {
		case <-time.After(1 * time.Second):
			ge.mu.Lock()
			if ge.State.Status != "Drawing" {
				ge.mu.Unlock()
				return
			}
			ge.State.TimeRemaining = i
			ge.mu.Unlock()
			ge.broadcastStateUpdate()
		case <-ge.stopChan:
			return
		}
	}

	// If timer expires without correct guess
	ge.revealAnswer(queueIndex, "", 0)
}

func (ge *GameEngine) SubmitGuess(playerID, username, text string) {
	ge.mu.Lock()
	defer ge.mu.Unlock()

	if ge.State.Status != "Drawing" {
		return
	}

	if playerID == ge.State.CurrentDrawerID {
		return // Drawer cannot guess
	}

	// Check if guess is correct
	normalizedGuess := trimLower(text)
	normalizedSecret := trimLower(ge.State.CurrentWord)
	isCorrect := (normalizedGuess == normalizedSecret)

	guessEvent := GuessEvent{
		ID:         fmt.Sprintf("gss-%d", time.Now().UnixNano()),
		PlayerID:   playerID,
		PlayerName: username,
		Text:       text,
		IsCorrect:  isCorrect,
		Timestamp:  time.Now().Format("15:04:05"),
	}

	ge.State.GuessEvents = append(ge.State.GuessEvents, guessEvent)

	// Send GUESS_FEEDBACK to guesser
	ge.Hub.mu.RLock()
	client, exists := ge.Hub.clients[playerID]
	ge.Hub.mu.RUnlock()
	if exists {
		client.Send(map[string]interface{}{
			"event": "GUESS_FEEDBACK",
			"payload": map[string]interface{}{
				"correct": isCorrect,
			},
		})
	}

	// Broadcast the guess as chat message to all members of the match
	ge.broadcastToMatch("CHAT_MESSAGE", map[string]interface{}{
		"id":         guessEvent.ID,
		"senderId":   playerID,
		"senderName": username,
		"text":       fmt.Sprintf("Guesses: %s", text),
		"side":       "left",
		"timestamp":  time.Now().Format("15:04"),
	})

	if isCorrect {
		// Award points: guesser gets 100, drawer gets 50
		ge.State.Score[playerID] += 100
		ge.State.Score[ge.State.CurrentDrawerID] += 50

		// Extract queue index
		qIdx := -1
		for i, id := range ge.State.Queue {
			if id == ge.State.CurrentDrawerID {
				qIdx = i
				break
			}
		}

		// Reveal answer and stop drawing
		go ge.revealAnswer(qIdx, username, 100)
	}
}

func (ge *GameEngine) revealAnswer(queueIndex int, winnerName string, points int) {
	ge.mu.Lock()
	if ge.State.Status != "Drawing" && ge.State.Status != "Countdown" {
		ge.mu.Unlock()
		return
	}

	ge.State.Status = "Reveal"
	winnerVal := winnerName
	if winnerName == "" {
		ge.State.Winner = nil
	} else {
		ge.State.Winner = &winnerVal
	}
	secretWord := ge.State.CurrentWord
	ge.mu.Unlock()

	// Broadcast ROUND_END to all members in session
	ge.broadcastToMatch("ROUND_END", map[string]interface{}{
		"winnerId": winnerVal,
		"points":   points,
		"answer":   secretWord,
	})

	// Broadcast SCORE_UPDATE to all members in session
	ge.mu.Lock()
	scores := ge.State.Score
	ge.mu.Unlock()
	ge.broadcastToMatch("SCORE_UPDATE", map[string]interface{}{
		"scores": scores,
	})

	// Wait 3 seconds in Reveal state
	select {
	case <-time.After(3 * time.Second):
	case <-ge.stopChan:
		return
	}

	ge.mu.Lock()
	ge.State.Status = "NextRound"
	ge.State.CurrentRound++
	ge.mu.Unlock()
	ge.broadcastStateUpdate()

	// Wait 1 second in NextRound state before moving to next player
	select {
	case <-time.After(1 * time.Second):
	case <-ge.stopChan:
		return
	}

	ge.runRound(queueIndex + 1)
}

func (ge *GameEngine) finishGame() {
	ge.mu.Lock()
	ge.State.Status = "Finished"
	scores := ge.State.Score
	ge.mu.Unlock()

	ge.broadcastStateUpdate()

	// Update database leaderboard for all players if DB exists
	if db != nil {
		for pID, score := range scores {
			err := UpdateScore(pID, "guess_drawing", score)
			if err != nil {
				fmt.Printf("Error updating score in DB for user %s: %v\n", pID, err)
			}
		}
	}

	// Wait 5 seconds, then return players to matched state (ONLINE presence)
	select {
	case <-time.After(5 * time.Second):
	case <-ge.stopChan:
		return
	}

	ge.Hub.mu.Lock()
	match, matchExists := ge.Hub.matches[ge.MatchID]
	if matchExists {
		// Reset presences back to ONLINE
		for _, member := range match.LobbyA.Members {
			member.Presence = "ONLINE"
		}
		for _, member := range match.LobbyB.Members {
			member.Presence = "ONLINE"
		}
		// Reset statuses
		match.LobbyA.Status = "MATCHED"
		match.LobbyB.Status = "MATCHED"
	}
	ge.Hub.mu.Unlock()

	// Broadcast match restore and transition back to meeting layout
	ge.broadcastToMatch("GAME_END", map[string]interface{}{})

	// Update state in hub
	ge.Hub.mu.Lock()
	if matchExists {
		session := match.ToSession()
		ge.Hub.broadcastToLobby(match.LobbyA.ID, map[string]interface{}{
			"event":   "MATCH_FOUND",
			"payload": session,
		})
		ge.Hub.broadcastToLobby(match.LobbyB.ID, map[string]interface{}{
			"event":   "MATCH_FOUND",
			"payload": session,
		})
	}
	ge.Hub.mu.Unlock()

	// Remove engine from map
	enginesMu.Lock()
	delete(engines, ge.MatchID)
	enginesMu.Unlock()
}

func (ge *GameEngine) broadcastDrawStart(drawerID, secretWord, wordHint string) {
	ge.Hub.mu.RLock()
	match, exists := ge.Hub.matches[ge.MatchID]
	ge.Hub.mu.RUnlock()
	if !exists {
		return
	}

	// Drawer gets the full secret word, others get hint
	sendEventToClient := func(client *Client) {
		isDrawer := (client.ID == drawerID)
		word := secretWord
		if !isDrawer {
			word = ""
		}

		client.Send(map[string]interface{}{
			"event": "DRAW_START",
			"payload": map[string]interface{}{
				"drawerId":   drawerID,
				"secretWord": word,
				"wordHint":   wordHint,
				"timeLimit":  60,
			},
		})
	}

	for _, client := range match.LobbyA.Members {
		sendEventToClient(client)
	}
	for _, client := range match.LobbyB.Members {
		sendEventToClient(client)
	}
}

func (ge *GameEngine) broadcastStateUpdate() {
	ge.mu.RLock()
	state := ge.State
	ge.mu.RUnlock()

	// Hide secret word for non-drawers
	ge.Hub.mu.RLock()
	match, exists := ge.Hub.matches[ge.MatchID]
	ge.Hub.mu.RUnlock()
	if !exists {
		return
	}

	sendEventToClient := func(client *Client) {
		clientState := state
		if client.ID != state.CurrentDrawerID {
			clientState.CurrentWord = ""
		}

		client.Send(map[string]interface{}{
			"event":   "GAME_STATE_UPDATE",
			"payload": clientState,
		})
	}

	for _, client := range match.LobbyA.Members {
		sendEventToClient(client)
	}
	for _, client := range match.LobbyB.Members {
		sendEventToClient(client)
	}
}

func (ge *GameEngine) broadcastToMatch(event string, payload interface{}) {
	ge.Hub.broadcastEventToMatch(ge.MatchID, event, payload)
}

func trimLower(s string) string {
	importStr := ""
	for _, r := range s {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
			if r >= 'A' && r <= 'Z' {
				importStr += string(r + 32)
			} else {
				importStr += string(r)
			}
		}
	}
	return importStr
}
