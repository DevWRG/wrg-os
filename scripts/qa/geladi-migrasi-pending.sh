#!/usr/bin/env bash
# geladi-migrasi-pending.sh — GELADI (rehearsal) migrasi pending terhadap KLON
# data prod, sebelum promosi dev → main.
#
# Dijalankan di Mac mini (satu-satunya mesin dengan akses DB prod). Prod TIDAK
# pernah ditulis: satu-satunya sentuhan ke prod adalah `pg_dump` (read-only).
# Semua DDL jalan di database sementara hasil restore.
#
# ── KENAPA SELURUH BATCH, BUKAN CUMA 5 FILE ─────────────────────────────────
# Audit 2026-09-03 menemukan 5 migrasi yang belum ikut geladi Fase 1 (26 Agu):
# 156, 158, 159, 163, 164. Kelimanya TIDAK BISA diuji sendirian — semuanya
# ALTER/INDEX atas tabel yang di prod belum ada, dan tabel itu justru dibuat
# oleh migrasi pending yang lebih awal:
#   · 156 → ga_asset_assignments   (dibuat 088)
#   · 158 → purchase_order         (dibuat 143)
#   · 159 → installation_unit      (dibuat 130), FK ke teknisi_capacity (136)
#   · 163 → service_ticket         (dibuat 135)
#   · 164 → it_ticket              (dibuat 087)
# Jadi geladi yang sah = jalankan SELURUH antrean pending berurutan, lalu
# verifikasi 5 file itu secara eksplisit. Itu juga lebih dekat dengan yang
# sebenarnya terjadi saat promosi: auto-deploy menerapkan semuanya sekali jalan.
#
# ── YANG DIUJI ──────────────────────────────────────────────────────────────
#   1. Klon prod berhasil dibangun & volumenya wajar (bukan DB kosong).
#   2. Daftar pending dari ledger klon = daftar yang diharapkan (default 48).
#   3. Seluruh batch apply bersih, dengan waktu per file.
#   4. IDEMPOTEN: migrate.sh kedua bilang "tak ada pending", DAN kelima file
#      itu di-`psql -f` ulang satu-satu → tetap sukses (no-op).
#   5. Verifikasi objek yang dijanjikan kelima file itu benar-benar ada
#      (kolom, FK, index partial + predikatnya).
#   6. Prasyarat data yang bisa menggagalkan index unique (158) diperiksa
#      SEBELUM apply, bukan ditemukan lewat error Postgres.
#
# ── PAKAI ───────────────────────────────────────────────────────────────────
#   bash scripts/qa/geladi-migrasi-pending.sh                 # dump baru dari prod
#   bash scripts/qa/geladi-migrasi-pending.sh --dump X.sql.gz # pakai dump yang sudah ada
#   bash scripts/qa/geladi-migrasi-pending.sh --keep          # klon tak dihapus (buat inspeksi)
#   bash scripts/qa/geladi-migrasi-pending.sh --expect 48     # jumlah pending yang diharapkan
#
# Keluar 0 = geladi lolos. Keluar != 0 = ada yang gagal (lihat GAGAL=n).
set -euo pipefail
cd "$(dirname "$0")/../.."

CLONE_DB="${GELADI_DB:-wrg_os_geladi}"
DUMP=""; KEEP=0; EXPECT=48
while [ $# -gt 0 ]; do case "$1" in
  --dump) DUMP="${2:?--dump butuh path}"; shift 2 ;;
  --keep) KEEP=1; shift ;;
  --expect) EXPECT="${2:?--expect butuh angka}"; shift 2 ;;
  *) echo "arg tak dikenal: $1"; exit 2 ;;
esac; done

FAIL=0
ok()   { printf '  ✅ %s\n' "$*"; }
bad()  { printf '  ❌ %s\n' "$*"; FAIL=$((FAIL+1)); }
head2() { printf '\n── %s\n' "$*"; }

# Kelima file yang belum pernah ikut geladi.
BARU=(156_ga_asset_assignment_shared_fix.sql 158_purchase_order_po_number_unique.sql \
      159_installation_link_existing.sql 163_service_ticket_customer_id.sql \
      164_it_ticket_user_fk.sql)

