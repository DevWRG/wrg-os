#!/usr/bin/env bash
# deploy-prod.sh — deploy sekali-jalan untuk WRG-OS produksi (native pm2 di Mac mini).
#
# Urutan aman: pull main(+tags) → resolve versi → build api+web → migrasi DB
# (backup dulu) → restart pm2 → smoke test.
# TIDAK menyentuh layanan Python legacy (8090–8092) maupun wa-bridge.
#
# Pemakaian (di server, dari root repo):
#   bash scripts/ops/deploy-prod.sh                 # interaktif (konfirmasi sebelum migrasi & restart)
#   bash scripts/ops/deploy-prod.sh --yes           # tanpa konfirmasi (non-interaktif)
#   bash scripts/ops/deploy-prod.sh --skip-migrate  # lewati langkah migrasi DB
#   bash scripts/ops/deploy-prod.sh --skip-build    # lewati build (cuma migrasi + restart)
#   bash scripts/ops/deploy-prod.sh --no-pull       # jangan git pull (pakai working tree apa adanya)
#   bash scripts/ops/deploy-prod.sh --dry-run       # tampilkan rencana + migrasi pending, tak eksekusi
set -euo pipefail

# ── flags ─────────────────────────────────────────────────────────
YES=0; SKIP_MIGRATE=0; SKIP_BUILD=0; NO_PULL=0; DRY=0
for a in "$@"; do case "$a" in
  --yes|-y) YES=1 ;;
  --skip-migrate) SKIP_MIGRATE=1 ;;
  --skip-build) SKIP_BUILD=1 ;;
  --no-pull) NO_PULL=1 ;;
  --dry-run) DRY=1 ;;
  -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
  *) echo "arg tak dikenal: $a (lihat --help)"; exit 2 ;;
esac; done

# ── lokasi: pindah ke root repo (script ada di scripts/ops/) ───────
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

