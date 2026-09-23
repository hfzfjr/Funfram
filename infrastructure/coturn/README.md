# CoTURN Setup Instructions

## HASIL VERIFIKASI LANGKAH 0:

✅ **DNS Verification:** `turn.roomify.space` mengarah ke `182.253.158.158` (benar)
❌ **Firewall Status:** Port 80 TIDAK terbuka di ufw
✅ **Port 80 Usage:** Tidak ada service yang listen di port 80

**Kesimpulan:** Harus menggunakan DNS-01 challenge untuk Let's Encrypt certificate.

## LANGKAH 3 - Setup Certificate TLS (Manual Execution)

Karena port 80 tidak terbuka, gunakan DNS-01 challenge dengan Cloudflare. Certificate akan di-generate manual di server dan di-mount ke container coturn.

### Symlink Validity Check

**Struktur Certbot:**
```
/etc/letsencrypt/
├── live/
│   └── turn.roomify.space/
│       ├── fullchain.pem -> ../../archive/turn.roomify.space/fullchain1.pem
│       ├── privkey.pem -> ../../archive/turn.roomify.space/privkey1.pem
│       └── ...
└── archive/
    └── turn.roomify.space/
        ├── fullchain1.pem
        ├── privkey1.pem
        └── ...
```

**Keputusan:** Mount `/etc/letsencrypt` penuh sudah cukup karena symlink certbot menggunakan relative path (`../../archive/`), sehingga akan tetap valid di dalam container. Tidak perlu mount folder archive secara terpisah.

### Draft Command Certbot (Untuk Eksekusi Manual di Server)

Jalankan perintah berikut di server Debian Anda:

```bash
# 1. Install certbot dan cloudflare DNS plugin
sudo apt update
sudo apt install certbot python3-certbot-dns-cloudflare

# 2. Buat file credential Cloudflare
sudo mkdir -p /root/.secrets
sudo nano /root/.secrets/cloudflare.ini
```

Isi file `/root/.secrets/cloudflare.ini` dengan (ganti YOUR_TOKEN dengan Cloudflare API Token Anda):
```
dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN
```

```bash
# 3. Set permission file credential (sangat penting)
sudo chmod 600 /root/.secrets/cloudflare.ini

# 4. Generate certificate menggunakan DNS-01 challenge dengan deploy-hook
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d turn.roomify.space \
  --deploy-hook "cd /home/funfram/funfram && docker-compose restart coturn"

# 5. Verifikasi certificate ter-generate
sudo ls -la /etc/letsencrypt/live/turn.roomify.space/
# Harus ada: fullchain.pem, privkey.pem, dsaparam.pem, chain.pem
```

### Setup Auto-Renewal (Dengan Deploy-Hook)

Certbot sudah di-setup dengan `--deploy-hook` yang akan otomatis restart container coturn setiap renewal. Pastikan cron job certbot sudah aktif:

```bash
# Cek apakah certbot timer sudah aktif
sudo systemctl status certbot.timer
# Jika tidak aktif, enable:
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Atau setup manual cron job (fallback)
sudo crontab -e
# Tambahkan baris ini (renew setiap hari jam 3 pagi):
0 3 * * * certbot renew --quiet --deploy-hook "cd /path/to/funfram && docker-compose restart coturn" >> /var/log/coturn-cert-renewal.log 2>&1
```

### Update Config Repo (SUDAH DILAKUKAN)

**docker-compose.yml:**
- Menambahkan volume mount: `/etc/letsencrypt:/etc/letsencrypt:ro`
- Menghapus volume mount lama: `./infrastructure/coturn/certs:/etc/coturn/certs:ro`

**turnserver.conf:**
- Update certificate path ke: `/etc/letsencrypt/live/turn.roomify.space/fullchain.pem`
- Update private key path ke: `/etc/letsencrypt/live/turn.roomify.space/privkey.pem`

### Restart Container Setelah Certificate Ter-generate

```bash
# Pastikan certificate sudah ada
sudo ls -la /etc/letsencrypt/live/turn.roomify.space/

# Pull changes dari repo (jika perlu)
cd /home/funfram/funfram
git pull

# Restart docker compose
docker-compose down
docker-compose up -d

# Cek log coturn untuk memastikan TLS berjalan
docker-compose logs -f coturn
```

**Expected log output:**
```
turnserver: listening at 0.0.0.0:3478
turnserver: listening at 0.0.0.0:8443
turnserver: listening at 0.0.0.0:443 (TLS)
turnserver: TLS certificate file /etc/letsencrypt/live/turn.roomify.space/fullchain.pem found
turnserver: TLS private key file /etc/letsencrypt/live/turn.roomify.space/privkey.pem found
```

## LANGKAH 6 - Verifikasi

### 1. Verifikasi CoTURN berjalan dengan TLS

```bash
# Cek apakah coturn listen di port 443
sudo ss -tlnp | grep :443

# Test TURN connection (gunakan turnutils_uclient)
sudo apt install turnserver-utils
turnutils_uclient -v -u funfram -w letsgooo_Funfram turn.roomify.space:443

# Test TLS connection dengan openssl
openssl s_client -connect turn.roomify.space:443 -servername turn.roomify.space
```

### 2. Verifikasi di Browser (chrome://webrtc-internals)

1. Buka Chrome dan ketik `chrome://webrtc-internals` di address bar
2. Start call di FunFram
3. Di webrtc-internals, cari ICE candidate pair yang "selected"
4. Periksa apakah ada candidate dengan:
   - Type: `relay`
   - Protocol: `tcp` atau `tls`
   - Port: `443`
   - Address: `turn.roomify.space` atau `182.253.158.158`

