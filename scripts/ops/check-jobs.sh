#!/usr/bin/env bash
# check-jobs.sh — verifikasi job scheduler wrg-os untuk satu tanggal (default hari
# ini). Baca pm2 out.log [scheduler] + monitor_digest + state, lapor fire + hasil
# kirim per job. Dipakai mis. Senin sore buat mastiin semua job pagi/siang jalan.
#   bash scripts/ops/check-jobs.sh            # hari ini
#   bash scripts/ops/check-jobs.sh 2026-06-15 # tanggal tertentu
set -uo pipefail
DATE="${1:-$(date +%Y-%m-%d)}"
OUT="${PM2_OUT:-$HOME/.pm2/logs/wrg-prod-api-out.log}"
DB="${PGDATABASE:-wrg_os_prod}"
PSQL="psql -U ${PGUSER:-development} -d $DB -tA"

echo "================ CEK JOB wrg-os — $DATE ================"
echo "log: $OUT"
echo ""

# Jam fire tiap job (WIB) + apakah sudah lewat "sore" (≤17:30).
# format: label|jam_wib|kategori
JOBS="
plan-check|08:15|pagi
report-check|20:30|malam
weekly-report|07:00|pagi(Senin)
reminder-h|07:00|pagi
reminder-h-1|17:00|sore
reminder-hod|20:00|malam
monitor-rekap|07/12/17/22|berkala
monitor-resume|14:00|siang
daily-summary|22:00|malam
accurate-sync|10/12/14/16/18/20|berkala
notif-tua-siang|14:05|siang
notif-tua-malam|22:15|malam
detect-leave|tiap 10m|berkala
extract-competitor|23:00|malam
pola-komunikasi|23:30|malam
list-members|22:30|malam
notif-quota|tiap 6j|berkala
"

echo "--- A. FIRE + HASIL per job (baris [scheduler] terakhir hari ini) ---"
printf "%-20s %-12s %s\n" "JOB" "JADWAL" "HASIL TERAKHIR (hari ini)"
while IFS='|' read -r job jam kat; do
  [ -z "$job" ] && continue
  # cari baris scheduler job ini dgn timestamp UTC hari ini (07:00 WIB = 00:00 UTC same date)
  line=$(grep -E "\[scheduler\] $job @ ${DATE}T" "$OUT" 2>/dev/null | tail -1)
  if [ -n "$line" ]; then
    res=$(echo "$line" | sed -E "s/.*$job @ [^ ]+ //" | cut -c1-70)
    printf "%-20s %-12s ✓ %s\n" "$job" "$jam" "$res"
  else
    printf "%-20s %-12s — belum ada log hari ini (%s)\n" "$job" "$jam" "$kat"
  fi
done <<< "$JOBS"

echo ""
echo "--- B. ARTEFAK DB hari ini ---"
$PSQL -c "SELECT '  monitor_digest: rekap='||count(*) FILTER(WHERE kind='rekap' AND tanggal='$DATE')||' resume='||count(*) FILTER(WHERE kind='resume' AND tanggal='$DATE')||' daily='||count(*) FILTER(WHERE kind='daily' AND tanggal='$DATE') FROM monitor_digest;" 2>/dev/null
$PSQL -c "SELECT '  submit hari ini: sales_plan='||(SELECT count(*) FROM sales_plan WHERE tanggal='$DATE')||' sales_todo='||(SELECT count(*) FROM sales_todo WHERE tanggal='$DATE')||' activity='||(SELECT count(*) FROM activity_log WHERE tanggal='$DATE');" 2>/dev/null
$PSQL -c "SELECT '  monitor_pola di-regen hari ini: '||count(*) FROM monitor_pola WHERE updated_at::date='$DATE';" 2>/dev/null
$PSQL -c "SELECT '  leave_pending baru: '||count(*) FROM leave_pending WHERE created_at::date='$DATE';" 2>/dev/null

echo ""
echo "--- C. ERROR scheduler hari ini (kalau ada) ---"
grep -E "\[scheduler\].*(gagal|error)" "$OUT" 2>/dev/null | grep "$DATE" | tail -8 || true
grep -cE "\[scheduler\].*gagal" "$OUT" 2>/dev/null | sed 's/^/  total baris "gagal" sepanjang log: /'

echo ""
echo "--- D. WA send sukses (dari hasil job: warned/sent/partial > 0 = kekirim) ---"
echo "  (lihat angka di kolom HASIL bagian A: plan-check warned=N, report-check partial/noplan=N, dst)"
echo "================ selesai ================"