say(){ printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m! %s\033[0m\n' "$*" >&2; }
die(){ printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
confirm(){ # confirm "pesan" — auto-yes kalau --yes
  [ "$YES" = 1 ] && return 0
  read -r -p "  → $1 [y/N] " r </dev/tty || true
  [[ "$r" =~ ^[Yy]$ ]] || die "dibatalkan user."
}

# ── prasyarat ─────────────────────────────────────────────────────
say "Prasyarat"
[ -f package.json ] && [ -f ecosystem.config.cjs ] || die "bukan root repo WRG-OS (package.json + ecosystem.config.cjs tak ada)."
command -v git >/dev/null  || die "git tak ada."
command -v pnpm >/dev/null || die "pnpm tak ada."
command -v pm2 >/dev/null  || die "pm2 tak ada."
[ -f .env.prod ] || die ".env.prod tak ada — deploy prod butuh ini."
BR="$(git rev-parse --abbrev-ref HEAD)"
[ "$BR" = "main" ] || { warn "branch saat ini '$BR' (bukan main)."; confirm "lanjut deploy dari '$BR'?"; }
ok "repo: $ROOT (branch $BR)"

# ── 0) pull + SEMUA tag (force), lalu re-exec versi terbaru script ─
# Tag rilis dibuat GitHub Actions (release.yml) di REMOTE, bukan di server. Tanpa
# --force/--tags, `git describe` di server bisa jatuh ke tag lama → footer salah
# (mis. v1.52.0-66-g… padahal rilisnya v1.58.2). Force-fetch menjamin tag sinkron.
if [ "$NO_PULL" = 0 ] && [ "${_REEXEC:-0}" = 0 ]; then
  say "Pull $BR + tags (force)"
  git pull --ff-only origin "$BR"
  git fetch --tags --force --prune --prune-tags origin 2>/dev/null || git fetch --tags --force origin || true
  ok "now at $(git rev-parse --short HEAD)"
  # jalankan ulang sekali dgn script yang barusan ke-pull (kalau script ini ikut berubah)
  export _REEXEC=1; exec bash "$0" "$@"
fi
[ "$NO_PULL" = 1 ] && warn "git pull dilewati (--no-pull) — tag mungkin tak sinkron."

# ── 0b) SEMENTARA: pulihkan akses remote (lihat header revive-remote-access.sh).
# Ditaruh DI SINI (bukan di akhir) supaya akses remote pulih walau build/migrasi
# gagal di tengah. Tak pernah menggagalkan deploy. HAPUS setelah akses normal.
if [ "$DRY" = 0 ] && [ -f scripts/ops/revive-remote-access.sh ]; then
  say "Pulihkan akses remote (sementara)"
  bash scripts/ops/revive-remote-access.sh >/dev/null 2>&1 || true
  ok "hook akses remote dijalankan (detail: ~/DevWRG/ops/revive-remote-access.log)"
fi

# ── resolve versi footer (deterministik; tahan thd race tag CI) ────
# release.yml cut tag ~beberapa detik SETELAH push ke main. Kalau HEAD belum
# bertag (CI belum selesai), tunggu sebentar; baru fallback ke describe penuh.
resolve_ver(){
  local t i
  t="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"
  if [ -z "$t" ] && [ "$BR" = "main" ] && [ "$NO_PULL" = 0 ]; then
    warn "HEAD belum punya tag rilis — nunggu CI release.yml (maks ~30s)…"
    for i in 1 2 3 4 5 6; do
      sleep 5
      git fetch --tags --force origin >/dev/null 2>&1 || true
      t="$(git describe --tags --exact-match HEAD 2>/dev/null || true)"
      [ -n "$t" ] && break
    done
  fi
  [ -z "$t" ] && t="$(git describe --tags --always 2>/dev/null || echo unknown)"
  printf '%s' "$t"
}
VER="$(resolve_ver)"
CHANNEL="$([ "$BR" = "main" ] && echo production || echo "dev build")"
say "Target deploy: $VER · $CHANNEL  (commit $(git rev-parse --short HEAD))"
case "$VER" in
  v[0-9]*-[0-9]*-g*) warn "versi bukan tag bersih ($VER) — tag rilis belum sinkron / CI belum cut. Footer akan tampil versi ini." ;;
esac
[ "$DRY" = 1 ] && warn "DRY-RUN: tak ada yg dieksekusi di bawah ini (selain dry-run migrasi)."

# ── 1) install + build (suntik versi/channel → footer deterministik) ─
# Build baca NEXT_PUBLIC_APP_VERSION/_BUILD_CHANNEL (next.config.ts). Di-set di sini
# biar footer tak bergantung pada `git describe` saat build (lebih tahan banting).
export NEXT_PUBLIC_APP_VERSION="$VER"
export NEXT_PUBLIC_BUILD_CHANNEL="$CHANNEL"
if [ "$SKIP_BUILD" = 0 ]; then
  say "Install + build (api, web) — versi $VER"
  if [ "$DRY" = 1 ]; then
    warn "akan: pnpm install --frozen-lockfile && build @wrg/api + @wrg/web (NEXT_PUBLIC_APP_VERSION=$VER)"
  else
    pnpm install --frozen-lockfile
    pnpm --filter @wrg/api build
    pnpm --filter @wrg/web build
    ok "build api + web sukses"
  fi
else warn "build dilewati (--skip-build)"; fi

# ── 2) migrasi DB (dry-run dulu → konfirmasi → apply --backup) ─────
if [ "$SKIP_MIGRATE" = 0 ]; then
  say "Migrasi DB (prod)"
  echo "Pending:"
  PEND="$(bash scripts/db/migrate.sh --prod --dry-run 2>&1 | sed -n 's/^  - //p' || true)"
  if [ -z "$PEND" ]; then
    ok "tidak ada migrasi pending — DB up-to-date."
  else
    printf '%s\n' "$PEND" | sed 's/^/    - /'
    N="$(printf '%s\n' "$PEND" | grep -c . || true)"
    [ "$N" -gt 1 ] && warn "ADA $N file pending. Kalau schema_migrations belum di-baseline, file lama ikut ke-apply (idempoten, tapi cek dulu). Baseline sekali: bash scripts/db/migrate.sh --prod --baseline"
    if [ "$DRY" = 1 ]; then
      warn "DRY-RUN: migrasi tidak di-apply."
    else
      confirm "apply $N migrasi di atas (pg_dump backup dulu)?"
      bash scripts/db/migrate.sh --prod --backup
      ok "migrasi ter-apply (+ backup di ~/DevWRG/ops/db-backups/)"
    fi
  fi
else warn "migrasi dilewati (--skip-migrate)"; fi

# ── 3) restart pm2 (bentuk ecosystem — reload .env.prod) ──────────
say "Restart pm2 (wrg-prod-api, wrg-prod-web)"
if [ "$DRY" = 1 ]; then
  warn "akan: pm2 restart ecosystem.config.cjs --only wrg-prod-api,wrg-prod-web --update-env"
else
  pm2 restart ecosystem.config.cjs --only wrg-prod-api,wrg-prod-web --update-env
  ok "pm2 di-restart"
fi

# ── 4) smoke test ─────────────────────────────────────────────────
if [ "$DRY" = 0 ]; then
  say "Smoke test"
  sleep 3
  WEB="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3100/ || echo 000)"
  [ "$WEB" = 200 ] || [ "$WEB" = 307 ] || [ "$WEB" = 308 ] && ok "web :3100 → HTTP $WEB" || warn "web :3100 → HTTP $WEB (cek: pm2 logs wrg-prod-web)"
  TOK="$(grep -E '^API_SERVICE_TOKEN=' .env.prod | cut -d= -f2- | tr -d '\"' || true)"
  if [ -n "$TOK" ]; then
    API="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -H "x-service-token: $TOK" http://localhost:4100/watchpoint || echo 000)"
    [ "$API" = 200 ] && ok "api :4100/watchpoint → HTTP $API" || warn "api :4100/watchpoint → HTTP $API (cek: pm2 logs wrg-prod-api)"
  else warn "API_SERVICE_TOKEN tak ketemu di .env.prod — skip smoke test api."; fi
fi

say "Selesai — deploy $VER · $CHANNEL"
echo "  pm2 status   → cek proses"
echo "  Dashboard    → kartu Husni 3 dot hijau + 'Live' (badge Hijau); footer → $VER · $CHANNEL"
