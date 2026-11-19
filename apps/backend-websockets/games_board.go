package main

import (
	"fmt"
	"strings"
	"sync"
)

type BoardGameManager struct {
	mu    sync.Mutex
	chess map[string]*ChessServerState
	ludo  map[string]*LudoServerState
	uno   map[string]*UnoServerState
}

var boardGames = &BoardGameManager{
	chess: make(map[string]*ChessServerState),
	ludo:  make(map[string]*LudoServerState),
	uno:   make(map[string]*UnoServerState),
}

func StopBoardGames(matchID string) {
	boardGames.mu.Lock()
	delete(boardGames.chess, matchID)
	delete(boardGames.ludo, matchID)
	delete(boardGames.uno, matchID)
	boardGames.mu.Unlock()
}

// ==================== CHESS SERVER ENGINE ====================

type ChessServerState struct {
	Board    [8][8]string `json:"board"`
	Turn     string       `json:"turn"` // "w" | "b"
	Winner   *string      `json:"winner"`
	LastMove string       `json:"lastMove"`
	FrameAID string       `json:"-"`
	FrameBID string       `json:"-"`
}

func initialChessBoard() [8][8]string {
	return [8][8]string{
		{"bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"},
		{"bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"},
		{"", "", "", "", "", "", "", ""},
		{"", "", "", "", "", "", "", ""},
		{"", "", "", "", "", "", "", ""},
		{"", "", "", "", "", "", "", ""},
		{"wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"},
		{"wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"},
	}
}

func StartChessServer(hub *Hub, matchID string) {
	hub.mu.RLock()
	match, ok := hub.matches[matchID]
	if !ok {
		hub.mu.RUnlock()
		return
	}
	frameAID := match.LobbyA.ID
	frameBID := match.LobbyB.ID
	hub.mu.RUnlock()

	st := &ChessServerState{
		Board:    initialChessBoard(),
		Turn:     "w",
		FrameAID: frameAID,
		FrameBID: frameBID,
	}
	boardGames.mu.Lock()
	boardGames.chess[matchID] = st
	boardGames.mu.Unlock()

	hub.broadcastEventToMatch(matchID, "GAME_ACTION", map[string]interface{}{
		"game":     "chess",
		"action":   "MOVE",
		"board":    st.Board,
		"nextTurn": st.Turn,
		"winner":   st.Winner,
		"lastMove": "",
	})
}

func isValidChessPieceMove(board [8][8]string, color string, r1, c1, r2, c2 int) bool {
	if r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7 || r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7 {
		return false
	}
	if r1 == r2 && c1 == c2 {
		return false
	}
	piece := board[r1][c1]
	if len(piece) < 2 || string(piece[0]) != color {
		return false
	}
	target := board[r2][c2]
	if target != "" && string(target[0]) == color {
		return false
	}
	dr := r2 - r1
	dc := c2 - c1
	absDr := dr
	if absDr < 0 {
		absDr = -absDr
	}
	absDc := dc
	if absDc < 0 {
		absDc = -absDc
	}

	clearLine := func() bool {
		stepR := 0
		if dr > 0 {
			stepR = 1
		} else if dr < 0 {
			stepR = -1
		}
		stepC := 0
		if dc > 0 {
			stepC = 1
		} else if dc < 0 {
			stepC = -1
		}
		cr, cc := r1+stepR, c1+stepC
		for cr != r2 || cc != c2 {
			if board[cr][cc] != "" {
				return false
			}
			cr += stepR
			cc += stepC
		}
		return true
	}

	switch piece[1] {
	case 'P':
		dir := -1
		startRow := 6
		if color == "b" {
			dir = 1
			startRow = 1
		}
		if dc == 0 && target == "" {
			if dr == dir {
				return true
			}
			if r1 == startRow && dr == 2*dir && board[r1+dir][c1] == "" {
				return true
			}
		}
		if absDc == 1 && dr == dir && target != "" {
			return true
		}
		return false
	case 'N':
		return (absDr == 2 && absDc == 1) || (absDr == 1 && absDc == 2)
	case 'B':
		return absDr == absDc && clearLine()
	case 'R':
		return (dr == 0 || dc == 0) && clearLine()
	case 'Q':
		return (dr == 0 || dc == 0 || absDr == absDc) && clearLine()
	case 'K':
		return absDr <= 1 && absDc <= 1
	default:
		return false
	}
}

