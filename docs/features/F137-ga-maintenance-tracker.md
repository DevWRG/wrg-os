# F137 — GA Maintenance & Recurrence Tracker

| | |
|---|---|
| Domain | GA |
| FR | FR-GA-137 |
| Tier | R2 |
| Prioritas | SHOULD |
| Sprint | S12 |
| Owner | Husni (A), Dito (R), Fafa/Aftersales (shared knowledge) |
| Branch | `feat/f137-ga-maintenance-tracker` (DI ATAS `feat/f132-ga-aset-master`) |

## Ringkasan

Jadwal maintenance aset (preventive/reactive) + recurrence + approval
Finance utk biaya besar. Upgrade sengaja dari source `gais` — lihat
"Keputusan desain" di bawah, bukan replikasi 1:1.

## Cara kerja

- **`ga_vendor`**: master vendor GA (servis AC/genset/dst), TERPISAH dari
  `accurate_vendor` (mirror Accurate, vendor barang/purchasing — konsern
  beda total).
- **`ga_maintenance_schedules`**: `asset_id`/`vendor_id` FK sungguhan
  (source `gais` cuma free-text) — F132 sekarang kasih registry aset nyata
  yang source-nya dulu tak punya. Status
  `requested→in_progress→completed/cancelled` persis diadopsi source.
  "Overdue" **dihitung saat baca** (`due_date < today AND status NOT IN
  (completed,cancelled)`), TIDAK disimpan sbg status sendiri — pelajaran
  F38 (tier statis bikin alert berhenti tepat pas paling mendesak).
- **Recurrence**: `recur_months` (0/1/3/6/12) + `recur_parent_id`.
  Kemunculan baru auto-dibuat begitu status BENAR-BENAR `completed`
  (langsung atau lewat approval Finance) — bukan saat cost dicatat doang.
- **Approval Finance** (TAMBAHAN, tak ada di source `gais` sama sekali):
  `cost_actual > Rp5jt` tanpa `approved_by` → status jatuh ke
  **`pending_finance`** (bukan ditolak keras) begitu ditandai selesai,
  menunggu Finance approve. Approve valid HANYA dari `pending_finance`.
  Guard SIAPA boleh approve ada di layer WEB
  (`lib/ga-maintenance-access.ts`, `canApproveGaFinance` — title
  mengandung "finance" ATAU matriks Akses Grup via feature key baru
  `ga-finance-approval`, didaftarkan manual di migrasi 089 krn bukan nav
  item). `approved_by` di BFF (`api/ga-maintenance/[id]/approve/route.ts`)
  **selalu diambil dari sesi login** kalau ada (anti spoof client) —
  fallback body cuma jalan kalau `AUTH_ENABLED=false` (dev, belum ada sesi).
- **Cron `ga-maintenance-alert`**: reminder due-date (default harian
  07:00, target via `GA_MAINTENANCE_WA_TARGET`). Naggy by design (pola
  F24 — tanpa penanda anti-spam persisten, cek ulang tiap run), BUKAN
  pola F38 (tier + marker) — sengaja lebih simpel krn brief cuma minta
  "cron reminder", bukan sistem tier bertingkat.
- **Cron `ga-maintenance-bsc-feed`**: auto-isi `kpi_measurement` utk KPI
  baru Dito ("Aset utilization/maintenance cost", seed migrasi 090,
  perspective `fin`) — **PRESEDEN PERTAMA auto-feed** ke tabel itu
  (sebelumnya semua diisi manual lewat UI raport). Formula
  `achievement_pct` = % maintenance `completed` on-time bulan berjalan —
  **ASUMSI teknis** (brief cuma sebut nama KPI, bukan rumus), gampang
  diganti tanpa ubah skema kalau Direktur mau basis lain.
- **UI**: 2 tab baru (Maintenance, Vendor GA) digabung ke menu `/ga-aset`
  yang sudah ada — TIDAK bikin halaman/menu baru, konsisten arahan
  Direktur soal F52 (harus 1 menu, bukan cuma 1 tabel).

## Jadwal rutin otomatis per kategori (ditambahkan setelah cross-check user)

Brief F137 kasih contoh eksplisit "kendaraan 6 bulan, AC 3 bulan" yang
sebelumnya belum ada — `recur_months` cuma manual per-jadwal tanpa default
apa pun. Ditambahkan: `ga_asset_categories.default_recur_months` (migrasi
091, ALTER dari branch ini — pola sama F42 nge-ALTER tabel F12). Admin isi
sendiri per kategori (TIDAK diseed, F132 sengaja mulai kosong).
`createSchedule()` fallback ke default kategori kalau `recur_months` tak
diisi (server-side, berlaku juga utk API langsung) — form web juga
auto-isi field-nya begitu aset dipilih (tetap bisa diubah manual).

## Keputusan desain

- Approval gate HANYA di F137 (cost_actual), TIDAK di F132 (purchase
  besar) — brief kasih ambang angka eksplisit cuma di F137, F132 cuma
  bilang Finance "C" (consulted) tanpa ambang. Kalau ternyata Direktur mau
  F132 juga di-gate, pattern-nya sama tinggal ditempel ke `ga_assets`.
- Endpoint `GET /app-users` diduplikasi dari F133 (sibling branch, sama2
  di atas F132, BUKAN turunan satu sama lain) — perlu dedup manual pas
  salah satu merge duluan ke `dev`.

## ⚠️ BUTUH MIGRASI DB

- `infra/postgres/init/089_ga_maintenance_tracker.sql` — `ga_vendor` +
  `ga_maintenance_schedules` (tabel baru) + insert 1 baris `feature`
  (`ga-finance-approval`).
- `infra/postgres/init/090_seed_ga_maintenance_kpi.sql` — insert 1 baris
  `kpi` (employee_id='dito', idempoten via NOT EXISTS).

## Pengujian

End-to-end via API langsung DAN lewat BFF web: create → start → complete
(cost kecil → langsung `completed` + recurrence baru muncul dgn due_date
+N bulan) → create lain, complete cost besar → jatuh `pending_finance` →
approve (fallback body, tanpa sesi) → `completed` + `approved_by` terisi →
cancel (guard tak bisa cancel yg sudah completed/cancelled) → BSC feed
manual (`achievement_pct=100`, 2 schedule on-time bulan itu). Halaman
`/ga-aset` 4 tab render normal. Typecheck + lint bersih di semua commit.
