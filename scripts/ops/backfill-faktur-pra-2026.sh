#!/usr/bin/env bash
# Backfill riwayat faktur pra-2026 ke mirror `accurate_invoice` (#1177).
#
# Mirror hanya punya 2026 karena `syncAccurateInvoices` selalu jalan sebagai
# rolling window (`days`, default 7) dan backfill sekali-jalan tak pernah
# dilakukan. ~7.234 faktur 2024-12 s/d 2025 ada di Accurate, nol di mirror.
# Angka 2026 sendiri VALID — yang hilang pembanding YoY, tren multi-tahun, dan
# piutang 2025 di ar_aging_mv.
#
# JALANKAN DI MAC MINI (butuh .env.prod + akses DB prod).
#   bash scripts/ops/backfill-faktur-pra-2026.sh            # jalankan
#   bash scripts/ops/backfill-faktur-pra-2026.sh --periksa  # HANYA lihat keadaan
#
# Kenapa skrip, bukan satu curl: ada dua jebakan yang gampang terlewat kalau
# dikerjakan tangan, dan dua-duanya GAGAL DALAM DIAM.
#
#   1. `cappedByPages` — batas halaman terlampaui berarti hasilnya TERPOTONG,
#      tapi responsnya tetap `ok: true`. Tanpa dicek, backfill separuh jadi
#      tampak selesai. Skrip ini menolak melanjutkan kalau field itu muncul.
#   2. `ar_aging_mv` — BUKAN materialized view, jadi tak ada yang perlu
#      di-"refresh". Ia tabel biasa yang diisi `ingestAccurateWebhook`, dan
#      `syncAccurateInvoices` sudah memanggilnya sendiri di akhir tiap run.
#      TAPI panggilan itu dibungkus try/catch yang MENELAN error ("aging
#      refresh opsional"), jadi faktur bisa masuk sementara AR-nya diam-diam
#      tidak. Karena itu yang dilakukan di sini VERIFIKASI, bukan refresh.

set -euo pipefail

HANYA_PERIKSA=0
[ "${1:-}" = "--periksa" ] && HANYA_PERIKSA=1

DB="${PGDATABASE:-wrg_os_prod}"
API="${API_BASE:-http://localhost:4100}"
DAYS="${BACKFILL_DAYS:-700}"        # faktur tertua di Accurate: 31/12/2024
MAX_PAGES="${BACKFILL_MAX_PAGES:-300}"  # 11.302 faktur / 50 per halaman = 226

merah()  { printf '\033[31m%s\033[0m\n' "$*"; }
hijau()  { printf '\033[32m%s\033[0m\n' "$*"; }
kuning() { printf '\033[33m%s\033[0m\n' "$*"; }
mati()   { merah "✗ $*"; exit 1; }

command -v jq   >/dev/null || mati "jq tak ada."
command -v psql >/dev/null || mati "psql tak ada."
[ -f .env.prod ] || mati ".env.prod tak ada — jalankan dari root repo di Mac mini."

TOK="$(grep -E '^API_SERVICE_TOKEN=' .env.prod | cut -d= -f2- | tr -d '"' || true)"
[ -n "$TOK" ] || mati "API_SERVICE_TOKEN tak ketemu di .env.prod."

sebaran() {
  psql -d "$DB" -tAF' ' -c "
    SELECT to_char(tanggal,'YYYY'), count(*), round(sum(total)/1e9,2)
    FROM accurate_invoice GROUP BY 1 ORDER BY 1;"
}
ar_pra2026() {
  psql -d "$DB" -tAc "SELECT count(*) FROM ar_aging_mv WHERE due_date < DATE '2026-01-01';"
}

echo "── Keadaan SEBELUM"
echo "   thn  faktur  bruto(M)"
sebaran | sed 's/^/   /'
echo "   ar_aging_mv baris due_date < 2026: $(ar_pra2026)"
SEBELUM_TOTAL=$(psql -d "$DB" -tAc "SELECT count(*) FROM accurate_invoice;")
echo "   total faktur di mirror: $SEBELUM_TOTAL"

