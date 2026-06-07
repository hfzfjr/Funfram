# PLAN.md

# Funfram.com Development Plan

## 1. Ringkasan Konsep Proyek

**Funfram.com** adalah platform web interaktif real-time yang mempertemukan pengguna secara acak melalui video chat (mirip OmeTV).

Perbedaan utama dibanding platform sejenis:

- Pengguna dapat membuat lobi bersama teman sebelum melakukan pencarian lawan bicara.
- Sistem mendukung fitur undang teman menggunakan tautan unik.
- Pengguna dapat bermain multiplayer mini games secara langsung saat melakukan video chat.
- Arsitektur dirancang untuk mendukung komunikasi real-time dan skalabilitas jangka panjang.

---

## 2. Arsitektur Sistem

```mermaid
graph TD
    UserA([Pengguna A]) <-->|Port 80/443| Nginx[Nginx Reverse Proxy Container]
    UserB([Pengguna B]) <-->|Port 80/443| Nginx

    Nginx -->|Rute /| Frontend[Frontend Next.js Container]
    Nginx -->|Rute /webrtc| BE_WebRTC[Backend Signaling Container]
    Nginx -->|Rute /socket| BE_Game[Backend WebSockets Container]

    BE_WebRTC <--> Database[(PostgreSQL)]
    BE_Game <--> Database

    UserA <... Direct Video Streaming P2P ...> UserB
```

### Alur Data

#### 1. Akses Utama

- Pengguna mengakses domain `funfram.com`.
- Trafik masuk melalui Nginx Reverse Proxy.
- Nginx meneruskan request ke layanan yang sesuai.

#### 2. Lobi dan Undang Teman

- Pengguna membuat lobi.
- Sistem menghasilkan URL undangan unik.
- Teman dapat bergabung ke lobi menggunakan tautan tersebut.

#### 3. Matchmaking

- Lobi masuk ke antrean pencarian.
- Sistem mencocokkan lobi dengan lobi lain yang tersedia.
- Pencarian dapat dilakukan oleh pengguna tunggal maupun grup.

#### 4. Video Chat

- Backend WebRTC bertindak sebagai Signaling Server.
- Browser bertukar Offer, Answer, dan ICE Candidate.
- Setelah koneksi berhasil dibuat, video berjalan langsung secara peer-to-peer (P2P).
- TURN Server digunakan sebagai fallback jika koneksi langsung gagal.

#### 5. Multiplayer Mini Games

- Sinkronisasi status game dilakukan menggunakan WebSocket native (Go).
- Semua event permainan dikirim secara real-time melalui WebSocket connection.
- Backend bertanggung jawab terhadap validasi skor dan status pertandingan.

---

## 3. Tech Stack

| Komponen          | Teknologi               | Alasan                                        |
| ----------------- | ----------------------- | --------------------------------------------- |
| Sistem Operasi    | Debian 13 (Trixie)      | Stabil, ringan, dan cocok untuk server 24 jam |
| Containerization  | Docker & Docker Compose | Isolasi layanan dan deployment lebih mudah    |
| Reverse Proxy     | Nginx                   | Routing trafik dan SSL termination            |
| Frontend          | Next.js (App Router)    | Modern, performa tinggi, SEO-friendly         |
| Styling           | Tailwind CSS            | Pengembangan UI cepat dan konsisten           |
| State Management  | Zustand                 | Ringan dan mudah digunakan                    |
| Backend Signaling | Node.js                 | Cocok untuk komunikasi real-time WebRTC       |
| Backend Game      | Go (Golang)             | Performa tinggi untuk WebSocket & concurrency |
| Database          | PostgreSQL              | Relasional, stabil, dan open source           |
| STUN Server       | Google STUN             | Gratis untuk kebutuhan dasar WebRTC           |
| TURN Server       | Coturn                  | Fallback untuk NAT dan firewall ketat         |

---

## 4. Struktur Service Docker

```text
funfram/
│
├── apps/
│   ├── frontend-nextjs/
│   │   └── Next.js App Router + Tailwind CSS + Zustand
│   │
│   ├── backend-websockets/
│   │   └── Go WebSocket Server (Game & Matchmaking)
│   │
│   └── backend-webrtc/
│       └── Node.js WebRTC Signaling Server
│
├── infrastructure/
│   ├── nginx/
│   │   └── nginx.conf
│   ├── coturn/
│   │   └── turnserver.conf
│   └── postgres/
│       └── init.sql
│
├── packages/
│   └── Shared packages (types, utilities, etc.)
│
├── docker-compose.yml
├── .env.example
└── PLAN.md
```

---

## 5. Tahapan Implementasi

### Fase 1 — Persiapan Server

#### Target

Menyiapkan lingkungan produksi berbasis Debian 13.

#### Langkah

1. Install Debian 13 Minimal (CLI).
2. Konfigurasi SSH.
3. Konfigurasi UFW Firewall.
4. Install Docker.
5. Install Docker Compose.
6. Konfigurasi domain.
7. Setup Port Forwarding atau Cloudflare Tunnel.

#### Deliverable

- Server siap digunakan.
- Domain mengarah ke server.

---

### Fase 2 — Frontend Development

#### Target

Membangun antarmuka pengguna.

#### Langkah

1. Setup Next.js App Router.
2. Setup Tailwind CSS.
3. Setup Zustand.
4. Membuat halaman:
   - Landing Page
   - Lobby Page
   - Match Screen
   - Video Chat Screen
   - Mini Games Area

5. Integrasi kamera dan mikrofon.
6. Membuat Dockerfile produksi.

#### Deliverable

Frontend siap digunakan dan berjalan dalam container.

---

### Fase 3 — Backend WebSocket & Matchmaking

#### Target