func HandleChessAction(hub *Hub, matchID, lobbyID string, payload map[string]interface{}) {
	action, _ := payload["action"].(string)
	boardGames.mu.Lock()
	st, ok := boardGames.chess[matchID]
	if !ok {
		boardGames.mu.Unlock()
		return
	}

	if action == "RESET" {
		st.Board = initialChessBoard()
		st.Turn = "w"
		st.Winner = nil
		st.LastMove = ""
		boardCopy := st.Board
		boardGames.mu.Unlock()
		hub.broadcastEventToMatch(matchID, "GAME_ACTION", map[string]interface{}{
			"game":     "chess",
			"action":   "MOVE",
			"board":    boardCopy,
			"nextTurn": "w",
			"winner":   nil,
			"lastMove": "",
		})
		return
	}

	if action != "MOVE" || st.Winner != nil {
		boardGames.mu.Unlock()
		return
	}

	playerColor := "w"
	if lobbyID == st.FrameBID {
		playerColor = "b"
	} else if lobbyID != st.FrameAID {
		boardGames.mu.Unlock()
		return
	}
	if playerColor != st.Turn {
		boardGames.mu.Unlock()
		return
	}

	r1f, ok1 := payload["fromRow"].(float64)
	c1f, ok2 := payload["fromCol"].(float64)
	r2f, ok3 := payload["toRow"].(float64)
	c2f, ok4 := payload["toCol"].(float64)
	if !ok1 || !ok2 || !ok3 || !ok4 {
		boardGames.mu.Unlock()
		return
	}
	r1, c1, r2, c2 := int(r1f), int(c1f), int(r2f), int(c2f)
	if !isValidChessPieceMove(st.Board, playerColor, r1, c1, r2, c2) {
		boardGames.mu.Unlock()
		return
	}

	captured := st.Board[r2][c2]
	moved := st.Board[r1][c1]
	st.Board[r2][c2] = moved
	st.Board[r1][c1] = ""
	if moved == "wP" && r2 == 0 {
		st.Board[r2][c2] = "wQ"
	} else if moved == "bP" && r2 == 7 {
		st.Board[r2][c2] = "bQ"
	}

	if strings.HasSuffix(captured, "K") {
		win := playerColor
		st.Winner = &win
	}
	if st.Turn == "w" {
		st.Turn = "b"
	} else {
		st.Turn = "w"
	}
	st.LastMove = fmt.Sprintf("%c%d→%c%d", 'a'+c1, 8-r1, 'a'+c2, 8-r2)

	boardCopy := st.Board
	nextTurn := st.Turn
	winnerCopy := st.Winner
	lastMove := st.LastMove
	boardGames.mu.Unlock()

	hub.broadcastEventToMatch(matchID, "GAME_ACTION", map[string]interface{}{
		"game":     "chess",
		"action":   "MOVE",
		"board":    boardCopy,
		"nextTurn": nextTurn,
		"winner":   winnerCopy,
		"lastMove": lastMove,
	})
}

// ==================== LUDO SERVER ENGINE ====================

type LudoServerState struct {
	Red       [4]int  `json:"red"`
	Blue      [4]int  `json:"blue"`
	Turn      string  `json:"turn"` // "red" | "blue"
	Dice      *int    `json:"dice"`
	Winner    *string `json:"winner"`
	StatusMsg string  `json:"statusMsg"`
	FrameAID  string  `json:"-"`
	FrameBID  string  `json:"-"`
}

func StartLudoServer(hub *Hub, matchID string) {
	hub.mu.RLock()
	match, ok := hub.matches[matchID]
	if !ok {
		hub.mu.RUnlock()
		return
	}
	frameAID := match.LobbyA.ID
	frameBID := match.LobbyB.ID
	hub.mu.RUnlock()

	st := &LudoServerState{
		Red:       [4]int{-1, -1, -1, -1},
		Blue:      [4]int{-1, -1, -1, -1},
		Turn:      "red",
		StatusMsg: "Giliran Merah melempar dadu",
		FrameAID:  frameAID,
		FrameBID:  frameBID,
	}
	boardGames.mu.Lock()
	boardGames.ludo[matchID] = st
	snapshot := *st
	boardGames.mu.Unlock()

	hub.broadcastEventToMatch(matchID, "GAME_ACTION", map[string]interface{}{
		"game":   "ludo",
		"action": "SYNC",
		"state":  snapshot,
	})
}

