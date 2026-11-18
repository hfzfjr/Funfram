# Protokol Komunikasi & Kontrak API

Dokumen ini merangkum kontrak komunikasi antara frontend dan kedua backend serta endpoint HTTP yang tersedia.

---

## 1. HTTP Endpoints

### Frontend Next.js (`:3000`)
- **`GET /api/turn-credentials`**
  - Mengambil ICE servers (`stun` + `turn` + `turns`) dari Cloudflare Realtime TURN API (TTL `86400` detik), dengan fallback opsional ke Metered API.
  - Respons sukses (`200 OK`): `{ "iceServers": [...] }`

### Backend WebSockets Go (`:5001`)
- **`GET /health`** → `200 OK` JSON: `{"status":"ok","service":"backend-websockets"}`
- **`GET /socket`** & **`GET /`** → WebSocket upgrade (`CheckOrigin` mengizinkan semua origin).

### Backend WebRTC Node.js (`:5002`)
- **`GET /health`** → `200 OK` JSON: `{"status":"ok","service":"backend-webrtc"}`
- **WebSocket Upgrade** (pada `http.Server`) → koneksi signaling room WebRTC.

---

## 2. Game & Matchmaking WebSocket (`apps/backend-websockets`)

Format envelope pesan (`WSMessage` di `handlers.go`):

```json
{
  "event": "EVENT_NAME",
  "payload": {}
}
```

### Daftar Event Masuk yang Ditangani Server
| Event | Payload Utama | Fungsi |
| :--- | :--- | :--- |
| `FRAME_CREATE` | `{ username }` | Membuat lobby/frame baru |
| `PLAYER_JOIN` | `{ frameId, username }` | Bergabung ke lobby yang ada via invite/frame ID |
| `SEARCH_START` | `{ frameId }` | Memasukkan lobby ke antrean matchmaking |
| `FRAME_NEXT` | `{ frameId, sessionId }` | Skip match saat ini dan cari lawan baru |
| `FRAME_LEAVE` | `{ frameId, sessionId }` | Keluar dari match/lobby |
| `DEVICE_STATE_CHANGE` | `{ sessionId, userId, cameraEnabled, microphoneEnabled }` | Sinkronisasi status kamera/mikrofon ke peer |
| `GAME_INVITE` | `{ sessionId, gameType }` | Mengirim undangan mini-game |
| `GAME_ACCEPT` | `{ sessionId }` | Menerima undangan mini-game |
| `GAME_DECLINE` | `{ sessionId }` | Menolak undangan mini-game |
| `GAME_STOP` | — | Menghentikan sesi mini-game |
| `CANVAS_START`, `CANVAS_MOVE`, `CANVAS_END` | data stroke canvas | Sinkronisasi gambar pada game tebak gambar |
| `GUESS_SUBMIT` | `{ sessionId, playerId, guessText }` | Mengirim tebakan pada mini-game |
| `CHAT_MESSAGE` | `{ text }` | Mengirim pesan text chat dalam match |
| `MUTE_USER` | `{ targetUserId, isMuted }` | Mengubah status mute user target |
| `REPORT_USER` | `{ targetUserId, reason }` | Melaporkan user |
| `RETURN_TO_LOBBY` | — | Kembali ke lobby |

---

## 3. WebRTC Signaling WebSocket (`apps/backend-webrtc`)

Format pesan menggunakan field `type`:

```json
{
  "type": "join",
  "roomID": "room-uuid",
  "userId": "user-uuid"
}
```

### Pesan Client → Server
| `type` | Field Penting | Keterangan |
| :--- | :--- | :--- |
| `join` | `roomID`, `userId` | Masuk ke signaling room |
| `offer` | `offer`, `targetId` | Meneruskan SDP offer ke peer target |
| `answer` | `answer`, `targetId` | Meneruskan SDP answer ke peer target |
| `ice-candidate` | `candidate`, `targetId` | Meneruskan ICE candidate ke peer target |
| `leave` | — | Keluar dari room dan membersihkan state |

### Pesan Server → Client
| `type` | Field Penting | Keterangan |
| :--- | :--- | :--- |
| `ice-servers` | `iceServers` | Daftar fallback STUN/Metered dari signaling server *(frontend memprioritaskan Cloudflare TURN dari `/api/turn-credentials`)* |
| `user-joined` | `userId` | Notifikasi ada peer baru bergabung ke room |
| `peer-ready` | `role` (`offerer` \| `answerer`), `peerId` | Menentukan siapa yang membuat SDP offer agar tidak terjadi *glare* |
| `offer` / `answer` / `ice-candidate` | `sender`, payload WebRTC | Pesan yang diteruskan dengan identitas `sender` dari server |
| `user-left` | `userId` | Notifikasi peer meninggalkan room |