### 3. Test dari Jaringan Berbeda

- **Data Seluler**: Test dari smartphone dengan data seluler
- **Kantor/Kampus**: Test dari jaringan kantor/kampus yang strict
- **Home WiFi**: Test dari WiFi rumah normal

Untuk setiap jaringan, screenshot ICE candidate yang terpilih dan laporkan:
- Candidate type (host, srflx, prflx, relay)
- Protocol (udp, tcp, tls)
- Port yang digunakan
- Address/IP

### 4. Debug Logging (Sudah Ditambahkan di webrtc.service.ts)

Debug logging untuk ICE candidates sudah ditambahkan di `webrtc.service.ts`:
```typescript
console.log(`[WebRtcService] ICE Candidate for ${participantId}:`, {
    type: event.candidate.type,
    protocol: event.candidate.protocol,
    port: event.candidate.port,
    address: event.candidate.address,
    candidate: event.candidate.candidate
});
```

Buka browser console saat call untuk melihat semua ICE candidates yang di-gather.

## Troubleshooting

### Coturn tidak bisa bind port 443
- Pastikan `cap_add: NET_BIND_SERVICE` sudah ada di docker-compose.yml ✅
- Cek log: `docker-compose logs coturn`

### Certificate error
- Pastikan file certificate ada: `sudo ls -la /etc/letsencrypt/live/turn.roomify.space/`
- Pastikan permission: `sudo ls -la /etc/letsencrypt/`
- Cek log coturn: `docker-compose logs coturn`
- Verify certificate: `openssl x509 -in /etc/letsencrypt/live/turn.roomify.space/fullchain.pem -text -noout`

### TURNS tidak connect
- Pastikan DNS turn.roomify.space mengarah ke IP yang benar: `dig turn.roomify.space`
- Test dengan openssl: `openssl s_client -connect turn.roomify.space:443`
- Cek firewall: `sudo ufw status`
- Cek apakah port 443 listen: `sudo ss -tlnp | grep :443`

### Docker volume mount error
- Pastikan path `/etc/letsencrypt` ada di host
- Pastikan permission file: `sudo ls -la /etc/letsencrypt/live/turn.roomify.space/`
- Cek docker log: `docker-compose logs coturn`

### Certificate renewal tidak restart container
- Cek deploy-hook di certbot: `sudo certbot certificates`
- Test manual renewal: `sudo certbot renew --dry-run --deploy-hook "cd /path/to/funfram && docker-compose restart coturn"`
- Cek log renewal: `sudo cat /var/log/coturn-cert-renewal.log`

## LANGKAH 6 - Verifikasi

### 1. Verifikasi CoTURN berjalan dengan TLS

```bash
# Cek apakah coturn listen di port 443
sudo netstat -tlnp | grep :443
# atau
sudo ss -tlnp | grep :443

# Test TURN connection (gunakan turnutils_uclient)
sudo apt install turnserver-utils
turnutils_uclient -v -u funfram -w letsgooo_Funfram turn.roomify.space:443
```

### 2. Verifikasi di Browser (chrome://webrtc-internals)

1. Buka Chrome dan ketik `chrome://webrtc-internals` di address bar
2. Start call di FunFram
3. Di webrtc-internals, cari ICE candidate pair yang "selected"
4. Periksa apakah ada candidate dengan:
   - Type: `relay`
   - Protocol: `tcp` atau `tls`
   - Port: `443`
   - Address: `turn.roomify.space` atau `182.253.158.158`

### 3. Test dari Jaringan Berbeda

- **Data Seluler**: Test dari smartphone dengan data seluler
- **Kantor/Kampus**: Test dari jaringan kantor/kampus yang strict
- **Home WiFi**: Test dari WiFi rumah normal

Untuk setiap jaringan, screenshot ICE candidate yang terpilih dan laporkan:
- Candidate type (host, srflx, prflx, relay)
- Protocol (udp, tcp, tls)
- Port yang digunakan
- Address/IP

### 4. Tambahkan Logging Debug (Sementara)

Di `webrtc.service.ts`, tambahkan logging untuk ICE candidates:

```typescript
pc.onicecandidate = (event) => {
    if (event.candidate) {
        console.log(`[WebRtcService] ICE Candidate for ${participantId}:`, {
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            port: event.candidate.port,
            address: event.candidate.address,
            candidate: event.candidate.candidate
        });
        // ... existing code
    }
};
```

## Restart Service Setelah Setup

```bash
# Pastikan certificate sudah ada di folder yang benar
ls -la /path/to/funfram/infrastructure/coturn/certs/

# Restart docker compose
cd /path/to/funfram
docker-compose down
docker-compose up -d

# Cek log coturn
docker-compose logs -f coturn
```

## Troubleshooting

### Coturn tidak bisa bind port 443
- Pastikan `cap_add: NET_BIND_SERVICE` sudah ada di docker-compose.yml
- Atau jalankan container sebagai root (tidak recommended)

### Certificate error
- Pastikan file certificate ada dan permission benar
- Cek log coturn: `docker-compose logs coturn`
- Verify certificate: `openssl x509 -in fullchain.pem -text -noout`

### TURNS tidak connect
- Pastikan DNS turn.roomify.space mengarah ke IP yang benar
- Test dengan openssl: `openssl s_client -connect turn.roomify.space:443`
- Cek firewall: `sudo ufw status`
