# Deployment Guide - Funfram.com

## Prerequisites
- Debian 13 server
- Docker & Docker Compose installed
- Cloudflare account dengan domain
- Git

## 1. Install Cloudflare Tunnel (cloudflared)

### Di Debian 13:

```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Install
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify installation
cloudflared --version
```

## 2. Setup Cloudflare Tunnel

### Login ke Cloudflare:

```bash
cloudflared tunnel login
```

- Ini akan membuka browser
- Pilih domain kamu di Cloudflare
- Authorize cloudflared

### Buat Tunnel Baru:

```bash
# Buat tunnel dengan nama "funfram"
cloudflared tunnel create funfram

# Output akan menampilkan:
# - Tunnel ID
# - Simpan Tunnel ID ini
```

### Konfigurasi Tunnel:

Buat file konfigurasi:

```bash
sudo nano ~/.cloudflared/config.yml
```

Isi dengan:

```yaml
tunnel: <TUNNEL_ID_FROM_PREVIOUS_STEP>
credentials-file: /home/<YOUR_USERNAME>/.cloudflared/<TUNNEL_ID>.json

ingress:
  # Frontend (Next.js)
  - hostname: funfram.com
    service: http://localhost:3000
  
  # Backend WebSocket (Game)
  - hostname: socket.funfram.com
    service: http://localhost:5001
  
  # Backend WebRTC
  - hostname: webrtc.funfram.com
    service: http://localhost:5002
  
  # Catch-all (optional)
  - service: http_status:404
```

### Route DNS:

```bash
# Route tunnel ke domain
cloudflared tunnel route dns funfram funfram.com
cloudflared tunnel route dns funfram socket.funfram.com
cloudflared tunnel route dns funfram webrtc.funfram.com
```

### Jalankan Tunnel:

```bash
# Test run
cloudflared tunnel run funfram

# Atau sebagai service (production)
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

## 3. Konfigurasi UFW Firewall

### Install UFW (jika belum):

```bash
sudo apt update
sudo apt install ufw -y
```

### Konfigurasi Firewall:

```bash
# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (penting!)
sudo ufw allow 22/tcp

# Allow Docker ports (internal only)
sudo ufw allow from 127.0.0.1 to any port 3000
sudo ufw allow from 127.0.0.1 to any port 5001
sudo ufw allow from 127.0.0.1 to any port 5002

# Allow Cloudflare tunnel (jika perlu)
sudo ufw allow from 127.0.0.1 to any port

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

**Catatan:** Dengan Cloudflare tunneling, kamu tidak perlu membuka port 80/443 ke public karena traffic masuk melalui tunnel.

## 4. Deploy Project

### Clone Repository:

```bash
cd /opt
sudo git clone https://github.com/<USERNAME>/funfram.git
cd funfram
```

### Setup Environment Variables:

```bash
cp .env.example .env
nano .env
```

Update dengan nilai production:

```env
# Frontend
NEXT_PUBLIC_WS_GAME_URL=wss://socket.funfram.com/socket
NEXT_PUBLIC_WS_WEBRTC_URL=wss://webrtc.funfram.com

# Backend WebSocket
PORT=5001

# Backend WebRTC
PORT=5002
TURN_SERVER_URL=turn:turn.funfram.com:3478
TURN_USERNAME=funfram
TURN_CREDENTIAL=<GANTI_DENGAN_PASSWORD_KUAT>

# Database (opsional untuk sekarang)
# DATABASE_URL=postgresql://...
```

### Build dan Jalankan dengan Docker:

```bash
# Build images
docker compose build

# Jalankan di background
docker compose up -d

# Check logs
docker compose logs -f
```

## 5. Konfigurasi DNS di Cloudflare

Di Cloudflare Dashboard:

1. **DNS Records**:
   - `funfram.com` → CNAME → Tunnel (otomatis dari cloudflared)
   - `socket.funfram.com` → CNAME → Tunnel
   - `webrtc.funfram.com` → CNAME → Tunnel
   - `turn.funfram.com` → A Record → IP server (jika pakai TURN server lokal)

2. **SSL/TLS**:
   - Mode: **Full**
   - Always Use HTTPS: **On**
   - Automatic HTTPS Rewrites: **On**

## 6. Konfigurasi TURN Server (Opsional)

Jika ingin menggunakan TURN server lokal:

### Update docker-compose.yml:

```yaml
coturn:
  image: coturn/coturn:4.6.2
  command:
    - -n
    - --log-file=stdout
    - --external-ip=<SERVER_PUBLIC_IP>
    - --fingerprint
    - --lt-cred-mech
    - --user=funfram:<STRONG_PASSWORD>
    - --realm=funfram.com
    - --no-cli
    - --no-tlsv1
    - --no-tlsv1_1
    - --no-stdout-log
  network_mode: "host"
  ports:
    - "3478:3478/udp"
    - "3478:3478/tcp"
    - "5349:5349/udp"
    - "5349:5349/tcp"
```

### Update Firewall untuk TURN:

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/udp
sudo ufw allow 5349/tcp
```

## 7. Monitoring dan Maintenance

### Check Service Status:

```bash
# Cloudflare tunnel
sudo systemctl status cloudflared

# Docker containers
docker compose ps

# Docker logs
docker compose logs -f frontend-nextjs
docker compose logs -f backend-websockets
docker compose logs -f backend-webrtc
```

### Restart Services:

```bash
# Restart tunnel
sudo systemctl restart cloudflared

# Restart Docker services
docker compose restart
```

### Update Project:

```bash
cd /opt/funfram
git pull
docker compose down
docker compose build
docker compose up -d
```

## Troubleshooting

### Tunnel tidak connect:
```bash
# Check tunnel logs
sudo journalctl -u cloudflared -f

# Re-authenticate
cloudflared tunnel login
cloudflared tunnel run funfram
```

### Docker container tidak start:
```bash
# Check logs
docker compose logs

# Rebuild
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Firewall blocking:
```bash
# Check status
sudo ufw status verbose

# Allow specific port jika perlu
sudo ufw allow <PORT>
```

### WebRTC tidak connect:
- Pastikan TURN server berjalan
- Check firewall untuk port 3478, 5349
- Verify TURN credentials di .env
