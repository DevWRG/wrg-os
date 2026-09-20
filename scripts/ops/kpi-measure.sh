#!/usr/bin/env bash
# kpi-measure.sh — isi kpi_measurement dari data operasional (F119/BSC).
#
# Pratinjau (default, TIDAK menulis):
#   scripts/ops/kpi-measure.sh 2026-09
# Terapkan:
#   scripts/ops/kpi-measure.sh 2026-09 --apply
#
# Perhitungannya ada di apps/api (repo/kpi-measure.ts) supaya cuma ADA SATU
# rumus: skrip ini sengaja tidak menghitung apa pun sendiri — ia memanggil
# endpoint yang sama yang nanti bisa dipakai scheduler.
set -euo pipefail

PERIOD="${1:-}"
APPLY="${2:-}"
[ -n "$PERIOD" ] || { echo "pakai: $0 YYYY-MM [--apply]" >&2; exit 2; }

DIR="${WRG_PROD_DIR:-$HOME/DevWRG/wrg-os}"
API="${WRG_API_URL:-http://localhost:4100}"
TOK="$(grep -E '^API_SERVICE_TOKEN=' "$DIR/.env.prod" | cut -d= -f2-)"
[ -n "$TOK" ] || { echo "API_SERVICE_TOKEN tak ditemukan di $DIR/.env.prod" >&2; exit 1; }

if [ "$APPLY" = "--apply" ]; then
  METODE=POST; LABEL="TERAPKAN (menulis ke kpi_measurement)"
else
  METODE=GET;  LABEL="PRATINJAU (tidak menulis)"
fi

echo "== kpi-measure $PERIOD — $LABEL =="
curl -sS -X "$METODE" -H "x-service-token: $TOK" "$API/kpi/measure?period=$PERIOD" \
  | node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
  const j = JSON.parse(d);
  if (j.error) { console.error("GAGAL:", j.error); process.exit(1); }
  console.log(`periode ${j.period} (${j.from}..${j.to}) · hari kerja ${j.hari_kerja} · minggu ${j.minggu}`);
  console.log(`KPI total ${j.ringkas.kpi_total} · terukur ${j.ringkas.terukur} · tanpa sumber ${j.ringkas.tanpa_sumber} · ditulis ${j.ringkas.ditulis}`);
  console.log("");
  for (const b of j.terisi) {
    console.log(`  ${String(b.achievement_pct).padStart(6)}%  ${b.karyawan.slice(0,24).padEnd(24)} ${b.kpi.slice(0,32).padEnd(32)} ${b.actual}`);
  }
  const per = {};
  for (const t of j.tanpa_sumber) per[t.alasan] = (per[t.alasan] ?? 0) + 1;
  console.log("\n  tanpa sumber:");
  for (const [a, n] of Object.entries(per).sort((x,y)=>y[1]-x[1])) console.log(`    ${String(n).padStart(4)}  ${a}`);
});'
