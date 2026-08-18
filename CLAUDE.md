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
- `wa_message` — `sender_jid` = group_jid (jebakan). `message_type` **text** (dilebarkan
  dari varchar(20) di migrasi 038 — MIME openclaw panjang bikin INSERT gagal 22001),
  `body`. Backfill WAJIB set `processed_at` atau disapu `processUnprocessed`.
- `activity_log` — hasil/next_action kunjungan. `monitor_digest` — kind ∈ rekap|resume|daily|weekly|briefing, `waktu` varchar(8) (jangan overflow).
- **Klasifikasi produk** (migrasi 072, menu `/klasifikasi-produk`): `product_kategori` / `product_line` /
  `product_class` / `product_sub_class` + `product_code` (kode `KK.PP.CC.SSS.NNNN`) + `product_code_review`.
  Nomor id **berulang per induk** (product line & class per kategori, sub class per CLASS) → semua kunci
  komposit, resolusi WAJIB hirarkis. Jebakan: generator di spreadsheet sumber pakai VLOOKUP nama saja
  (nama Class/Sub Class kembar ambil id kategori lain), sub class 2 digit di satu sheet & 3 digit di sheet
  lain, dan nomor urut per-sheet — jangan direplikasi. Kode lama disimpan di `kode_legacy`/`kode_2025`;
  kode yang sudah terbit tidak pernah diubah (menempel di Accurate). Isi lewat
  `scripts/db/import_product_classification.py` (data tidak di repo).

## Accurate mirror + menu OPERATIONS & dashboards

Mirror Accurate Online (read-only puller di `apps/api/src/repo/accurateSync.ts`, auth Bearer + X-Api-Timestamp WIB + X-Api-Signature HMAC). Tabel `accurate_customer/_item/_branch/_vendor/_invoice/_invoice_item/_sales_order/_delivery_order` + `ar_aging_mv`.

| Menu / fitur | Sumber | Endpoint | Catatan |
|---|---|---|---|
| Products / Inventory | `item/list.do` (+stok) | `/accurate/items`, sync `/accurate/sync/items` | full katalog (~5.8rb) |
| Suppliers | `vendor/list.do` (+detail on-demand) | `/accurate/vendors`, `/accurate/vendors/:id/detail` | full |
| Orders | `sales-order/list.do` | `/accurate/sales-orders`, item `/accurate/sales-orders/:id/items` | **recent-only ~500** (sort transDate desc) |
| Shipments | `delivery-order/list.do` | `/accurate/shipments`, item `/accurate/shipments/:id/items` | **recent-only ~500** |
| Sales Overview (OVERVIEW) | invoice/order/item/AR | `/dashboard/overview` | KPI+delta, tren, donut, best-selling, top customer/sales, AR aging |
| Customers (revenue monitor) | `accurate_invoice` | `/customers/revenue`, `/customers/:id/monthly` | per-customer total/bulan-ini/transaksi-terakhir + **dormant >60 hari** |
| Sales Performance | invoice | `/sales/revenue` | Per Sales pakai nama lengkap+cabang (resolve `accurate_salesman.master_user_id → master_user`) |

- Orders & Shipments **recent-only by design** (volume ~11.8rb/11.9rb) → di-mirror via `syncSalesOrders`/`syncDeliveryOrders`, ikut job `accurate-sync` (auto-refresh).
- Detail Orders/Shipments/Suppliers/Customers pakai komponen **Dialog** (modal center, `components/ui/dialog.tsx`), bukan Sheet samping.
- Resolusi nama: `COALESCE(NULLIF(name,''), raw->'customer'->>'name', …)` — kolom mirror bisa empty-string (bukan NULL), `COALESCE` saja tak cukup.

## Price Book keagenan (F142) — `/pricebook`

Katalog harga jual produk **keagenan** WRG hasil handover Direktur (tabel `product_pricelist`,
migrasi 071). Beda dari `pricelist` (043) yang kalkulator HPP→margin internal: ini price book
final yang dipakai sales. Repo API `apps/api/src/repo/pricebook.ts` → `/pricebook/{items,summary,outside,periode}`.

- **Data TIDAK di repo** (repo PUBLIC). Isi lewat `scripts/db/import_pricebook.py --file <CSV> --db <target> [--apply]`;
  CSV ada di Drive `16-Sales-PriceList-H2-2026/`. Idempoten by `(periode, row_no)`, dry-run default.
- `harga_nett` = lantai harga (di bawahnya butuh izin Direksi); `nett_ppn` = PPN 11% **dari nett**,
  bukan dari price list. Keduanya disimpan apa adanya dari sumber — **jangan** dihitung ulang.
  13 nilai beda Rp 1 karena sumber pakai pembulatan half-even (importer melaporkan, tidak menolak).