if [ "$HANYA_PERIKSA" = "1" ]; then
  echo; kuning "Mode --periksa: tak ada yang dijalankan."; exit 0
fi

echo
kuning "Menarik faktur (days=$DAYS, max_pages=$MAX_PAGES, skip_existing=true)."
kuning "Perkiraan 30-40 menit — ~7.234 detail.do x jeda 150ms. JANGAN dihentikan"
kuning "di tengah; upsert-nya idempoten, tapi mengulang dari awal makan waktu lagi."
echo

MULAI=$(date +%s)
RESP="$(curl -s --max-time 7200 -X POST \
  -H "x-service-token: $TOK" -H 'content-type: application/json' \
  -d "{\"days\":$DAYS,\"max_pages\":$MAX_PAGES,\"skip_existing\":true}" \
  "$API/accurate/sync")" || mati "curl gagal — API prod hidup? (pm2 status wrg-prod-api)"
DURASI=$(( $(date +%s) - MULAI ))

echo "$RESP" | jq . 2>/dev/null || { merah "Respons bukan JSON:"; echo "$RESP" | head -5; exit 1; }
echo "   durasi: $((DURASI/60)) menit $((DURASI%60)) detik"
echo

[ "$(echo "$RESP" | jq -r '.ok')" = "true" ] || mati "Backfill GAGAL: $(echo "$RESP" | jq -r '.error // "tanpa pesan"')"

# ── Jebakan 1: hasil terpotong yang menyamar jadi sukses ──────────────────
if [ "$(echo "$RESP" | jq -r '.cappedByPages // false')" = "true" ]; then
  merah "✗ TERPOTONG — batas $MAX_PAGES halaman tercapai sebelum window habis."
  merah "  Hasilnya TIDAK lengkap meski ok:true. Yang sudah masuk tetap valid"
  merah "  (upsert idempoten), jadi tinggal ulangi dengan batas lebih besar:"
  merah "    BACKFILL_MAX_PAGES=$((MAX_PAGES * 2)) bash $0"
  exit 1
fi

hijau "✓ Tidak terpotong (cappedByPages tak muncul)."
echo "   diproses: $(echo "$RESP" | jq -r '.processed')   dilewati (sudah ada): $(echo "$RESP" | jq -r '.skippedExisting // 0')"
echo

echo "── Keadaan SESUDAH"
echo "   thn  faktur  bruto(M)"
sebaran | sed 's/^/   /'
SESUDAH_TOTAL=$(psql -d "$DB" -tAc "SELECT count(*) FROM accurate_invoice;")
echo "   total faktur di mirror: $SESUDAH_TOTAL  (bertambah $((SESUDAH_TOTAL - SEBELUM_TOTAL)))"

PUNYA_2025=$(psql -d "$DB" -tAc "SELECT count(*) FROM accurate_invoice WHERE tanggal < DATE '2026-01-01';")
if [ "$PUNYA_2025" -lt 1000 ]; then
  merah "✗ Faktur pra-2026 cuma $PUNYA_2025 — diharapkan ~7.234."
  merah "  Backfill tak menarik sebanyak yang seharusnya. Periksa log API."
  exit 1
fi
hijau "✓ Faktur pra-2026 di mirror: $PUNYA_2025"

# ── Jebakan 2: AR gagal dalam diam ────────────────────────────────────────
AR_SESUDAH=$(ar_pra2026)
echo "   ar_aging_mv baris due_date < 2026: $AR_SESUDAH"
if [ "$AR_SESUDAH" = "0" ]; then
  merah "✗ ar_aging_mv NOL untuk pra-2026 padahal fakturnya masuk."
  merah "  ingestAccurateWebhook dibungkus try/catch yang menelan error, jadi"
  merah "  kegagalannya tidak muncul di respons. Cek log: pm2 logs wrg-prod-api"
  merah "  Faktur TETAP valid; yang belum jalan hanya turunan AR-nya."
  exit 1
fi
hijau "✓ ar_aging_mv terisi untuk periode pra-2026."

echo
hijau "SELESAI. Laporkan angka di atas ke issue #1177."
