# Cutover Runbook — wrg-crm + wrg-monitor → wrg-os

Panduan mematikan cron lama (Python di `~/Documents/wrg-crm`, `~/Documents/wrg-monitor`)
dan mengaktifkan padanannya di wrg-os. **Jangan jalankan langkah "Eksekusi" sampai
semua blocker hijau** — mematikan cron lama saat wrg-os belum siap = produksi mati.

---

## 1. Status kesiapan (blocker)

| Prasyarat | Status | Aksi |
|---|---|---|
| Data prod ter-migrasi ke wrg-os | ✅ selesai | `scripts/migrate/crm-to-os.sql` (re-run untuk delta saat cutover) |
| Wiring gateway WA | ⚙️ siap (dry-run) | isi `WA_SEND_URL`/`WA_SEND_SECRET`; `WA_DRY_RUN=true` (default) = terwiring, belum kirim live. Cek `GET /wa/preflight` |
| Kirim WhatsApp **live** | ❌ belum | uji dgn `WA_TEST_TARGET`=nomor sendiri, lalu `WA_DRY_RUN=false` (langkah go-live terakhir) |
| Inbound WA (terima #PLAN/#REPORT) | ⚙️ siap (gated, dry-run) | proses di `/webhooks/wa` (+`POST /wa/inbound/process`) → set `WA_INBOUND_PROCESS=true`; arahkan gateway push ke `/webhooks/wa` |
| Sync Accurate (invoice) | ✅ puller siap | `POST /accurate/sync` + scheduler `accurate-sync` (gated). Set kredensial (env/`ACCURATE_CRED_FILE`) |
| Scheduler wrg-os | ⏸️ OFF | set `AGENT_SCHEDULE_ENABLED=true` setelah job di-review |
| Deploy wrg-os ke produksi | ⚙️ artefak siap | `docker-compose.prod.yml` + `wrg_os_prod` (clone ✅) + `wa-bridge`. Lihat §3b. Tinggal jalankan di host |

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
| `sync_accurate.sh` | 6×/hari W | puller `accurate-sync` → mirror accurate_* + ar_aging | ✅ gated `AGENT_SCHEDULE_ENABLED` (`ACCURATE_SYNC_CRON`) |
| `backup_pg.sh` | 02:00 | dump Postgres | 🔨 ops (di luar app) |
| `wrg-inbound.sh` | tiap 1m | proses #PLAN/#REPORT → sales_plan/sales_todo/activity_log + balas | ⚙️ siap, gated `WA_INBOUND_PROCESS` (foto/geotag/OCR & #LEADS/#UPDATE 🔨 menyusul) |

**Sudah aktif-able sekarang (generate-only / gated, tanpa kirim WA):**
`monitor-rekap`, `monitor-resume`, `reminder-h/-h-1`, `reminder-hod`, `A1–A12`.

---

## 3. Konfigurasi cutover (.env wrg-os produksi)

```bash
AGENT_SCHEDULE_ENABLED=true
AGENT_CRON_TZ=Asia/Jakarta
WA_SEND_URL=<gateway-kirim-WA>          # WAJIB sebelum cutover (kosong = stub)
WA_SEND_SECRET=<header x-wa-secret>
WA_DRY_RUN=true                         # tetap true saat wiring; "false" = go-live
WA_TEST_TARGET=                         # isi nomor sendiri utk uji live aman
REMINDER_WA_TARGET=<jid grup AM>
HOD_WA_TARGET=<jid grup HOD>
# cron monitor (default sudah sesuai legacy):
MONITOR_REKAP_CRON=0 7,12,17,22 * * *
MONITOR_RESUME_CRON=0 14 * * *
MONITOR_RESUME2_CRON=10 22 * * *
```

**Go-live WA bertahap (aman):**
1. Set `WA_SEND_URL`/`WA_SEND_SECRET`, biarkan `WA_DRY_RUN=true`. Cek
   `GET /wa/preflight?probe=1` → `mode:"dry-run"`, `reachable:true`.
2. Jalankan job/`POST /reminders/run` → cek log `[wa] DRY-RUN …` (tak ada pesan terkirim).
3. Set `WA_TEST_TARGET`=nomor sendiri + `WA_DRY_RUN=false`, restart → uji 1 pesan masuk ke HP sendiri.
4. Kosongkan `WA_TEST_TARGET`, restart → broadcast ke target nyata (go-live penuh).

---

## 3b. Deploy Phase 1 (co-locate di Mac, dual-run)

Stack prod = `docker-compose.prod.yml` (pull image ghcr) + Postgres HOST
(`wrg_os_prod`) + **wa-bridge** HOST (`infra/wa-bridge/`). Legacy 8090-8092 tetap.

```bash
# 1. DB prod (sekali): clone dari dev (sudah berisi data+migrasi+teruji)
createdb wrg_os_prod && pg_dump wrg_os_dev | psql wrg_os_prod
# Role app berpassword + izinkan koneksi container:
#   CREATE ROLE wrg_app LOGIN PASSWORD '...'; GRANT ALL ON DATABASE wrg_os_prod TO wrg_app; (+ schema/tables)
#   postgresql.conf: listen_addresses='*'   pg_hba.conf: host wrg_os_prod wrg_app <docker-subnet> scram-sha-256
#   (restart postgres)

# 2. Image ghcr (package privat)
docker login ghcr.io                       # username + PAT (read:packages)

# 3. Env + up (semua flag default GATED/dry-run)
cp .env.prod.example .env.prod && nano .env.prod
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# 4. wa-bridge di HOST (lihat infra/wa-bridge/README.md) — mulai DRY:
WA_BRIDGE_SECRET=$WA_SEND_SECRET WRG_WEBHOOK_URL=http://localhost:4000/webhooks/wa \
WRG_WEBHOOK_SECRET=$WA_WEBHOOK_SECRET node infra/wa-bridge/bridge.mjs   # WA_BRIDGE_SEND_LIVE belum di-set

# 5. Smoke: GET /health, /wa/preflight, /accurate/sync/state; login web :3000
```

Akses tim: taruh web :3000 di belakang **Caddy** (auto-TLS) atau **Tailscale**.

## 3c. Deploy Phase 1 NATIVE (tanpa Docker — jalur aktual di Mac)

Mac ini tak punya container runtime → wrg-os dijalankan **native via pm2**
(konsisten dgn legacy & dev yang juga bare-metal). Port prod terpisah:
**ai 8100 · api 4100 · web 3100**. DB = `wrg_os_prod` (peer auth lokal → tak perlu
pg_hba/host.docker.internal/ghcr). Config: `ecosystem.config.cjs` (baca `.env.prod`,
gitignored). Dual-run dgn legacy (8090-8092) & dev (3000/4000/8000).

```bash
# prasyarat: npm i -g pm2 ; pnpm --filter api build ; pnpm --filter web build
cp .env.prod.example .env.prod   # native: DATABASE_URL=postgres://localhost:5432/wrg_os_prod,
                                 # AI_URL/API_URL ke :8100/:4100, secret di-generate (openssl rand)
pm2 start ecosystem.config.cjs
pm2 save
sudo env PATH=$PATH:<node-bin> $(which pm2) startup launchd -u $USER --hp $HOME   # auto-boot
pm2 status ; pm2 logs

# smoke: curl :4100/health ; :4100/wa/preflight (x-service-token) ; :4100/accurate/sync/state ; :3100/login
```

Akses tim: **Tailscale** (`tailscale serve --bg 3100` → HTTPS tailnet) atau Caddy.

> Untuk Phase 2 (VPS/always-on) pakai jalur Docker §3b (image ghcr + compose).

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
