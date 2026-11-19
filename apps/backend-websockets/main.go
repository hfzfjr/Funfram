package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if err := InitDatabase(); err != nil {
		slog.Warn("Database initialization failed; running in memory-only mode", "error", err)
	}
	defer CloseDatabase()

	hub := NewHub()
	ipLimiter := NewIPRateLimiter(20, time.Minute)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5001"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","service":"backend-websockets"}`))
	})
	mux.HandleFunc("/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"alive"}`))
	})
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if db != nil {
			pingCtx, cancel := context.WithTimeout(r.Context(), time.Second)
			defer cancel()
			if err := db.Ping(pingCtx); err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = w.Write([]byte(`{"status":"unready","reason":"database ping failed"}`))
				return
			}
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	})
	mux.HandleFunc("/metrics", handleMetricsHTTP(hub))
	mux.HandleFunc("/api/invites/verify", handleVerifyInviteHTTP(hub))

	wsHandler := func(w http.ResponseWriter, r *http.Request) {
		ip := ExtractClientIP(r)
		if !ipLimiter.Allow(ip) {
			http.Error(w, "Too many connections", http.StatusTooManyRequests)
			return
		}
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("WebSocket upgrade failed", "error", err)
			return
		}
		handleConnections(hub, ws)
	}

	mux.HandleFunc("/socket", wsHandler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			wsHandler(w, r)
			return
		}
		http.NotFound(w, r)
	})

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go StartIdleLobbyJanitor(ctx, hub, 30*time.Second, 5*time.Minute)
	go StartOnlineCountDebouncer(ctx, hub, 3*time.Second)

	go func() {
		slog.Info("WebSocket server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("Shutting down WebSocket server gracefully")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}
