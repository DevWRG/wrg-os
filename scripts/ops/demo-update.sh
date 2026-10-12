#!/usr/bin/env bash
# demo-update.sh — perbarui instance DEMO ke kode `main` terbaru TANPA menghapus data.
# (Bangun ulang database dari nol = demo-provision.sh.)
#
#   cd ~/DevWRG/wrg-os-demo && bash scripts/ops/demo-update.sh
#
# Demo melacak `main` (fitur yang sudah live), BUKAN `dev`. Folder demo WAJIB
# clone tersendiri — bukan worktree repo prod. Worktree lama (Sep 2026) menjadi
# yatim saat metadata .git/worktrees di repo prod hilang: aplikasinya tetap jalan,
# tapi kodenya tak bisa lagi di-pull, dan versinya tak bisa diketahui.
#
# Urutan: pull main → install + build api/web → migrasi DB demo → grant ulang
#         → restart pm2 demo → smoke test. Tak ada proses AI/WA (by design).
set -euo pipefail
cd "$(dirname "$0")/../.."

say(){ printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
ok(){ printf '  \033[32m✓\033[0m %s\n' "$*"; }
die(){ printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

say "Prasyarat"
[ -f ecosystem.demo.config.cjs ] || die "ecosystem.demo.config.cjs tak ada — bukan folder demo."
[ -f .env.demo ] || die ".env.demo tak ada."
[ -d .git ] || die "folder ini bukan clone git tersendiri (worktree/yatim?). Clone ulang dulu."
[ -f .env.prod ] && die "ada .env.prod di sini — ini repo PROD, bukan demo. Menolak."
DB="$(sed -n 's#^DATABASE_URL=.*/\([A-Za-z0-9_]*\).*#\1#p' .env.demo | head -1)"
case "$DB" in *_demo) ;; *) die "DATABASE_URL di .env.demo menunjuk '$DB', bukan database *_demo." ;; esac
BR="$(git rev-parse --abbrev-ref HEAD)"
[ "$BR" = "main" ] || die "branch '$BR' — demo harus di main."
ok "folder $(pwd) · branch main · DB $DB"

say "Pull main"
git pull --ff-only origin main
git fetch --tags --force origin >/dev/null 2>&1 || true
VER="$(git describe --tags --always 2>/dev/null || echo unknown)"
ok "kini di $(git rev-parse --short HEAD) ($VER)"

say "Install + build (api, web)"
export NEXT_PUBLIC_APP_VERSION="$VER" NEXT_PUBLIC_BUILD_CHANNEL="demo"
pnpm install --frozen-lockfile
pnpm --filter @wrg/api build
pnpm --filter @wrg/web build
ok "build sukses"

say "Migrasi DB $DB"
DATABASE_URL="postgres:///$DB" bash scripts/db/migrate.sh
# Grant ulang: tabel dari migrasi baru belum tentu terjangkau role aplikasi demo.
psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wrg_demo_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wrg_demo_app;"
ok "migrasi + grant beres"

say "Restart pm2 demo"
pm2 restart ecosystem.demo.config.cjs --update-env
sleep 3
WEB="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3200/ || echo 000)"
case "$WEB" in 200|307|308) ok "web :3200 → HTTP $WEB" ;; *) die "web :3200 → HTTP $WEB (pm2 logs wrg-demo-web)" ;; esac
API="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:4200/health || echo 000)"
case "$API" in 200) ok "api :4200/health → HTTP $API" ;; *) printf '  ! api :4200/health → HTTP %s (pm2 logs wrg-demo-api)\n' "$API" ;; esac

say "Selesai — demo di $VER"