# ── 0. Prasyarat & pagar keselamatan ────────────────────────────────────────
head2 "Prasyarat"
for c in psql pg_dump createdb dropdb; do
  command -v "$c" >/dev/null || { echo "ERROR: $c tak ada di PATH (postgres@16?)"; exit 1; }
done
[ -d infra/postgres/init ] || { echo "ERROR: jalankan dari repo wrg-os"; exit 1; }

# Nama DB prod dibaca dari .env.prod HANYA untuk memastikan kita tak menimpanya.
PROD_DB=$(grep -E '^DATABASE_URL=' .env.prod 2>/dev/null | sed -E 's#.*/([^/?]+).*#\1#' || true)
PROD_DB="${PROD_DB:-wrg_os_prod}"
if [ "$CLONE_DB" = "$PROD_DB" ]; then
  echo "ERROR: nama klon ($CLONE_DB) SAMA dengan DB prod. Dibatalkan."; exit 1
fi
case "$CLONE_DB" in
  *geladi*) : ;;  # pagar: nama klon wajib memuat "geladi" supaya dropdb tak bisa
  *) echo "ERROR: nama klon harus memuat 'geladi' (sekarang: $CLONE_DB) — pagar dropdb."; exit 1 ;;
esac
ok "prod=$PROD_DB (hanya dibaca) · klon=$CLONE_DB"

# ── 1. Ambil dump prod (read-only) & restore ke klon ────────────────────────
head2 "Klon prod"
if [ -z "$DUMP" ]; then
  mkdir -p "$HOME/DevWRG/ops/db-backups"
  DUMP="$HOME/DevWRG/ops/db-backups/geladi-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "  pg_dump $PROD_DB → $DUMP"
  pg_dump "postgres:///$PROD_DB" | gzip > "$DUMP" || { echo "ERROR: pg_dump gagal"; exit 1; }
fi
[ -s "$DUMP" ] || { echo "ERROR: dump kosong/tak ada: $DUMP"; exit 1; }
ok "dump: $DUMP ($(du -h "$DUMP" | cut -f1))"

dropdb --if-exists "$CLONE_DB"
createdb "$CLONE_DB"
if [[ "$DUMP" == *.gz ]]; then gunzip -c "$DUMP" | psql -q "postgres:///$CLONE_DB" >/dev/null 2>&1 || true
else psql -q "postgres:///$CLONE_DB" -f "$DUMP" >/dev/null 2>&1 || true; fi
# Restore pg_dump wajar memuntahkan notice/role-warning; yang menentukan adalah
# volumenya, bukan exit code psql — jadi diperiksa lewat data, bukan status.
CLONE_URL="postgres:///$CLONE_DB"
q() { psql "$CLONE_URL" -At -c "$1" 2>/dev/null || echo "ERR"; }
N_TBL=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
N_INV=$(q "SELECT count(*) FROM accurate_invoice")
N_SO=$(q "SELECT count(*) FROM accurate_sales_order")
[ "${N_TBL:-0}" -gt 50 ] 2>/dev/null && ok "klon terbangun: $N_TBL tabel, accurate_invoice=$N_INV, accurate_sales_order=$N_SO" \
  || bad "klon mencurigakan (tabel=$N_TBL) — restore gagal? geladi tak bermakna di DB kosong"
[ "$FAIL" -gt 0 ] && { echo; echo "GAGAL=$FAIL — berhenti sebelum apply."; exit 1; }

# ── 2. Prasyarat data yang bisa menggagalkan migrasi ────────────────────────
head2 "Prasyarat data (sebelum apply)"
# 158 memasang UNIQUE index pada purchase_order.po_number. Kalau tabelnya sudah
# ada & punya duplikat, apply GAGAL — lebih baik ketahuan di sini.
if [ "$(q "SELECT to_regclass('public.purchase_order') IS NOT NULL")" = "t" ]; then
  DUP=$(q "SELECT count(*) FROM (SELECT po_number FROM purchase_order WHERE po_number IS NOT NULL GROUP BY po_number HAVING count(*)>1) x")
  [ "${DUP:-0}" = "0" ] && ok "purchase_order.po_number: 0 duplikat → 158 aman" \
    || bad "purchase_order.po_number: $DUP nomor duplikat → 158 AKAN GAGAL, bereskan datanya dulu"
