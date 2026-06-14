# wrg-os — Panduan Proyek (CLAUDE.md)

Monorepo pnpm (pnpm@11.5.2, Node) yang mereplikasi & menggantikan stack legacy
wrg-crm / wrg-monitor (Python, ports 8090/8091/8092). Bahasa kerja: Indonesia, gaya
ringkas. Jangan sentuh proses legacy 8090/8091/8092.

## Arsitektur

```
apps/
  api/      Hono + TypeScript. Build: tsc → dist/index.js. Semua endpoint /report, /visits,
            /wa, /auth, admin. Scheduler cron in-process (apps/api/src/scheduler.ts).
  web/      Next.js (App Router). Dashboard. BFF proxy di src/app/api/* (gateway.ts inject
            x-service-token → api, bypass JWT). Auth gate via middleware + admin-guard.ts.
services/
  ai/       Python FastAPI (uvicorn, .venv). OpenRouter via openrouter.py. Model per-task
            via env (REKAP_MODEL_PRIMARY, EXEC_MODEL_PRIMARY, default haiku→deepseek-r1).
            chat_or_fallback menelan error secara senyap.
packages/   config, types, ui (shared).
infra/postgres/init/*.sql  Migrasi berurut (0xx_*.sql). Applied manual ke dev + prod.
legacy/     Referensi Python lama — JANGAN dijalankan.
docs/       CUTOVER.md.
```

**Data (Postgres `wrg_os_prod`, akses Tailscale):**
- `public.sales_plan` — kolom AM-key = **`am_id`** (TEXT, = legacy user_id::text). BUKAN `user_id`
  (info_schema tanpa filter schema memunculkan kolom duplikat dari schema lain — jebakan).
  Punya `visit_lat`/`visit_lon` (geo), `reported`, `is_late_plan`, `activity_id`, `seq`.
- `master_user` — roster 63 karyawan (`am_id`, `nama`, `panggilan`, `role`, `cabang`).
- `app_user` — login dashboard (email/password_hash scrypt/role/title/active/wa_number/
  force_change). Terpisah dari `master_user`. JWT HS256 (apps/api/src/auth.ts signJwt/verifyJwt).
  Cookie sesi web: `wrg_session`.
- `wa_message` — `sender_jid` = group_jid (jebakan). `message_type` varchar(20),
  `body`. Backfill WAJIB set `processed_at` atau disapu `processUnprocessed`.
- `activity_log` — hasil/next_action kunjungan. `monitor_digest` — kind ∈ rekap|resume|daily|weekly|briefing, `waktu` varchar(8) (jangan overflow).

## Workflow Git/Rilis (WAJIB diikuti)

1. `feature/*` → PR → **dev**. Tunggu CI hijau (Lint·Typecheck·Build + services/ai import check), lalu merge.
2. Promotion PR **dev → main**. User yang merge.
3. `release.yml` auto-tag semver di main: `feat:` → minor, `fix:` → patch.
4. Setelah user konfirm merge: cek CI, konfirm tag, lalu **deploy**.

- Commit message diakhiri: `Co-Authored-By: Claude ...`. PR body diakhiri tag Claude Code.
- **Jangan pernah** bypass pnpm `minimumReleaseAge` (no `--lockfile` hacks).
- `.env.prod` gitignored. **Jangan** print/log secret.

## Operasi / Deploy (native pm2 di Mac)

Proses pm2 (port): `wrg-prod-ai` (8100, uvicorn .venv), `wrg-prod-api` (4100, dist/index.js),
`wrg-prod-web` (3100, next), `wrg-prod-wabridge`. Auto-boot via LaunchAgent
(`~/Library/LaunchAgents/pm2.development.plist`, Label com.PM2).

```bash
# Build sebelum restart:
pnpm --filter @wrg/api build      # tsc
pnpm --filter @wrg/web build

# Restart — WAJIB bentuk ecosystem (reload .env.prod). JANGAN `pm2 restart <name>`:
pm2 restart ecosystem.config.cjs --only wrg-prod-api,wrg-prod-web --update-env
```

Smoke test endpoint protected (butuh `x-service-token`, env `API_SERVICE_TOKEN`):
```bash
TOK=$(grep -E '^API_SERVICE_TOKEN=' .env.prod | cut -d= -f2-)
curl -s -H "x-service-token: $TOK" "http://localhost:4100/<path>"
```

## Scheduler (apps/api/src/scheduler.ts)

Cron in-process, granular env-gate (`*_ENABLED=true` per job; `AGENT_SCHEDULE_ENABLED=false`
mematikan A1-12). 18 job live. Timezone WIB (wibDate/wibJam). Jadwal di-override via `*_CRON`.
Job: reminder-h/h-1, hod-reminder, plan-check, report-check, monitor rekap/resume,
accurate-sync, notif-tua, daily-summary, weekly-report, detect-leave, extract-competitor,
weekend-briefing, pola-komunikasi, list-members, notif-quota.

**Target broadcast WA harus ditentukan user, bukan diinferensi agent.** Crontab legacy
sudah cutover (dash-free file di-install user; sandbox blok edit crontab).

## Gotcha penting

- `/wa/messages` = store-only (aman). `/webhooks/wa` memicu reply — backfill lewat sini = spam.
- Recovery sales_plan: NOT EXISTS keyed (am_id, tanggal, customer_name, seq); set created_at dari legacy (hindari stamp hari-ini).
- Export dashboard: CSV `sep=,\n` + BOM UTF-8 (`﻿`) → buka mulus di Excel lokal apa pun, tanpa dependency.
- Admin-gate di layer WEB (admin-guard.ts requireAdmin role==admin), bukan di api.
