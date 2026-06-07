package main

import (
	"log"

	"net/http"

	"os"

	"github.com/joho/godotenv"
)

func main() {

	godotenv.Load()

	// Initialize database connection
	err := InitDatabase()
	if err != nil {
		log.Println("Warning: Database initialization failed:", err)
	}
	defer CloseDatabase()

	hub := NewHub()

	port := os.Getenv("PORT")
	if port == "" {
		port = "5001"
	}

	log.Printf("🚀 WebSocket Server starting on port %s\n", port)
	log.Printf("📡 WebSocket endpoint: ws://localhost:%s/socket\n", port)

	http.HandleFunc("/socket", func(w http.ResponseWriter, r *http.Request) {

		ws, err := upgrader.Upgrade(w, r, nil)

		if err != nil {

			log.Println("Upgrade error:", err)

			return

		}

		handleConnections(hub, ws)

	})

	log.Fatal(http.ListenAndServe(":"+port, nil))

}