else
  ok "purchase_order belum ada di prod → dibuat kosong oleh 143, 158 aman"
fi
# 082 memasang NOT NULL pada warehouse.jenis sesudah backfill di file yang sama.
if [ "$(q "SELECT to_regclass('public.warehouse') IS NOT NULL")" = "t" ]; then
  WN=$(q "SELECT count(*) FROM warehouse WHERE jenis IS NULL")
  ok "warehouse ada; jenis NULL=$WN (082 mem-backfill sebelum SET NOT NULL)"
else
  ok "warehouse belum ada di prod → dibuat oleh 082, SET NOT NULL tanpa baris"
fi

# ── 3. Daftar pending dari ledger klon ──────────────────────────────────────
head2 "Daftar pending (dari ledger klon, bukan dari git)"
DRY=$(DATABASE_URL="$CLONE_URL" bash scripts/db/migrate.sh --dry-run 2>&1 || true)
echo "$DRY" | sed 's/^/  /'
N_PEND=$(echo "$DRY" | grep -cE '^\s*-\s|\.sql' || true)
PENDLIST=$(echo "$DRY" | grep -oE '[0-9]{3}_[a-z0-9_]+\.sql' | sort -u)
N_PEND=$(echo "$PENDLIST" | grep -c . || true)
[ "$N_PEND" = "$EXPECT" ] && ok "pending=$N_PEND (sesuai harapan $EXPECT)" \
  || bad "pending=$N_PEND, diharapkan $EXPECT — antrean bergerak sejak audit, tinjau dulu"
for b in "${BARU[@]}"; do
  grep -qxF "$b" <<<"$PENDLIST" && ok "ikut antrean: $b" || bad "TAK ADA di antrean: $b (sudah ter-apply? file hilang?)"
done

# ── 4. Apply seluruh batch, catat waktu per file ─────────────────────────────
head2 "Apply batch (klon) — waktu per file"
T0=$(date +%s)
while IFS= read -r base; do
  [ -z "$base" ] && continue
  f="infra/postgres/init/$base"
  s=$(date +%s%N)
  if psql "$CLONE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$f" >/dev/null 2>&1; then
    ms=$(( ($(date +%s%N) - s) / 1000000 ))
    psql "$CLONE_URL" -q -c "INSERT INTO schema_migrations(filename) VALUES ('$base') ON CONFLICT DO NOTHING;" >/dev/null
    printf '  %-46s %5s ms\n' "$base" "$ms"
  else
    bad "APPLY GAGAL: $base"
    echo "     ↓ error asli:"
    psql "$CLONE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$f" 2>&1 | sed 's/^/     /' | head -20
    break
  fi
done <<< "$PENDLIST"
echo "  total: $(( $(date +%s) - T0 )) detik"

# ── 5. Idempotensi ──────────────────────────────────────────────────────────
head2 "Idempotensi"
AGAIN=$(DATABASE_URL="$CLONE_URL" bash scripts/db/migrate.sh --dry-run 2>&1 || true)
echo "$AGAIN" | grep -q "tidak ada migrasi pending" && ok "migrate.sh kedua: tak ada pending (ledger benar)" \
  || bad "migrate.sh kedua masih melihat pending: $(echo "$AGAIN" | tail -3 | tr '\n' ' ')"
for b in "${BARU[@]}"; do
  if psql "$CLONE_URL" -v ON_ERROR_STOP=1 -q -1 -f "infra/postgres/init/$b" >/dev/null 2>&1; then
    ok "aman diulang: $b"
  else
    bad "TAK idempoten: $b gagal saat dijalankan ulang"
  fi
done

