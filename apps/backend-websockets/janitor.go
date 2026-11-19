package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

func StartIdleLobbyJanitor(ctx context.Context, hub *Hub, interval, maxIdle time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reapIdleLobbies(hub, maxIdle)
		}
	}
}

func reapIdleLobbies(hub *Hub, maxIdle time.Duration) {
	now := time.Now()
	var expiredTargets []*Client
	var expiredLobbyIDs []string

	hub.mu.Lock()
	for lobbyID, lobby := range hub.lobbies {
		if lobby.Status == "WAITING" && now.Sub(lobby.LastActivity) > maxIdle {
			expiredLobbyIDs = append(expiredLobbyIDs, lobbyID)
			for _, member := range lobby.Members {
				expiredTargets = append(expiredTargets, member)
				member.LobbyID = ""
				member.IsLobbyOwner = false
				member.Presence = "ONLINE"
				delete(hub.clients, member.ID)
			}
			delete(hub.lobbies, lobbyID)
			delete(hub.inviteCodes, lobby.InviteCode)
		}
	}
	if len(expiredLobbyIDs) > 0 {
		expiredSet := make(map[string]bool, len(expiredLobbyIDs))
		for _, id := range expiredLobbyIDs {
			expiredSet[id] = true
		}
		newQueue := make([]*Lobby, 0, len(hub.waitingQueue))
		for _, l := range hub.waitingQueue {
			if !expiredSet[l.ID] {
				newQueue = append(newQueue, l)
			}
		}
		hub.waitingQueue = newQueue
	}
	hub.mu.Unlock()

	for _, c := range expiredTargets {
		_ = c.Send(errorMsg("frame idle timeout"))
	}

	if len(expiredLobbyIDs) > 0 {
		slog.Info("Reaped idle lobbies", "count", len(expiredLobbyIDs))
		if db != nil {
			go func(ids []string) {
				for _, id := range ids {
					_ = UpdateLobbyStatus(id, "CLOSED")
				}
			}(expiredLobbyIDs)
		}
	}
}

func StartOnlineCountDebouncer(ctx context.Context, hub *Hub, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	lastCount := -1

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			count := hub.GetOnlineCount()
			if count != lastCount {
				lastCount = count
				hub.BroadcastOnlineCount()
			}
		}
	}
}

func handleMetricsHTTP(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		hub.mu.RLock()
		clients := len(hub.clients)
		lobbies := len(hub.lobbies)
		queueLen := len(hub.waitingQueue)
		matches := len(hub.matches)
		hub.mu.RUnlock()

		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w,
			"# HELP funfram_ws_connections_active Active connected clients\n"+
				"# TYPE funfram_ws_connections_active gauge\n"+
				"funfram_ws_connections_active %d\n"+
				"# HELP funfram_lobbies_active Active lobbies\n"+
				"# TYPE funfram_lobbies_active gauge\n"+
				"funfram_lobbies_active %d\n"+
				"# HELP funfram_matchmaking_queue_len Lobbies waiting in matchmaking queue\n"+
				"# TYPE funfram_matchmaking_queue_len gauge\n"+
				"funfram_matchmaking_queue_len %d\n"+
				"# HELP funfram_matches_active Active matches\n"+
				"# TYPE funfram_matches_active gauge\n"+
				"funfram_matches_active %d\n",
			clients, lobbies, queueLen, matches,
		)
	}
}