Membangun sistem lobi dan sinkronisasi game.

#### Fitur

##### Lobby System

- Create Room
- Join Room
- Leave Room
- Invite Link

##### Matchmaking Engine

- Queue Management
- Match Lobby vs Lobby
- Match Single vs Single

##### Multiplayer Games

Contoh awal:

- Tic-Tac-Toe
- Guess Drawing
- Rock Paper Scissors

#### Deliverable

Backend multiplayer berjalan stabil.

---

### Fase 4 — Integrasi WebRTC

#### Target

Mengaktifkan video chat peer-to-peer.

#### Komponen

##### Signaling Server

Menangani:

- Offer
- Answer
- ICE Candidate

##### Frontend WebRTC

Mengelola:

- Kamera
- Mikrofon
- Koneksi Peer

##### STUN

```javascript
{
  urls: "stun:stun.l.google.com:19302";
}
```

##### TURN

Menggunakan container Coturn sebagai fallback.

#### Deliverable

Video chat dapat berjalan antar perangkat berbeda jaringan.

---

### Fase 5 — Docker Compose & Reverse Proxy

#### Target

Menggabungkan seluruh layanan.

#### Services

```yaml
services:
  frontend-nextjs:
  backend-websockets:
  backend-webrtc:
  postgres:
  coturn:
  nginx:
```

#### Routing

```text
/          -> frontend-nextjs
/webrtc    -> backend-webrtc
/socket    -> backend-websockets
```

#### SSL

Menggunakan:

- Let's Encrypt
- Certbot

#### Deliverable

Semua service berjalan melalui HTTPS.

---

### Fase 6 — Deployment dan Testing

#### Deployment

```bash
git clone repository
cp .env.example .env

docker compose up --build -d
```

#### Pengujian

##### Video Chat

- WiFi ↔ WiFi
- WiFi ↔ Mobile Data
- Mobile Data ↔ Mobile Data

##### Multiplayer

- Sinkronisasi skor
- Reconnect
- Pergantian pemain

##### Infrastruktur

- HTTPS
- TURN fallback
- Load test ringan

#### Deliverable

Versi produksi pertama siap digunakan.

---

## 6. Database Awal

### users

```sql
id
username
created_at
```

### lobbies

```sql
id
owner_id
invite_code
status
created_at
```

### lobby_members

```sql
id
lobby_id
user_id
joined_at
```

### matches

```sql
id
lobby_a
lobby_b
created_at
ended_at
```

### leaderboard

```sql
id
user_id
game_name
score
updated_at
```

---

## 7. Keamanan

### Server

- UFW Firewall
- SSH Key Authentication
- Fail2Ban

### Aplikasi

- HTTPS Only
- Secure Cookies
- Rate Limiting
- Input Validation

### WebRTC

- TURN Authentication
- ICE Filtering
- Abuse Detection

---

## 8. Roadmap Skalabilitas

### Tahap Menengah

Menambahkan:

- Redis
- Session Cache
- Queue Management

```text
Socket Server
      ↓
     Redis
      ↓
Socket Server
```

### Tahap Besar

Memisahkan layanan menjadi:

- Frontend Server
- Game Server
- Signaling Server
- TURN Server
- Database Server

### Tahap Enterprise

Menambahkan:

- Kubernetes
- Horizontal Scaling
- CDN
- Monitoring
- Prometheus
- Grafana

---

## 9. Target MVP (Minimum Viable Product)

Fitur yang wajib selesai pada versi pertama:

- Video Chat Random
- Sistem Lobby
- Invite Friend Link
- Matchmaking
- Text Chat
- Tic-Tac-Toe Multiplayer
- HTTPS
- Docker Deployment

---

## 10. Visi Jangka Panjang

Menjadikan Funfram.com sebagai platform sosial interaktif yang menggabungkan:

- Random Video Chat
- Party Lobby
- Multiplayer Games
- Community Features
- Creator Interaction

dalam satu ekosistem real-time yang ringan, aman, dan scalable.

---

## 11. Alur Aplikasi (Application Flow)

### Alur Login dan Masuk ke Aplikasi

1. **Akses Domain**
   - Pengguna mengakses `funframe.roomify.space` (domain sementara, menggunakan subdomain dari project lain)
   - Pengguna diarahkan ke halaman utama aplikasi

2. **Overlay Login**
   - Segera setelah halaman dimuat, overlay login muncul
   - Overlay ini **tidak bisa ditutup** sebelum pengguna login
   - Untuk tahap development, login hanya memerlukan **username**
   - Di masa depan, login akan menggunakan **Google OAuth**

3. **Tampilan Utama**
   - Setelah login berhasil, pengguna melihat tampilan video conferencing
   - Layout terdiri dari:
     - **Header**: Logo "FunFram", indikator "Live", navigasi "FunVideo" dan "FunChat", tombol "Invite Friends"
     - **Frame Kiri**: Untuk diri sendiri dan teman yang diundang
     - **Frame Kanan**: Untuk orang random yang akan dicari (max 4 orang, min 1 orang)
     - **Footer**: Kontrol buttons (Next Frame, Leave Frame, Microphone, Camera, Chat)

4. **Grid Layout System**
   - Sistem frame menggunakan grid layout yang dinamis
   - Frame kiri: untuk user dan invited friends
   - Frame kanan: untuk random matches
   - Konfigurasi yang didukung:
     - 1 to 1 (min)
     - 1 to 2
     - 1 to 3
     - 1 to 4
     - 2 to 1
     - 2 to 2
     - 2 to 3
     - 2 to 4
     - 3 to 1
     - 3 to 2
     - 3 to 3
     - 3 to 4
     - 4 to 1
     - 4 to 2
     - 4 to 3
     - 4 to 4 (max)
