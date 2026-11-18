# Panduan Deployment (Coolify + Cloudflare Tunnel)

Funfram di-deploy ke **Coolify** sebagai **3 Application Resource terpisah** (`Build Pack: Dockerfile`) agar setiap service dapat di-build, di-scale, dan di-restart secara independen tanpa memutus koneksi WebSocket aktif.

> Semua domain dan kredensial pada dokumen ini menggunakan placeholder generik (`app.example.com`, `<...>`).

---

## 1. Konfigurasi Resource di Coolify

### Resource 1 — `funfram-frontend` (Next.js)
- **Base Directory:** `/apps/frontend-nextjs`
- **Dockerfile Location:** `/Dockerfile`
- **Watch Paths:** `apps/frontend-nextjs/**`
- **Ports Exposes:** `3000` *(kosongkan Ports Mappings jika lewat Coolify Proxy)*
- **Domains:** `http://<app.example.com>`

**Environment Variables:**
- **Build + Runtime** *(wajib centang `Available at Buildtime` karena di-inline saat `npm run build`)*:
  - `NEXT_PUBLIC_APP_URL=https://<app.example.com>`
  - `NEXT_PUBLIC_WS_GAME_URL=wss://<ws.example.com>`
  - `NEXT_PUBLIC_WS_WEBRTC_URL=wss://<webrtc.example.com>`
- **Runtime-only** *(jangan centang Buildtime)*:
  - `NODE_ENV=production`
  - `CLOUDFLARE_TURN_KEY_ID=<cloudflare-turn-key-id>`
  - `CLOUDFLARE_TURN_API_TOKEN=<cloudflare-turn-api-token>`
  - *(Opsional fallback)* `METERED_DOMAIN=<metered-domain>`
  - *(Opsional fallback)* `METERED_API_KEY=<metered-api-key>`

---

### Resource 2 — `funfram-backend-websockets` (Go)
- **Base Directory:** `/apps/backend-websockets`
- **Dockerfile Location:** `/Dockerfile`
- **Watch Paths:** `apps/backend-websockets/**`
- **Ports Exposes:** `5001`
- **Health Check Path:** `/health`
- **Domains:** `http://<ws.example.com>`

**Environment Variables (Runtime-only):**
- `PORT=5001`
- `DATABASE_URL=<postgresql-connection-string>`

---

### Resource 3 — `funfram-backend-webrtc` (Node.js)
- **Base Directory:** `/apps/backend-webrtc`
- **Dockerfile Location:** `/Dockerfile`
- **Watch Paths:** `apps/backend-webrtc/**`
- **Ports Exposes:** `5002`
- **Health Check Path:** `/health`
- **Domains:** `http://<webrtc.example.com>`

**Environment Variables (Runtime-only):**
- `PORT=5002`
- *(Opsional)* `METERED_DOMAIN=<metered-domain>`
- *(Opsional)* `METERED_API_KEY=<metered-api-key>`

---

## 2. Routing Cloudflare Tunnel & Coolify Proxy

1. Di Cloudflare Zero Trust Tunnel, arahkan ketiga public hostname ke Coolify Proxy port `80`:
   - `<app.example.com>` → `http://localhost:80`
   - `<ws.example.com>` → `http://localhost:80`
   - `<webrtc.example.com>` → `http://localhost:80`
2. Di Coolify, gunakan skema `http://` pada field **Domains** agar Traefik/Coolify Proxy tidak memicu redirect HTTPS berulang (terminasi TLS dilakukan di Cloudflare Edge).

---

## 3. Verifikasi & Troubleshooting

### Verifikasi Pasca-Deploy
- `https://<app.example.com>/api/turn-credentials` → mengembalikan JSON `{ "iceServers": [...] }` dari Cloudflare TURN.
- `https://<ws.example.com>/health` → mengembalikan `200 OK` (`{"status":"ok","service":"backend-websockets"}`).
- `https://<webrtc.example.com>/health` → mengembalikan `200 OK` (`{"status":"ok","service":"backend-webrtc"}`).

### Catatan Troubleshooting Umum
- **Error `lstat .../apps/<service>/apps: no such file or directory` saat build:** `Dockerfile Location` di Coolify masih tertulis `/apps/<service>/Dockerfile` padahal `Base Directory` sudah `/apps/<service>`. Ubah `Dockerfile Location` menjadi `/Dockerfile`.
- **Error `npm install` melewati `devDependencies` saat build frontend:** Pastikan `NODE_ENV=production` tidak dicentang sebagai *Buildtime* variable.
- **Error `EHOSTUNREACH` IPv6 saat `npm ci` di Docker:** Gunakan base image `node:20-alpine` (sudah diterapkan di semua Dockerfile Node.js).
- **Log `[ICE ERROR] errorCode: 701` di Console browser:** Perilaku normal browser saat mencoba bind interface lokal/IPv6 yang tidak memiliki rute keluar ke salah satu transport TURN; selama `type: "relay"` tetap muncul dan call terhubung, log ini aman diabaikan.
