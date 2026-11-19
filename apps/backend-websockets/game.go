package main

import (
	"crypto/rand"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"
)

var (
	WordsPool = []string{
		// Hewan
		"Kucing", "Anjing", "Gajah", "Jerapah", "Penguin", "Kelinci", "Zebra", "Monyet",
		"Singa", "Harimau", "Beruang", "Panda", "Lumba-lumba", "Hiu", "Paus", "Gurita",
		"Kupu-kupu", "Laba-laba", "Kura-kura", "Katak", "Bebek", "Ayam", "Sapi", "Kuda",
		"Ular", "Burung Hantu", "Elang", "Flamingo", "Kanguru", "Buaya", "Kambing", "Lebah",
		// Makanan & Minuman
		"Apel", "Pisang", "Lemon", "Jeruk", "Semangka", "Stroberi", "Nanas", "Mangga",
		"Pizza", "Burger", "Bakso", "Sate", "Mie Goreng", "Donat", "Kue", "Es Krim",
		"Biskuit", "Roti", "Keju", "Telur", "Kopi", "Popcorn", "Nasi Goreng", "Alpukat",
		// Benda Sehari-hari
		"Payung", "Kunci", "Jam Dinding", "Jam Tangan", "Kacamata", "Topi", "Sepatu", "Tas Ransel",
		"Buku", "Pensil", "Gunting", "Kamera", "Handphone", "Laptop", "Televisi", "Sapu",
		"Lampu", "Kursi", "Meja", "Kasur", "Pintu", "Jendela", "Cermin", "Sikat Gigi",
		"Botol", "Cangkir", "Sendok", "Garpu", "Pisau", "Lilin", "Balon", "Kado",
		// Alam & Luar Angkasa
		"Matahari", "Bulan", "Bintang", "Awan", "Hujan", "Pelangi", "Manusia Salju", "Gunung Berapi",
		"Gunung", "Pohon", "Bunga", "Kaktus", "Daun", "Sungai", "Pulau", "Pantai",
		"Api", "Petir", "Bumi", "Roket", "Astronot", "UFO", "Planet", "Ombak",
		// Transportasi & Tempat
		"Mobil", "Bus", "Kereta Api", "Pesawat", "Helikopter", "Sepeda", "Motor",
		"Perahu", "Kapal", "Kapal Selam", "Rumah", "Istana", "Tenda", "Jembatan", "Mercusuar",
		// Musik, Olahraga & Lainnya
		"Gitar", "Piano", "Biola", "Drum", "Mikrofon", "Headphone", "Mahkota",
		"Berlian", "Pedang", "Perisai", "Piala", "Bola Sepak", "Bola Basket", "Raket Tenis",
		"Layangan", "Skateboard", "Robot", "Hantu", "Naga", "Jangkar", "Kompas",
	}

	engines   = make(map[string]*GameEngine)
	enginesMu sync.RWMutex
)

func getWordPool() []string {
	if extra := strings.TrimSpace(os.Getenv("DRAWING_WORDS")); extra != "" {
		parts := strings.Split(extra, ",")
		pool := make([]string, 0, len(WordsPool)+len(parts))
		pool = append(pool, WordsPool...)
		for _, p := range parts {
			if w := strings.TrimSpace(p); w != "" {
				pool = append(pool, w)
			}
		}
		return pool
	}
	return WordsPool
}

func cryptoRandIntn(n int) int {
	if n <= 1 {
		return 0
	}
	v, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		return 0
	}
	return int(v.Int64())
}

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

type roundWinner struct {
	playerID   string
	playerName string
	points     int
}

type GameEngine struct {
	MatchID    string
	Hub        *Hub
	State      GuessDrawingState
	UsedWords  map[string]bool
	mu         sync.RWMutex
	stopChan   chan struct{}
	stopOnce   sync.Once
	roundWinCh chan roundWinner
}

