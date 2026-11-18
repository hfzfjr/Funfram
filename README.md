# Funfram

Platform web interaktif real-time untuk video chat acak berbasis lobby, invite teman, dan multiplayer mini-games.

## Struktur Monorepo

- `apps/frontend-nextjs` — Frontend Next.js (App Router, Tailwind CSS, Zustand, WebRTC client, `/api/turn-credentials`)
- `apps/backend-websockets` — Server WebSocket Go untuk lobby, matchmaking, chat, dan mini-games
- `apps/backend-webrtc` — Server WebSocket Node.js untuk signaling WebRTC
- `infrastructure/postgres/init.sql` — Skema referensi database Supabase PostgreSQL
- `docker-compose.yml` — Konfigurasi container untuk local development

## Dokumentasi (`docs/`)

- [Arsitektur Sistem](docs/architecture.md) — Topologi 3 service, alur WebRTC + Cloudflare TURN, dan skema database
- [Panduan Deployment](docs/deployment.md) — Konfigurasi 3 resource Coolify, Cloudflare Tunnel, Environment Variables, dan troubleshooting
- [Protokol Komunikasi & API](docs/protocol.md) — Endpoint HTTP (`/health`, `/api/turn-credentials`), event WebSocket Go, dan pesan signaling WebRTC
