package main

import (
	"log"
	"net/http"
	"os"
	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load()
	hub := NewHub()

	http.HandleFunc("/socket", func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("Upgrade error:", err)
			return
		}
		handleConnections(hub, ws)
	})

	log.Fatal(http.ListenAndServe(":"+os.Getenv("PORT"), nil))
}