func HandleLudoAction(hub *Hub, matchID, lobbyID string, payload map[string]interface{}) {
	action, _ := payload["action"].(string)
	boardGames.mu.Lock()
	st, ok := boardGames.ludo[matchID]
	if !ok {
		boardGames.mu.Unlock()
		return
	}

	if action == "RESET" {
		st.Red = [4]int{-1, -1, -1, -1}
		st.Blue = [4]int{-1, -1, -1, -1}
		st.Turn = "red"
		st.Dice = nil
		st.Winner = nil
		st.StatusMsg = "Permainan diulang! Giliran Merah"
		snap := *st
		boardGames.mu.Unlock()
		hub.broadcastEventToMatch(matchID, "GAME_ACTION", map[string]interface{}{
			"game":   "ludo",
			"action": "SYNC",
			"state":  snap,
		})
		return
	}

	playerColor := "red"
	if lobbyID == st.FrameBID {
		playerColor = "blue"
	} else if lobbyID != st.FrameAID {
		boardGames.mu.Unlock()
		return
	}
	if st.Winner != nil || playerColor != st.Turn {
		boardGames.mu.Unlock()
		return
	}

	if action == "ROLL" && st.Dice == nil {
		roll := cryptoRandIntn(6) + 1
		st.Dice = &roll
		tokens := st.Red
		if playerColor == "blue" {
			tokens = st.Blue
		}
		hasValidMove := false
		for _, pos := range tokens {
			if (pos == -1 && roll == 6) || (pos >= 0 && pos < 56 && pos+roll <= 56) {
				hasValidMove = true
				break
			}
		}
		if !hasValidMove {
			next := "blue"
			if playerColor == "blue" {
				next = "red"
			}
			st.Turn = next
			st.Dice = nil
			st.StatusMsg = fmt.Sprintf("Dadu %d — tidak ada langkah, giliran %s", roll, next)
		} else {
			st.StatusMsg = fmt.Sprintf("Dadu %d! Pilih bidak untuk melangkah", roll)
		}
	} else if action == "MOVE" && st.Dice != nil {
		idxF, okIdx := payload["tokenIndex"].(float64)
		if !okIdx {
			boardGames.mu.Unlock()
			return
		}
		idx := int(idxF)
		if idx < 0 || idx > 3 {
			boardGames.mu.Unlock()
			return
		}
		roll := *st.Dice
		var tokens *[4]int
		var opp *[4]int
		if playerColor == "red" {
			tokens = &st.Red
			opp = &st.Blue
		} else {
			tokens = &st.Blue
			opp = &st.Red
		}

		cur := tokens[idx]
		if cur == -1 {
			if roll != 6 {
				boardGames.mu.Unlock()
				return
			}
			tokens[idx] = 0
		} else if cur >= 0 && cur+roll <= 56 {
			tokens[idx] = cur + roll
		} else {
			boardGames.mu.Unlock()
			return
		}

		// Simple capture on shared track (positions 0..50, offset 26)
		newPos := tokens[idx]
		if newPos >= 0 && newPos <= 50 {
			oppTarget := (newPos + 26) % 52
			if oppTarget != 0 && oppTarget != 8 && oppTarget != 13 && oppTarget != 21 && oppTarget != 26 && oppTarget != 34 && oppTarget != 39 && oppTarget != 47 {
				for j := 0; j < 4; j++ {
					if opp[j] == oppTarget {
						opp[j] = -1
					}
				}
			}
		}

		allHome := true
		for _, p := range tokens {
			if p != 56 {
				allHome = false
				break
			}
		}
		if allHome {
			win := playerColor
			st.Winner = &win
			st.Dice = nil
			st.StatusMsg = fmt.Sprintf("%s menang!", strings.ToUpper(playerColor))
		} else {
			st.Dice = nil
			if roll != 6 {
				if playerColor == "red" {
					st.Turn = "blue"
				} else {
					st.Turn = "red"
				}
			}
			st.StatusMsg = fmt.Sprintf("Giliran %s", st.Turn)
		}
	} else {
		boardGames.mu.Unlock()
		return
	}

	snap := *st
	boardGames.mu.Unlock()
	hub.broadcastEventToMatch(matchID, "GAME_ACTION", map[string]interface{}{
		"game":   "ludo",
		"action": "SYNC",
		"state":  snap,
	})
}

