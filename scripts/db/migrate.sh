#!/usr/bin/env bash
# migrate.sh — apply migrasi schema (infra/postgres/init/*.sql) yang BELUM ke-apply,
# ter-tracking di tabel schema_migrations. Idempoten, aman utk local & prod.
#
# Pemilihan DB (urutan):
#   1) $DATABASE_URL kalau di-set
#   2) --prod  → DATABASE_URL dari .env.prod
#   3) default → DATABASE_URL dari .env (local dev)
#
# Pemakaian:
#   bash scripts/db/migrate.sh                 # apply pending ke DB local (.env)
#   bash scripts/db/migrate.sh --dry-run       # cuma tampilkan yg pending
#   bash scripts/db/migrate.sh --prod --backup # prod: pg_dump dulu, lalu apply pending
#   bash scripts/db/migrate.sh --baseline      # tandai SEMUA file skrg = applied TANPA jalankan
#                                              #   (sekali, utk adopsi runner di DB yg sudah migrasi manual)
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root
INIT_DIR="infra/postgres/init"
BACKUP_DIR="$HOME/DevWRG/ops/db-backups"

DRY=0; BACKUP=0; BASELINE=0; USE_PROD=0
for a in "$@"; do case "$a" in
  --dry-run) DRY=1 ;; --backup) BACKUP=1 ;; --baseline) BASELINE=1 ;; --prod) USE_PROD=1 ;;
  *) echo "arg tak dikenal: $a"; exit 2 ;;
esac; done

# ── resolve DATABASE_URL ──
# Migrasi butuh role OWNER (DDL). App DATABASE_URL prod = wrg_app (DML-only, least-priv)
# → JANGAN dipakai utk migrasi. Utk --prod, konek sbg owner via socket (peer) ke db
# yang sama. Override eksplisit: MIGRATE_DATABASE_URL.
if [ -n "${DATABASE_URL:-}" ]; then URL="$DATABASE_URL"
elif [ "$USE_PROD" = 1 ]; then
  if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then URL="$MIGRATE_DATABASE_URL"
  else
    DB=$(grep -E '^DATABASE_URL=' .env.prod 2>/dev/null | sed -E 's#.*/([^/?]+).*#\1#' || true)
    URL="postgres:///${DB:-wrg_os_prod}"   # socket → peer (OS user owner, DDL-capable)
  fi
else URL=$(grep -E '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"'); fi
[ -z "$URL" ] && { echo "ERROR: DATABASE_URL tak ketemu (set env, atau --prod, atau isi .env)."; exit 1; }
# tampilkan target tanpa bocorin password
echo "Target DB: $(echo "$URL" | sed -E 's#://[^@]*@#://***@#')"

PSQL=(psql "$URL" -v ON_ERROR_STOP=1 -q)

# ── tabel tracking ──
"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());" >/dev/null

applied_list=$("${PSQL[@]}" -At -c "SELECT filename FROM schema_migrations;")
is_applied(){ grep -qxF "$1" <<<"$applied_list"; }

pending=()
for f in "$INIT_DIR"/*.sql; do
  base=$(basename "$f")
  is_applied "$base" || pending+=("$base")
done

if [ "${#pending[@]}" -eq 0 ]; then echo "✓ tidak ada migrasi pending (DB up-to-date)."; exit 0; fi
echo "Pending (${#pending[@]}):"; printf '  - %s\n' "${pending[@]}"

# ── baseline: tandai applied tanpa jalankan ──
if [ "$BASELINE" = 1 ]; then
  echo "BASELINE — menandai ${#pending[@]} file sebagai applied TANPA eksekusi..."
  for base in "${pending[@]}"; do
    "${PSQL[@]}" -c "INSERT INTO schema_migrations(filename) VALUES ('$base') ON CONFLICT DO NOTHING;" >/dev/null
  done
  echo "✓ baseline selesai. (Gunakan ini sekali di DB yg sudah migrasi manual.)"
  exit 0
fi

if [ "$DRY" = 1 ]; then echo "(dry-run — tidak ada yg dijalankan)"; exit 0; fi

# ── backup (disarankan utk prod) ──
# Penjaga disk + retensi (15 Okt 2026): backup predeploy ±200 MB tiap deploy tak pernah
# dibersihkan → 107 berkas / 13 GB → disk Mac mini penuh → Postgres prod PANIC "No space
# left on device" dan down ±2 jam (17:59–19:46 WIB). Sekarang:
#   - sisa disk < WRG_MIN_FREE_GB (default 5) → ABORT sebelum pg_dump (deploy berhenti,
#     DB tetap hidup — lebih baik gagal deploy daripada DB crash);
#   - sesudah backup ok, hanya WRG_BACKUP_KEEP (default 10) predeploy-* terbaru yang
#     disimpan. Backup manual lain di folder ini (kso-pre-*, *.csv, *.dump) tak disentuh.
if [ "$BACKUP" = 1 ]; then
  command -v pg_dump >/dev/null || { echo "ERROR: pg_dump tak ada (PATH postgres@16)."; exit 1; }
  mkdir -p "$BACKUP_DIR"
  MIN_FREE_GB="${WRG_MIN_FREE_GB:-5}"
  FREE_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
  if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt $((MIN_FREE_GB * 1024 * 1024)) ]; then
    echo "ERROR: sisa disk $((FREE_KB / 1024)) MB < ${MIN_FREE_GB} GB — ABORT (tak backup, tak apply)."
    echo "       Bersihkan disk dulu (mis. backup predeploy lama di $BACKUP_DIR, cache npm)."
    exit 1
  fi
  STAMP=$(date '+%Y%m%d-%H%M%S')
  OUT="$BACKUP_DIR/predeploy-$STAMP.sql.gz"
  echo "→ backup pg_dump → $OUT ..."
  pg_dump "$URL" | gzip > "$OUT" || { echo "ERROR: pg_dump gagal — ABORT (tak apply)."; exit 1; }
  echo "  backup ok ($(du -h "$OUT" | cut -f1))."
  KEEP="${WRG_BACKUP_KEEP:-10}"
  # ls -1t = terbaru dulu; buang sisanya. Pola dikunci ke predeploy-*.sql.gz saja.
  LAMA=$(ls -1t "$BACKUP_DIR"/predeploy-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
  if [ -n "$LAMA" ]; then
    echo "$LAMA" | while IFS= read -r f; do rm -f -- "$f"; done
    echo "  retensi: sisakan $KEEP backup predeploy terbaru, $(echo "$LAMA" | wc -l | tr -d ' ') lama dihapus."
  fi
fi

# ── apply pending, per-file transaksional, catat ──
for base in "${pending[@]}"; do
  echo "→ apply $base ..."
  # psql -1 = single transaction; ON_ERROR_STOP → rollback + exit kalau gagal
  if psql "$URL" -v ON_ERROR_STOP=1 -q -1 -f "$INIT_DIR/$base"; then
    "${PSQL[@]}" -c "INSERT INTO schema_migrations(filename) VALUES ('$base') ON CONFLICT DO NOTHING;" >/dev/null
    echo "  ✓ $base"
  else
    echo "  ✗ GAGAL di $base — transaksi di-rollback. Migrasi berhenti (perbaiki lalu ulang)."; exit 1
  fi
done
echo "✓ semua migrasi pending ter-apply (${#pending[@]} file)."
