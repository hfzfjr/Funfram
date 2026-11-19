# Prompt Antigravity (Orchestrator) — Perencanaan Funfram

Salin seluruh isi blok di bawah ini ke Antigravity. Output yang diharapkan: `docs/PLAN.md`.

```
PERAN
Kamu adalah ORCHESTRATOR PERENCANAAN untuk proyek "Funfram" (monorepo di root proyek ini): platform web real-time untuk video chat acak berbasis "frame" (lobby 1-2 orang), invite teman, dan mini-game multiplayer. Bagi pekerjaan ke sub-agent jika perlu (mis. agent Backend Go, agent Frontend/WebRTC, agent Infra/DevOps, agent Produk/Riset Kompetitor, agent Keamanan & Moderasi), lalu gabungkan hasilnya.

MODE: PLANNING SAJA
- DILARANG mengubah kode sumber, konfigurasi, atau dependensi.
- SATU-SATUNYA file yang boleh dibuat: docs/PLAN.md (di folder /docs pada root proyek). Jika sudah ada, jangan timpa; buat docs/PLAN.md versi baru dan catat revisinya.
- DILARANG membaca atau mencetak isi file .env / .env.local / secret apa pun.
- Tulis PLAN.md dalam Bahasa Indonesia (istilah teknis boleh Inggris).
- Frontend memakai versi Next.js yang punya breaking changes (lihat apps/frontend-nextjs/AGENTS.md). Sebelum merekomendasikan perubahan Next.js, baca node_modules/next/dist/docs/ yang relevan.

KONTEKS ARSITEKTUR (verifikasi sendiri, jangan percaya buta)
- apps/frontend-nextjs: Next.js App Router, Tailwind, Zustand, WebRtcService (mesh P2P), route /api/turn-credentials (Cloudflare Realtime TURN, fallback Metered).
- apps/backend-websockets: Go (gorilla/websocket, pgx). Lobby, matchmaking FIFO in-memory, chat, device state, mini-game tebak gambar (game.go), report/block, REJOIN_SESSION dengan grace 12 detik.
- apps/backend-webrtc: Node.js (ws) signaling room.
- infrastructure/postgres/init.sql (Supabase), docker-compose.yml (dev), docs/*.md. Produksi: Coolify + Cloudflare Tunnel di server rumah (CGNAT, tanpa IP publik).
- Baca seluruh docs/ dan kode yang relevan sebelum menulis rencana. Setiap temuan HARUS menyebut file dan fungsi/baris yang jadi bukti.

HIPOTESIS TEMUAN AWAL (dari audit pendahuluan; verifikasi satu per satu, tandai Terkonfirmasi / Salah / Sebagian)
Keamanan:
 S1. REJOIN_SESSION (handlers.go) mengambil alih client berdasarkan userId+frameId dari payload, padahal keduanya dikirim ke lawan lewat payload MATCH_FOUND, sehingga bisa dibajak.
 S2. Signaling Node (server.js) mempercayai userId dari klien dan menutup socket lama ber-appUserId sama; tidak ada token dari server Go.
 S3. DEVICE_STATE_CHANGE, MUTE_USER, GAME_STOP, GAME_DECLINE, GAME_ACCEPT tidak memvalidasi kepemilikan user/session; inviter bisa accept undangannya sendiri.
 S4. CheckOrigin selalu true; tidak ada SetReadLimit, rate limit pesan, batas panjang chat/username, sanitasi.
 S5. /api/turn-credentials: proteksi header X-Funfram-Client mudah dipalsukan; rate limit pakai x-forwarded-for entri pertama (bisa di-spoof) dan map tidak dibersihkan; TTL 24 jam -> risiko penyalahgunaan biaya TURN.
 S6. Invite HMAC: secret ada di bundle klien (hmac.ts) dan backend tidak memverifikasi; tabel invite_links + CreateInviteLink/ValidateInviteLink tidak dipakai.
 S7. Tidak ada age gate, ToS/consent, moderasi konten (NSFW), atau ban permanen; report hanya log + block di memori berbasis ID sementara.
Reliabilitas/performa:
 R1. MATCH_FOUND dikirim ulang setelah game selesai -> onMatchFound memanggil connectWebRTC -> semua peer ditutup dan disambung ulang (video berkedip).
 R2. Signaling Node langsung broadcast user-left saat socket putus (tanpa grace period) -> panggilan bisa putus karena gangguan sesaat.
 R3. Client.ExplicitLeave tidak di-reset setelah FRAME_LEAVE lalu FRAME_CREATE.
 R4. client.Send (tanpa write deadline) dipanggil saat memegang hub.mu.Lock (createMatch/AddToMatchmaking) -> satu klien lambat bisa menahan seluruh hub.
 R5. Data race pada field Client (ID, LobbyID, Presence, Conn, ExplicitLeave, DisconnectTimer). Analisis area risikonya secara konseptual (go vet / go test -race).
 R6. Iterasi linear hub.matches pada tiap event chat/canvas; matchmaking O(n); semua state in-memory satu instance (tidak bisa scale horizontal, hilang saat restart).
 R7. UpdateScore menimpa skor; user ID baru tiap koneksi (GetOrCreateUser memberi suffix acak) -> leaderboard tak bermakna; satu baris users per koneksi; query DB sinkron di read loop tanpa timeout.
 R8. Tidak ada janitor idle lobby (frontend menunggu error "frame idle timeout" yang tidak pernah dikirim backend); LastActivity tidak dipakai.
 R9. Mesh WebRTC sampai 4 peserta -> 3 peer connection per klien; tanpa batas bitrate/simulcast; stats kualitas dikumpulkan tapi tidak dipakai; "perfect negotiation" belum benar-benar diimplementasikan (makingOffer/ignoreOffer tidak dibaca).
 R10. Game catur/ludo/uno hanya relay GAME_ACTION (client-authoritative, bisa curang; info tersembunyi bisa bocor). trimLower membuang semua non-huruf ("Es Krim" == "eskrim").
 R11. Cek di UI: apakah sendGeneralMessage dan reportUser di useCallStore benar-benar mengirim CHAT_MESSAGE / REPORT_USER ke server.
Infra/repo:
 I1. Server rumah tunggal di belakang CGNAT + Cloudflare Tunnel = single point of failure; tidak ada metrik, log terstruktur, tes, atau CI/CD.
 I2. Dockerfile: berjalan sebagai root, alpine:latest tanpa ca-certificates (Go), npm ci --production (deprecated), tanpa HEALTHCHECK.
 I3. docker-compose.yml memberi NEXT_PUBLIC_* sebagai env runtime padahal di-inline saat build.
 I4. .env.example basi (Coturn/OpenRelay) dan punya dua PORT bentrok; .npm-cache/ tidak di-.gitignore; root package.json menduplikasi dependensi Next dengan versi berbeda; kode mati (api.service createFrame mock, supabase.repository stub, store.joinFrame -> FRAME_JOIN tidak ada di backend, ensureSchema menggandakan init.sql, presence CHECK di init.sql tidak mencakup DRAWING/GUESSING/RECONNECTING).
 I5. Log mencetak kredensial ICE di console browser; backend mencetak event dan ID user di stdout.

TUGAS RISET
1. Riset web kompetitor: ome.tv, umingle.com, dan 2-3 platform sejenis yang masih aktif (mis. Chatroulette, Emerald Chat, dsb.; verifikasi status terkini, Omegle sudah tutup 2023). Bandingkan: fitur (filter, minat, gender/negara, teks vs video, game, mobile app), model monetisasi, moderasi dan keselamatan, retensi, performa/latensi, batasan (usia, region), dan pola infrastruktur yang bisa disimpulkan secara publik (P2P vs SFU, TURN, signaling). Jangan mengarang detail internal; tandai sebagai "inferensi" bila tidak ada sumber. Cantumkan sumber/URL.
2. Evaluasi arsitektur media: mesh P2P (sekarang) vs SFU (LiveKit, mediasoup, Cloudflare Calls/Realtime SFU, dsb.). Buat decision matrix (biaya, kompleksitas, latensi, kebutuhan bandwidth upstream server rumah, kemudahan moderasi/rekam bukti) dan rekomendasi.
3. Evaluasi infra: tentukan apa yang tetap di server rumah vs dipindah (VPS/edge), strategi HA, state matchmaking (Redis/NATS vs in-memory), observability, backup, CI/CD, biaya bulanan perkiraan pada 100 / 1.000 / 10.000 pengguna bersamaan.
4. Ide inovasi agar pengguna tertarik dan betah. Minimal pertimbangkan (nilai dan tambah sendiri): cold-start bot/AI partner saat antrean kosong; ice-breaker otomatis (kartu topik, mini-game cepat saat hening); matching minat/bahasa/vibe dan ruang bertema (belajar bahasa, mabar, belajar bareng); mode avatar berbasis face tracking (MediaPipe) untuk privasi dan keamanan; caption/terjemahan real-time; sistem teman, "undo skip", dan reconnect mutual-like; akun opsional (passkey/OAuth) + XP, streak, badge, leaderboard musiman; turnamen/event terjadwal; trust score dan shadow queue untuk pelanggar; watch-party/papan gambar bersama. Untuk setiap ide beri skor RICE (Reach, Impact, Confidence, Effort), risiko keselamatan, dan dependensi teknis.
5. Keselamatan, moderasi, dan kepatuhan: usulan age gate 18+, ToS/Privacy, alur report + bukti, deteksi NSFW (on-device dan/atau server), ban berbasis device/IP-hash, retensi data minimal. Catat hal yang perlu dicek untuk pasar Indonesia (mis. UU PDP, kewajiban pendaftaran PSE) sebagai "perlu verifikasi hukum", bukan nasihat hukum.

FORMAT OUTPUT: docs/PLAN.md
Struktur wajib:
 0. Ringkasan eksekutif (maks. 15 baris) + visi produk
 1. Status audit: tabel hipotesis (ID, status Terkonfirmasi/Salah/Sebagian, bukti file:fungsi, dampak, severity P0-P3)
 2. Temuan tambahan hasil audit kamu yang tidak ada di daftar di atas
 3. Analisis kompetitor (tabel + sumber) dan posisi diferensiasi Funfram
 4. Arsitektur target (diagram Mermaid) + decision matrix mesh vs SFU, keputusan dan alasan
 5. Rencana perbaikan kode, per layanan (Go, Node signaling, Next.js), tiap tugas berformat:
    ID | judul | file terkait | deskripsi | acceptance criteria teruji | estimasi (S/M/L) | dependensi | risiko | agent yang cocok
 6. Rencana infrastruktur (HA, scaling, observability, CI/CD, hardening Docker, biaya)
 7. Backlog inovasi (tabel RICE) dan pilihan 3 ide "bet besar" beserta MVP-nya
 8. Roadmap berfase: Fase 0 Hotfix keamanan (P0), Fase 1 Stabilitas & fondasi, Fase 2 Retensi & fitur sosial, Fase 3 Skala & monetisasi. Tiap fase: tujuan, daftar ID tugas, urutan, exit criteria.
 9. Strategi pengujian (unit, integrasi WebSocket, load test matchmaking, uji jaringan buruk/mobile, uji keamanan) dan metrik sukses (time-to-match, rasio koneksi sukses, durasi sesi median, skip rate, D1/D7 retention, laporan per 1.000 sesi, biaya TURN per jam sesi)
 10. Risiko & asumsi terbuka, serta pertanyaan untuk pemilik proyek
 Lampiran: urutan eksekusi yang bisa langsung didelegasikan ke sub-agent (checklist berurutan).

KRITERIA SELESAI
- Setiap klaim teknis punya bukti file/fungsi; setiap klaim kompetitor punya sumber atau ditandai inferensi.
- Tugas di bagian 5 cukup spesifik untuk dikerjakan agent coding tanpa bertanya ulang.
- Tidak ada perubahan pada file selain docs/PLAN.md.
```