// ==================== UNO SERVER ENGINE (Hidden Hands!) ====================

type UnoCard struct {
	ID    string `json:"id"`
	Color string `json:"color"` // red, yellow, green, blue, wild
	Value string `json:"value"` // 0-9, skip, reverse, draw2, wild, wild4
}

type UnoServerState struct {
	Deck         []UnoCard
	Discard      []UnoCard
	Hands        map[string][]UnoCard
	PlayerOrder  []string
	TurnIndex    int
	Direction    int
	CurrentColor string
	Winner       *string
}

func buildShuffledUnoDeck() []UnoCard {
	colors := []string{"red", "yellow", "green", "blue"}
	values := []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "reverse", "draw2"}
	var deck []UnoCard
	idx := 0
	for _, c := range colors {
		deck = append(deck, UnoCard{ID: fmt.Sprintf("u-%d", idx), Color: c, Value: "0"})
		idx++
		for _, v := range values {
			deck = append(deck, UnoCard{ID: fmt.Sprintf("u-%d", idx), Color: c, Value: v})
			idx++
			deck = append(deck, UnoCard{ID: fmt.Sprintf("u-%d", idx), Color: c, Value: v})
			idx++
		}
	}
	for i := 0; i < 4; i++ {
		deck = append(deck, UnoCard{ID: fmt.Sprintf("u-%d", idx), Color: "wild", Value: "wild"})
		idx++
		deck = append(deck, UnoCard{ID: fmt.Sprintf("u-%d", idx), Color: "wild", Value: "wild4"})
		idx++
	}
	for i := len(deck) - 1; i > 0; i-- {
		j := cryptoRandIntn(i + 1)
		deck[i], deck[j] = deck[j], deck[i]
	}
	return deck
}

func broadcastUnoFilteredState(hub *Hub, matchID string, st *UnoServerState) {
	topDiscard := st.Discard[len(st.Discard)-1]
	playersSummary := make([]map[string]interface{}, 0, len(st.PlayerOrder))
	for _, pID := range st.PlayerOrder {
		playersSummary = append(playersSummary, map[string]interface{}{
			"id":        pID,
			"handCount": len(st.Hands[pID]),
		})
	}
	currentPlayerID := st.PlayerOrder[st.TurnIndex]

	hub.mu.RLock()
	match, ok := hub.matches[matchID]
	if !ok {
		hub.mu.RUnlock()
		return
	}
	var members []*Client
	for _, c := range match.LobbyA.Members {
		members = append(members, c)
	}
	for _, c := range match.LobbyB.Members {
		members = append(members, c)
	}
	hub.mu.RUnlock()

	for _, member := range members {
		myHand := st.Hands[member.ID]
		if myHand == nil {
			myHand = []UnoCard{}
		}
		_ = member.Send(map[string]interface{}{
			"event": "GAME_ACTION",
			"payload": map[string]interface{}{
				"game":   "uno",
				"action": "SYNC",
				"state": map[string]interface{}{
					"myHand":          myHand,
					"players":         playersSummary,
					"topCard":         topDiscard,
					"currentColor":    st.CurrentColor,
					"currentPlayerId": currentPlayerID,
					"direction":       st.Direction,
					"winner":          st.Winner,
					"deckCount":       len(st.Deck),
				},
			},
		})
	}
}

func StartUnoServer(hub *Hub, matchID string) {
	hub.mu.RLock()
	match, ok := hub.matches[matchID]
	if !ok {
		hub.mu.RUnlock()
		return
	}
	var order []string
	for id := range match.LobbyA.Members {
		order = append(order, id)
	}
	for id := range match.LobbyB.Members {
		order = append(order, id)
	}
	hub.mu.RUnlock()
	if len(order) < 2 {
		return
	}

	deck := buildShuffledUnoDeck()
	hands := make(map[string][]UnoCard, len(order))
	pos := 0
	for _, pID := range order {
		hands[pID] = append([]UnoCard{}, deck[pos:pos+7]...)
		pos += 7
	}
	topIdx := pos
	for topIdx < len(deck) && deck[topIdx].Color == "wild" {
		topIdx++
	}
	if topIdx >= len(deck) {
		topIdx = pos
	}
	firstCard := deck[topIdx]
	remaining := append([]UnoCard{}, deck[pos:topIdx]...)
	if topIdx+1 < len(deck) {
		remaining = append(remaining, deck[topIdx+1:]...)
	}

	st := &UnoServerState{
		Deck:         remaining,
		Discard:      []UnoCard{firstCard},
		Hands:        hands,
		PlayerOrder:  order,
		TurnIndex:    0,
		Direction:    1,
		CurrentColor: firstCard.Color,
	}

	boardGames.mu.Lock()
	boardGames.uno[matchID] = st
	boardGames.mu.Unlock()

	broadcastUnoFilteredState(hub, matchID, st)
}