- Pencocokan ke Accurate hanya lewat **kode** (`accurate_item.no = product_pricelist.kode`); item
  Accurate tanpa pasangan = tab **Di Luar Keagenan**. Jebakan: 141 SKU keagenan sendiri tidak punya
  kode, jadi daftar "di luar keagenan" pasti kelebihan — jangan ditambal fuzzy-match nama (22 nama
  di price book dipakai berulang dengan harga beda).
- Gate: katalog = semua user berizin fitur `pricebook`; tab Ringkasan = Direktur/admin/superuser
  (`apps/web/src/lib/pricebook-access.ts`). HPP/margin/harga sub-dealer memang tidak ada di data.

## Workflow Git/Rilis (WAJIB diikuti)

1. `feature/*` → PR → **dev**. Tunggu CI hijau (Lint·Typecheck·Build + services/ai import check), lalu merge.
2. Promotion PR **dev → main**. User yang merge.
3. `release.yml` auto-tag semver di main: `BREAKING CHANGE`/`<type>!:` → major; `feat:` → minor;
   **selain itu → patch** — termasuk `docs:`/`chore:`/`style:`, jadi commit apa pun ke main bikin tag baru.
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
mematikan A1-12). 19 job live. Timezone WIB (wibDate/wibJam). Jadwal di-override via `*_CRON`.
Job: reminder-h/h-1, hod-reminder, plan-check, report-check, monitor rekap/resume,
accurate-sync, notif-tua, daily-summary, weekly-report, detect-leave, extract-competitor,
weekend-briefing, pola-komunikasi, list-members, notif-quota, watchpoint-snapshot.

- `accurate-sync` (weekday 6×) sekarang juga refresh mirror **sales-order + delivery-order** (recent) setelah pull invoice → menu Orders/Shipments auto-update.
- `watchpoint-snapshot` (Senin 06:00, `WATCHPOINT_SNAPSHOT_ENABLED`) membekukan metric computed minggu lalu ke `watchpoint_weekly` — sumber riwayat tab **WatchPoint → Weekly** & deck PPTX. Tanpa job ini minggu lewat ikut berubah tiap dibuka.

**Target broadcast WA harus ditentukan user, bukan diinferensi agent.** Crontab legacy
sudah cutover (dash-free file di-install user; sandbox blok edit crontab).

**Reminder "Daily Sales Update HoD"** (rotasi Yogi=ganjil/Rocky=genap ke grup Koord HoD, 20:00 Sen–Jum) BUKAN di sini — itu **cron openclaw** (`openclaw cron list`, store `~/.openclaw/cron/jobs.json`), agent menyusun pesannya dinamis. Pernah hilang & di-recreate; lihat memory `wrg-os-openclaw-hod-reminder`.

## Gotcha penting

- `/wa/messages` = store-only (aman). `/webhooks/wa` memicu reply — backfill lewat sini = spam.
- Recovery sales_plan: NOT EXISTS keyed (am_id, tanggal, customer_name, seq); set created_at dari legacy (hindari stamp hari-ini).
- Export dashboard: CSV `sep=,\n` + BOM UTF-8 (`﻿`) → buka mulus di Excel lokal apa pun, tanpa dependency.
- Admin-gate di layer WEB (admin-guard.ts requireAdmin role==admin), bukan di api.
- **Inbound foto**: balasan ack pakai cooldown in-memory per-AM (90 dtk, `lastPhotoReplyAt` di inbound.ts) — foto visit sering datang berurutan (bukan barengan) jadi debounce `pending_photos` saja tak cukup; tanpa cooldown bot bales tiap foto (spam).
- **`deal.brand` dinormalisasi TRIGGER** (`deal_brand_norm_trg`, migrasi 107): nilai tersimpan bisa **beda dari yang diketik** — `'ZYBIO'`/`'zybio'`/`'Zibio'` semuanya jadi `'Zybio'` lewat kamus `brand_alias` + `norm_brand()`. Merek yang belum terdaftar dibiarkan (cuma di-trim) supaya merek baru tak pernah hilang. Menambah/ubah pemetaan = INSERT ke `brand_alias`, bukan edit kode. Kalau ada tes yang menyangka brand tersimpan apa adanya, ini sebabnya.
- **WatchPoint Weekly**: nomor minggu = **ISO-8601** (Senin–Minggu). Deck HoD lama pakai penomoran sendiri (mis. "W24" = 6–12 Juni 2026) → nomor bisa selisih 1 dari deck lama; yang dipakai sistem adalah rentang tanggalnya. Snapshot `source='db'` wajib ikut di-INSERT (default kolom = `manual`), kalau tidak snapshot berikutnya tertolak oleh `WHERE source='db'` dan angka berhenti diperbarui.
