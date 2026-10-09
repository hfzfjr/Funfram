#!/usr/bin/env bash
#
# FunFram deploy script (dijalankan oleh GitHub Actions self-hosted runner)
#
# Alur:  pull kode -> build image baru -> ganti container -> health check
#        -> hapus image lama (hanya milik project ini)
#
# Prinsip: container lama TIDAK disentuh sampai build image baru berhasil.
# Kalau build gagal, aplikasi yang sedang jalan tetap aman.
#
# Opsi (env var):
#   DEPLOY_BRANCH=main   branch yang di-pull
#   NO_CACHE=1           build tanpa cache (lebih lambat)

set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
APP_DIR="$(dirname "$SCRIPT_PATH")"
BRANCH="${DEPLOY_BRANCH:-main}"
LOCK_FILE="/tmp/funfram-deploy.lock"
HEALTH_TIMEOUT=120   # detik

FRONTEND_PORT=3001
WS_GAME_PORT=5001
WS_WEBRTC_PORT=5002

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ❌ $*" >&2; exit 1; }
dc()   { docker compose "$@"; }

trap 'echo "[$(date "+%H:%M:%S")] ❌ Deploy gagal pada perintah: $BASH_COMMAND" >&2' ERR

# Cegah dua deploy jalan bersamaan (dilewati kalau script dijalankan ulang oleh dirinya sendiri)
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || { echo "⚠️  Deploy lain sedang berjalan, dibatalkan." >&2; exit 1; }
fi

wait_port() {
  local port=$1 waited=0
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

wait_http() {
  local port=$1 waited=0 code
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$port/" || true)"
    # 2xx/3xx dianggap sehat (root frontend me-redirect ke /funvideo)
    if [ "${code:-000}" -ge 200 ] && [ "${code:-000}" -lt 400 ]; then return 0; fi
    sleep 2; waited=$((waited + 2))
  done
  return 1
}

check_health() {
  log "⏳ Menunggu service sehat (maks ${HEALTH_TIMEOUT}s per service)..."
  wait_http "$FRONTEND_PORT"   || { echo "Frontend (port $FRONTEND_PORT) tidak merespons" >&2; return 1; }
  wait_port "$WS_GAME_PORT"    || { echo "WebSocket game (port $WS_GAME_PORT) tidak terbuka" >&2; return 1; }
  wait_port "$WS_WEBRTC_PORT"  || { echo "WebRTC signaling (port $WS_WEBRTC_PORT) tidak terbuka" >&2; return 1; }

  # Pastikan tidak ada container yang crash-loop
  if [ -n "$(dc ps --status restarting -q)" ]; then
    echo "Ada container yang restart terus-menerus" >&2
    return 1
  fi
  return 0
}

main() {
  cd "$APP_DIR"
  log "🚀 Memulai deploy FunFram di $APP_DIR"

  # --- Pre-check (tidak install apa pun otomatis; runner tidak punya sudo) ---
  command -v docker >/dev/null 2>&1       || fail "Docker belum terinstall"
  docker compose version >/dev/null 2>&1  || fail "Docker Compose plugin belum terinstall"
  command -v curl >/dev/null 2>&1         || fail "curl belum terinstall"
  [ -f .env ]                             || fail ".env tidak ditemukan di $APP_DIR (salin dari .env.example lalu isi)"

  # --- 1. Ambil kode terbaru ---
  log "📥 Mengambil kode terbaru dari origin/$BRANCH..."
  local script_hash_before
  script_hash_before="$(sha256sum "$SCRIPT_PATH" | cut -d' ' -f1)"
  git pull --ff-only origin "$BRANCH"

  # Kalau deploy.sh sendiri ikut berubah, jalankan ulang versi terbarunya
  if [ -z "${DEPLOY_REEXEC:-}" ] && \
     [ "$script_hash_before" != "$(sha256sum "$SCRIPT_PATH" | cut -d' ' -f1)" ]; then
    log "🔄 deploy.sh ikut berubah, menjalankan ulang versi terbaru..."
    DEPLOY_REEXEC=1 exec bash "$SCRIPT_PATH"
  fi

  # --- 2. Catat image yang sedang dipakai (untuk dihapus nanti) ---
  local old_images
  old_images="$(dc images -q 2>/dev/null | sort -u || true)"

  # --- 3. Build image baru (container lama masih berjalan) ---
  log "🔨 Build image baru (container lama tetap berjalan)..."
  if [ -n "${NO_CACHE:-}" ]; then
    dc build --pull --no-cache
  else
    dc build --pull
  fi

  # --- 4. Ganti container ke image baru ---
  # 'up -d' hanya membuat ulang service yang image/config-nya berubah,
  # container lama otomatis dihapus saat diganti.
  log "🔁 Mengganti container ke versi baru..."
  dc up -d --remove-orphans

  # --- 5. Health check ---
  if ! check_health; then
    echo "" >&2
    dc ps >&2 || true
    dc logs --tail=50 >&2 || true
    echo "" >&2
    fail "Health check gagal. Image lama TIDAK dihapus supaya masih bisa rollback manual."
  fi
  log "✅ Semua service sehat"

  # --- 6. Bersih-bersih: hapus image lama milik project ini ---
  local new_images id
  new_images="$(dc images -q 2>/dev/null | sort -u || true)"
  for id in $old_images; do
    if ! grep -qx "$id" <<<"$new_images"; then
      if docker image rm "$id" >/dev/null 2>&1; then
        log "🗑️  Image lama dihapus: $id"
      fi
    fi
  done
  # Cache build yang sudah lebih dari 7 hari
  docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true

  log "📊 Status container:"
  dc ps
  log "🎉 Deploy selesai"
}

main "$@"
exit 0