func HandleUnoAction(hub *Hub, matchID, userID string, payload map[string]interface{}) {
	action, _ := payload["action"].(string)
	if action == "RESET" {
		StartUnoServer(hub, matchID)
		return
	}

	boardGames.mu.Lock()
	st, ok := boardGames.uno[matchID]
	if !ok || st.Winner != nil {
		boardGames.mu.Unlock()
		return
	}
	if st.PlayerOrder[st.TurnIndex] != userID {
		boardGames.mu.Unlock()
		return
	}

	drawCards := func(targetID string, count int) {
		for i := 0; i < count; i++ {
			if len(st.Deck) == 0 && len(st.Discard) > 1 {
				top := st.Discard[len(st.Discard)-1]
				recycle := append([]UnoCard{}, st.Discard[:len(st.Discard)-1]...)
				for r := len(recycle) - 1; r > 0; r-- {
					j := cryptoRandIntn(r + 1)
					recycle[r], recycle[j] = recycle[j], recycle[r]
				}
				st.Deck = recycle
				st.Discard = []UnoCard{top}
			}
			if len(st.Deck) == 0 {
				break
			}
			card := st.Deck[0]
			st.Deck = st.Deck[1:]
			st.Hands[targetID] = append(st.Hands[targetID], card)
		}
	}

	advanceTurn := func(steps int) {
		n := len(st.PlayerOrder)
		st.TurnIndex = ((st.TurnIndex + steps*st.Direction) % n + n) % n
	}

	switch action {
	case "DRAW_CARD":
		drawCards(userID, 1)
		advanceTurn(1)
	case "PLAY_CARD":
		cardID, _ := payload["cardId"].(string)
		chosenColor, _ := payload["chosenColor"].(string)
		hand := st.Hands[userID]
		cardIdx := -1
		for i, c := range hand {
			if c.ID == cardID {
				cardIdx = i
				break
			}
		}
		if cardIdx == -1 {
			boardGames.mu.Unlock()
			return
		}
		card := hand[cardIdx]
		top := st.Discard[len(st.Discard)-1]
		if card.Color != "wild" && card.Color != st.CurrentColor && card.Value != top.Value {
			boardGames.mu.Unlock()
			return
		}
		st.Hands[userID] = append(hand[:cardIdx], hand[cardIdx+1:]...)
		st.Discard = append(st.Discard, card)
		if card.Color == "wild" {
			if chosenColor != "red" && chosenColor != "yellow" && chosenColor != "green" && chosenColor != "blue" {
				chosenColor = "red"
			}
			st.CurrentColor = chosenColor
		} else {
			st.CurrentColor = card.Color
		}

		if len(st.Hands[userID]) == 0 {
			win := userID
			st.Winner = &win
		} else {
			steps := 1
			if card.Value == "reverse" {
				if len(st.PlayerOrder) == 2 {
					steps = 2
				} else {
					st.Direction *= -1
				}
			} else if card.Value == "skip" {
				steps = 2
			} else if card.Value == "draw2" {
				nextIdx := ((st.TurnIndex + st.Direction) % len(st.PlayerOrder) + len(st.PlayerOrder)) % len(st.PlayerOrder)
				drawCards(st.PlayerOrder[nextIdx], 2)
				steps = 2
			} else if card.Value == "wild4" {
				nextIdx := ((st.TurnIndex + st.Direction) % len(st.PlayerOrder) + len(st.PlayerOrder)) % len(st.PlayerOrder)
				drawCards(st.PlayerOrder[nextIdx], 4)
				steps = 2
			}
			advanceTurn(steps)
		}
	default:
		boardGames.mu.Unlock()
		return
	}

	boardGames.mu.Unlock()
	broadcastUnoFilteredState(hub, matchID, st)
}
