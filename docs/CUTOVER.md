# Cutover Runbook — wrg-crm + wrg-monitor → wrg-os

Panduan mematikan cron lama (Python di `~/Documents/wrg-crm`, `~/Documents/wrg-monitor`)
dan mengaktifkan padanannya di wrg-os. **Jangan jalankan langkah "Eksekusi" sampai
semua blocker hijau** — mematikan cron lama saat wrg-os belum siap = produksi mati.

---

## 1. Status kesiapan (blocker)

| Prasyarat | Status | Aksi |
|---|---|---|
| Data prod ter-migrasi ke wrg-os | ✅ selesai | `scripts/migrate/crm-to-os.sql` (re-run untuk delta saat cutover) |
| Kirim WhatsApp produksi | ❌ **stub** | isi `WA_SEND_URL` (+`WA_SEND_SECRET`) ke gateway nyata, uji 1 pesan |
| Inbound WA (terima #PLAN/#REPORT) | ❌ belum | arahkan gateway push → `POST /webhooks/wa`, atau bangun poller |
| Sync Accurate (invoice) | ❌ belum | konfigurasi webhook Accurate → `POST /webhooks/accurate`, atau bangun puller |
| Scheduler wrg-os | ⏸️ OFF | set `AGENT_SCHEDULE_ENABLED=true` setelah job di-review |
| Deploy wrg-os ke produksi | ❌ dev lokal | deploy apps/api + web + services/ai (DB produksi, bukan `wrg_os_dev`) |

> Catatan keamanan: Python produksi lama (port 8090/8091/8092) **jangan disentuh**.
> Cron lama tetap hidup sampai langkah Eksekusi dijalankan eksplisit.

---

## 2. Pemetaan cron lama → wrg-os

Legend: ✅ siap · ⚙️ siap, perlu config (WA target/gateway) · 🔨 perlu dibangun

### wrg-monitor

| Cron lama | Jadwal | Padanan wrg-os | Status |
|---|---|---|---|
| `rekap.sh rekap` | 07/12/17/22 | scheduler `monitor-rekap` → `generateRekap` (generate-only) | ✅ |
| `rekap.sh resume` | 14:00, 22:10 | scheduler `monitor-resume(-malam)` → `generateResume` | ✅ |
| `notif_tua.sh` | 14:05, 22:15 | kirim WA notif TUA | 🔨 belum diport |
| `list_members.sh` | 22:30 | `upsertMembers` (butuh feed daftar member WA) | 🔨 butuh sumber |
| `pola_komunikasi.sh` | 23:30 | `upsertPola` (butuh feed) | 🔨 butuh sumber |
| `briefing_weekend.sh` | Sab/Min 07:00 | A10 `runExecutiveSynthesis` (generate) + kirim WA | ⚙️ generate ✅ / kirim 🔨 |
| `git_backup_push.sh` | 22:40 | backup repo | 🔨 ops (di luar app) |

### wrg-crm

| Cron lama | Jadwal | Padanan wrg-os | Status |
|---|---|---|---|
| `wrg-daily plan_check` | 08:15 | reminder kepatuhan plan | ⚙️ (target WA) |
| `wrg-daily report_check` | 20:30 | reminder kepatuhan report | ⚙️ (target WA) |
| `wrg-daily daily_summary` | 22:00 W | `/daily-summary` (generate) + kirim grup HOD | ⚙️ generate ✅ / kirim 🔨 |
| `cron_am_reminder h` | 07:03 | scheduler `reminder-h` → `runReminders('h')` | ⚙️ (WA stub) |
| `cron_am_reminder h-1` | 17:03 | scheduler `reminder-h-1` | ⚙️ (WA stub) |
| `cron_hod_daily_reminder` | 20:00 W | scheduler `reminder-hod` → `runHodDaily` | ⚙️ (WA stub) |
| `cron_weekly_report.sh` | Sen 07:00 | laporan KPI mingguan (generate) + kirim | 🔨 kirim/PDF |
| `extract_competitor.sh` | 23:00 | ekstraksi kompetitor dari activity_log | 🔨 autonomous (endpoint `/competitor` manual ada) |
| `detect_leave.sh` | tiap 10m | `/leave/detect` dari feed WA HRD | 🔨 autonomous (butuh feed) |
| `sync_accurate.sh` | 6×/hari W | mirror invoice Accurate | 🔨 webhook/puller |
| `backup_pg.sh` | 02:00 | dump Postgres | 🔨 ops (di luar app) |
| `wrg-inbound.sh` | tiap 1m | ingest #PLAN/#REPORT | 🔨 webhook `/webhooks/wa` / poller |

**Sudah aktif-able sekarang (generate-only / gated, tanpa kirim WA):**
`monitor-rekap`, `monitor-resume`, `reminder-h/-h-1`, `reminder-hod`, `A1–A12`.

---

## 3. Konfigurasi cutover (.env wrg-os produksi)

```bash
AGENT_SCHEDULE_ENABLED=true
AGENT_CRON_TZ=Asia/Jakarta
WA_SEND_URL=<gateway-kirim-WA>          # WAJIB sebelum cutover (kosong = stub)
WA_SEND_SECRET=<header x-wa-secret>
REMINDER_WA_TARGET=<jid grup AM>
HOD_WA_TARGET=<jid grup HOD>
# cron monitor (default sudah sesuai legacy):
MONITOR_REKAP_CRON=0 7,12,17,22 * * *
MONITOR_RESUME_CRON=0 14 * * *
MONITOR_RESUME2_CRON=10 22 * * *
```

Uji kirim WA dulu: `POST /reminders/run` (mode dry → cek log gateway) sebelum live.

---

## 4. Eksekusi cutover (JALANKAN HANYA SAAT SEMUA BLOCKER HIJAU)

```bash
# a. Backup crontab lama
crontab -l > ~/crontab.backup.$(date +%Y%m%d-%H%M).txt

# b. Nonaktifkan baris cron lama (komentar, jangan hapus) — edit via:
#    EDITOR=nano crontab -e
#    beri '#' di depan baris wrg-monitor & wrg-crm produksi.
#    (biarkan baris wrg-crm-dev bila masih dipakai untuk uji)

# c. Tarik delta data terakhir dari prod ke wrg-os:
psql "$DATABASE_URL" -f scripts/migrate/crm-to-os.sql

# d. Aktifkan scheduler wrg-os (set .env lalu restart apps/api):
#    AGENT_SCHEDULE_ENABLED=true ...  → restart service
#    verifikasi: GET /agents/schedule  (enabled:true, daftar job)

# e. Pantau 1 siklus penuh (cek log scheduler + WA terkirim ke grup uji dulu).
```

**Rollback:** kembalikan `crontab ~/crontab.backup.*.txt`, set
`AGENT_SCHEDULE_ENABLED=false`, restart apps/api.

---

## 5. Sisa yang harus dibangun sebelum cutover penuh

1. **Kirim WA**: gateway nyata + `WA_SEND_URL` (semua reminder/notif bergantung ini).
2. **notif TUA** (monitor) + **kirim daily_summary / weekly_report / briefing weekend**.
3. **Ingest inbound** #PLAN/#REPORT (webhook `/webhooks/wa` atau poller pengganti `wrg-inbound.sh`).
4. **Sync Accurate** (webhook/puller pengganti `sync_accurate.sh`).
5. **Autonomous**: `extract_competitor`, `detect_leave`, refresh `members`/`pola` (butuh feed WA).
6. **Ops**: backup Postgres + git backup (boleh tetap di cron lama / sistem terpisah).