# ── 6. Verifikasi objek kelima file ─────────────────────────────────────────
head2 "Verifikasi objek (5 file yang belum pernah geladi)"
chk() { # chk "<label>" "<sql yang mengembalikan t/f>"
  local r; r=$(q "$2")
  [ "$r" = "t" ] && ok "$1" || bad "$1 (dapat: ${r:-kosong})"
}
# 156
chk "156 · ga_asset_assignments.is_shared_snapshot ada & NOT NULL" \
  "SELECT is_nullable='NO' FROM information_schema.columns WHERE table_name='ga_asset_assignments' AND column_name='is_shared_snapshot'"
chk "156 · index ga_asset_assignments_active_uniq memuat predikat is_shared_snapshot" \
  "SELECT indexdef LIKE '%is_shared_snapshot%' AND indexdef LIKE '%returned_date IS NULL%' FROM pg_indexes WHERE indexname='ga_asset_assignments_active_uniq'"
# 158
chk "158 · purchase_order_po_number_key UNIQUE" \
  "SELECT indexdef LIKE 'CREATE UNIQUE INDEX%' FROM pg_indexes WHERE indexname='purchase_order_po_number_key'"
# 159
for c in product_id account_id teknisi_id; do
  chk "159 · installation_unit.$c ada" \
    "SELECT count(*)=1 FROM information_schema.columns WHERE table_name='installation_unit' AND column_name='$c'"
done
chk "159 · FK installation_unit → accurate_item/accurate_customer/teknisi_capacity (3 FK)" \
  "SELECT count(*)>=3 FROM pg_constraint WHERE conrelid='installation_unit'::regclass AND contype='f'"
# 163
chk "163 · service_ticket.customer_id ada" \
  "SELECT count(*)=1 FROM information_schema.columns WHERE table_name='service_ticket' AND column_name='customer_id'"
chk "163 · FK service_ticket.customer_id → accurate_customer" \
  "SELECT count(*)=1 FROM pg_constraint WHERE conrelid='service_ticket'::regclass AND contype='f' AND confrelid='accurate_customer'::regclass"
# 164
for c in reported_by_user_id assigned_to_user_id; do
  chk "164 · it_ticket.$c ada" \
    "SELECT count(*)=1 FROM information_schema.columns WHERE table_name='it_ticket' AND column_name='$c'"
done
chk "164 · index it_ticket_assigned_user_idx ada" \
  "SELECT count(*)=1 FROM pg_indexes WHERE indexname='it_ticket_assigned_user_idx'"
chk "164 · FK it_ticket → app_user (2 FK)" \
  "SELECT count(*)>=2 FROM pg_constraint WHERE conrelid='it_ticket'::regclass AND contype='f' AND confrelid='app_user'::regclass"

# ── 7. Sanity: data prod tak berubah bentuk ─────────────────────────────────
head2 "Sanity pasca-apply (klon)"
A=$(q "SELECT count(*) FROM accurate_invoice"); B=$(q "SELECT count(*) FROM accurate_sales_order")
[ "$A" = "$N_INV" ] && [ "$B" = "$N_SO" ] && ok "volume tak berubah: invoice=$A, SO=$B" \
  || bad "volume BERUBAH sesudah migrasi: invoice $N_INV→$A, SO $N_SO→$B"

# ── 8. Bersih-bersih ────────────────────────────────────────────────────────
head2 "Selesai"
if [ "$KEEP" = 1 ]; then
  echo "  klon DIPERTAHANKAN: $CLONE_DB (hapus manual: dropdb $CLONE_DB)"
else
  dropdb --if-exists "$CLONE_DB" && echo "  klon $CLONE_DB dihapus"
fi
echo "  dump dipertahankan: $DUMP"
echo
if [ "$FAIL" = 0 ]; then
  echo "GELADI LOLOS — GAGAL=0. Antrean $N_PEND migrasi aman diterapkan ke prod."
  echo "Langkah berikutnya: promotion PR dev → main, lalu auto-deploy yang apply"
  echo "(pg_dump backup otomatis), LANGSUNG diikuti Sync Fitur di menu Akses Grup."
else
  echo "GELADI GAGAL — GAGAL=$FAIL. JANGAN promosikan sebelum ini beres."
  exit 1
fi