func (ge *GameEngine) Stop() {
	ge.stopOnce.Do(func() {
		close(ge.stopChan)
	})
}

func (ge *GameEngine) AppendCanvasEvent(ev interface{}) {
	ge.mu.Lock()
	defer ge.mu.Unlock()
	if len(ge.State.CanvasEvents) >= 5000 {
		return
	}
	ge.State.CanvasEvents = append(ge.State.CanvasEvents, ev)
}

func cloneScores(src map[string]int) map[string]int {
	dst := make(map[string]int, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func buildWordHint(secretWord string) string {
	runes := []rune(secretWord)
	if len(runes) == 0 {
		return ""
	}
	var b strings.Builder
	for i, r := range runes {
		if i > 0 {
			b.WriteRune(' ')
		}
		if r == ' ' || r == '-' {
			b.WriteRune(r)
		} else if i == 0 || i == len(runes)-1 {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}

func StartGame(hub *Hub, matchID string) *GameEngine {
	return StartGameWithRounds(hub, matchID, 1)
}

func StartGameWithRounds(hub *Hub, matchID string, rounds int) *GameEngine {
	if rounds < 1 {
		rounds = 1
	} else if rounds > 10 {
		rounds = 10
	}

	hub.mu.RLock()
	match, exists := hub.matches[matchID]
	if !exists {
		hub.mu.RUnlock()
		return nil
	}

	leftIds := make([]string, 0, len(match.LobbyA.Members))
	for id := range match.LobbyA.Members {
		leftIds = append(leftIds, id)
	}
	rightIds := make([]string, 0, len(match.LobbyB.Members))
	for id := range match.LobbyB.Members {
		rightIds = append(rightIds, id)
	}
	hub.mu.RUnlock()

	enginesMu.Lock()
	defer enginesMu.Unlock()

	if existing, ok := engines[matchID]; ok {
		existing.Stop()
	}

	baseQueue := make([]string, 0, len(leftIds)+len(rightIds))
	maxLength := len(leftIds)
	if len(rightIds) > maxLength {
		maxLength = len(rightIds)
	}
	for i := 0; i < maxLength; i++ {
		if i < len(leftIds) {
			baseQueue = append(baseQueue, leftIds[i])
		}
		if i < len(rightIds) {
			baseQueue = append(baseQueue, rightIds[i])
		}
	}

	queue := make([]string, 0, len(baseQueue)*rounds)
	for r := 0; r < rounds; r++ {
		queue = append(queue, baseQueue...)
	}

	scoreMap := make(map[string]int, len(baseQueue))
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
		stopChan:   make(chan struct{}),
		roundWinCh: make(chan roundWinner, 1),
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
	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic in GameEngine.run", "matchId", ge.MatchID, "recover", r)
		}
	}()

	select {
	case <-time.After(2 * time.Second):
	case <-ge.stopChan:
		return
	}

	ge.mu.RLock()
	totalRounds := len(ge.State.Queue)
	ge.mu.RUnlock()

	for idx := 0; idx < totalRounds; idx++ {
		if !ge.executeSingleRound(idx) {
			return
		}
	}

	ge.finishGame()
}

// executeSingleRound runs one turn and returns false if the game was stopped.
func (ge *GameEngine) executeSingleRound(queueIndex int) bool {
	ge.mu.Lock()
	if queueIndex >= len(ge.State.Queue) {
		ge.mu.Unlock()
		return false
	}
	currentDrawerID := ge.State.Queue[queueIndex]

	ge.Hub.mu.RLock()
	_, exists := ge.Hub.clients[currentDrawerID]
	ge.Hub.mu.RUnlock()
	if !exists {
		ge.mu.Unlock()
		return true
	}

	// Drain any stale winner signal from previous round
	select {
	case <-ge.roundWinCh:
	default:
	}

	pool := getWordPool()
	available := make([]string, 0, len(pool))
	if ge.UsedWords == nil {
		ge.UsedWords = make(map[string]bool)
	}
	for _, w := range pool {
		if !ge.UsedWords[w] {
			available = append(available, w)
		}
	}
	if len(available) == 0 {
		ge.UsedWords = make(map[string]bool)
		available = pool
	}
	secretWord := available[cryptoRandIntn(len(available))]
	ge.UsedWords[secretWord] = true
	hintStr := buildWordHint(secretWord)

	ge.State.CurrentRound = queueIndex + 1
	ge.State.CurrentDrawerID = currentDrawerID
	ge.State.CurrentWord = secretWord
	ge.State.WordHint = hintStr
	ge.State.Status = "Countdown"
	ge.State.DrawTimer = 10
	ge.State.TimeRemaining = 60
	ge.State.CanvasEvents = make([]interface{}, 0)
	ge.State.GuessEvents = make([]GuessEvent, 0)
	ge.State.Winner = nil
	ge.mu.Unlock()

	ge.Hub.mu.Lock()
	if match, matchExists := ge.Hub.matches[ge.MatchID]; matchExists {
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

	ge.broadcastDrawStart(currentDrawerID, secretWord, hintStr)

	// 10s Countdown loop
	countdownTicker := time.NewTicker(1 * time.Second)
	for i := 9; i >= 0; i-- {
		select {
		case <-countdownTicker.C:
			ge.mu.Lock()
			if ge.State.Status != "Countdown" {
				ge.mu.Unlock()
				countdownTicker.Stop()
				return true
			}
			ge.State.DrawTimer = i
			ge.mu.Unlock()
			ge.broadcastStateUpdate()
		case <-ge.stopChan:
			countdownTicker.Stop()
			return false
		}
	}
	countdownTicker.Stop()

	ge.mu.Lock()
	ge.State.Status = "Drawing"
	ge.mu.Unlock()
	ge.broadcastStateUpdate()

	// 60s Drawing timer loop
	drawTicker := time.NewTicker(1 * time.Second)
	var win roundWinner
	won := false
	for i := 59; i >= 0; i-- {
		select {
		case win = <-ge.roundWinCh:
			won = true
		case <-drawTicker.C:
			ge.mu.Lock()
			if ge.State.Status != "Drawing" {
				ge.mu.Unlock()
				break
			}
			ge.State.TimeRemaining = i
			ge.mu.Unlock()
			ge.broadcastStateUpdate()
		case <-ge.stopChan:
			drawTicker.Stop()
			return false
		}
		if won {
			break
		}
	}
	drawTicker.Stop()

	// Transition atomically if timer expired without winner
	ge.mu.Lock()
	if !won {
		select {
		case win = <-ge.roundWinCh:
			won = true
		default:
			ge.State.Status = "Reveal"
			ge.State.Winner = nil
		}
	}
	secretAnswer := ge.State.CurrentWord
	scores := cloneScores(ge.State.Score)
	ge.mu.Unlock()

	ge.broadcastToMatch("ROUND_END", map[string]interface{}{
		"winnerId":   win.playerID,
		"winnerName": win.playerName,
		"points":     win.points,
		"answer":     secretAnswer,
	})
	ge.broadcastToMatch("SCORE_UPDATE", map[string]interface{}{
		"scores": scores,
	})

	select {
	case <-time.After(3 * time.Second):
	case <-ge.stopChan:
		return false
	}

	ge.mu.Lock()
	ge.State.Status = "NextRound"
	ge.mu.Unlock()
	ge.broadcastStateUpdate()

	select {
	case <-time.After(1 * time.Second):
	case <-ge.stopChan:
		return false
	}

	return true
}

func (ge *GameEngine) SubmitGuess(playerID, username, text string) {
	ge.mu.Lock()
	if ge.State.Status != "Drawing" {
		ge.mu.Unlock()
		return
	}
	if playerID == ge.State.CurrentDrawerID {
		ge.mu.Unlock()
		return
	}

	normalizedGuess := trimLower(text)
	normalizedSecret := trimLower(ge.State.CurrentWord)
	isCorrect := normalizedGuess != "" && normalizedSecret != "" && normalizedGuess == normalizedSecret

	guessEvent := GuessEvent{
		ID:         fmt.Sprintf("gss-%d", time.Now().UnixNano()),
		PlayerID:   playerID,
		PlayerName: username,
		Text:       text,
		IsCorrect:  isCorrect,
		Timestamp:  time.Now().Format("15:04:05"),
	}
	ge.State.GuessEvents = append(ge.State.GuessEvents, guessEvent)

	var wonNow bool
	if isCorrect && ge.State.Winner == nil {
		// Transition to Reveal immediately under lock so timer expiry cannot overwrite winner
		ge.State.Status = "Reveal"
		winnerCopy := username
		ge.State.Winner = &winnerCopy
		ge.State.Score[playerID] += 100
		ge.State.Score[ge.State.CurrentDrawerID] += 50
		wonNow = true
	}
	ge.mu.Unlock()

	ge.Hub.mu.RLock()
	client := ge.Hub.clients[playerID]
	ge.Hub.mu.RUnlock()
	if client != nil {
		_ = client.Send(map[string]interface{}{
			"event": "GUESS_FEEDBACK",
			"payload": map[string]interface{}{
				"correct": isCorrect,
			},
		})
	}

	ge.broadcastToMatch("CHAT_MESSAGE", map[string]interface{}{
		"id":         guessEvent.ID,
		"senderId":   playerID,
		"senderName": username,
		"text":       fmt.Sprintf("Tebak: %s", text),
		"side":       "left",
		"timestamp":  time.Now().Format("15:04"),
	})

	if wonNow {
		select {
		case ge.roundWinCh <- roundWinner{playerID: playerID, playerName: username, points: 100}:
		default:
		}
	}
}

func (ge *GameEngine) finishGame() {
	ge.mu.Lock()
	scores := cloneScores(ge.State.Score)
	ge.mu.Unlock()

	topScore := -1
	var topIDs []string
	for pID, sc := range scores {
		if sc > topScore {
			topScore = sc
			topIDs = []string{pID}
		} else if sc == topScore {
			topIDs = append(topIDs, pID)
		}
	}

	winnerLabel := "Belum ada pemenang"
	if topScore > 0 && len(topIDs) > 0 {
		ge.Hub.mu.RLock()
		names := make([]string, 0, len(topIDs))
		for _, id := range topIDs {
			if c, ok := ge.Hub.clients[id]; ok && c.Username != "" {
				names = append(names, c.Username)
			}
		}
		ge.Hub.mu.RUnlock()

		if len(names) == 1 {
			winnerLabel = names[0]
		} else if len(names) > 1 {
			winnerLabel = "Seri (" + strings.Join(names, " & ") + ")"
		}
	}

	ge.mu.Lock()
	ge.State.Status = "Finished"
	ge.State.Winner = &winnerLabel
	ge.mu.Unlock()

	ge.broadcastStateUpdate()

	if db != nil {
		go func(scMap map[string]int) {
			for pID, score := range scMap {
				if err := UpdateScore(pID, "guess_drawing", score); err != nil {
					slog.Warn("Error updating score in DB", "userId", pID, "error", err)
				}
			}
		}(scores)
	}

	select {
	case <-time.After(5 * time.Second):
	case <-ge.stopChan:
		return
	}

	ge.Hub.mu.Lock()
	var lobbyAID, lobbyBID string
	if match, matchExists := ge.Hub.matches[ge.MatchID]; matchExists {
		for _, member := range match.LobbyA.Members {
			member.Presence = "ONLINE"
		}
		for _, member := range match.LobbyB.Members {
			member.Presence = "ONLINE"
		}
		match.LobbyA.Status = "MATCHED"
		match.LobbyB.Status = "MATCHED"
		lobbyAID = match.LobbyA.ID
		lobbyBID = match.LobbyB.ID
	}
	ge.Hub.mu.Unlock()

	// Do NOT re-emit MATCH_FOUND (prevents WebRTC reconnect flicker & chat wipe)
	ge.broadcastToMatch("GAME_END", map[string]interface{}{})
	if lobbyAID != "" {
		ge.Hub.broadcastEventToLobby(lobbyAID, "PRESENCE_UPDATE", map[string]interface{}{
			"frameId":  lobbyAID,
			"presence": "ONLINE",
		})
	}
	if lobbyBID != "" {
		ge.Hub.broadcastEventToLobby(lobbyBID, "PRESENCE_UPDATE", map[string]interface{}{
			"frameId":  lobbyBID,
			"presence": "ONLINE",
		})
	}

	enginesMu.Lock()
	if engines[ge.MatchID] == ge {
		delete(engines, ge.MatchID)
	}
	enginesMu.Unlock()
}

func (ge *GameEngine) broadcastDrawStart(drawerID, secretWord, wordHint string) {
	ge.Hub.mu.RLock()
	match, exists := ge.Hub.matches[ge.MatchID]
	if !exists {
		ge.Hub.mu.RUnlock()
		return
	}
	members := make([]*Client, 0, len(match.LobbyA.Members)+len(match.LobbyB.Members))
	for _, client := range match.LobbyA.Members {
		members = append(members, client)
	}
	for _, client := range match.LobbyB.Members {
		members = append(members, client)
	}
	ge.Hub.mu.RUnlock()

	for _, client := range members {
		word := ""
		if client.ID == drawerID {
			word = secretWord
		}
		_ = client.Send(map[string]interface{}{
			"event": "DRAW_START",
			"payload": map[string]interface{}{
				"drawerId":   drawerID,
				"secretWord": word,
				"wordHint":   wordHint,
				"timeLimit":  60,
			},
		})
	}
}

func (ge *GameEngine) broadcastStateUpdate() {
	ge.mu.RLock()
	state := ge.State
	state.Score = cloneScores(ge.State.Score)
	if len(ge.State.CanvasEvents) > 0 {
		state.CanvasEvents = append([]interface{}(nil), ge.State.CanvasEvents...)
	}
	if len(ge.State.GuessEvents) > 20 {
		state.GuessEvents = append([]GuessEvent(nil), ge.State.GuessEvents[len(ge.State.GuessEvents)-20:]...)
	} else if len(ge.State.GuessEvents) > 0 {
		state.GuessEvents = append([]GuessEvent(nil), ge.State.GuessEvents...)
	}
	ge.mu.RUnlock()

	ge.Hub.mu.RLock()
	match, exists := ge.Hub.matches[ge.MatchID]
	if !exists {
		ge.Hub.mu.RUnlock()
		return
	}
	members := make([]*Client, 0, len(match.LobbyA.Members)+len(match.LobbyB.Members))
	for _, client := range match.LobbyA.Members {
		members = append(members, client)
	}
	for _, client := range match.LobbyB.Members {
		members = append(members, client)
	}
	ge.Hub.mu.RUnlock()

	for _, client := range members {
		clientState := state
		if client.ID != state.CurrentDrawerID {
			clientState.CurrentWord = ""
		}
		_ = client.Send(map[string]interface{}{
			"event":   "GAME_STATE_UPDATE",
			"payload": clientState,
		})
	}
}

func (ge *GameEngine) broadcastToMatch(event string, payload interface{}) {
	ge.Hub.broadcastEventToMatch(ge.MatchID, event, payload)
}

func trimLower(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	lastSpace := true
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
			lastSpace = false
		} else if unicode.IsSpace(r) || r == '-' {
			if !lastSpace {
				b.WriteRune(' ')
				lastSpace = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}
