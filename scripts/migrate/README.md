# Migrasi data legacy → wrg-os

Memindahkan data operasional dari sistem lama (`wrg_crm_prod`, dan kelak
`wrg-monitor`) ke database wrg-os, **additive & idempotent** (boleh dijalankan
ulang untuk menarik delta terbaru — mis. saat cutover).

## `crm-to-os.sql` — wrg_crm_prod → wrg-os

```bash
# DATABASE_URL = koneksi wrg-os (user superuser, mis. development)
psql "$DATABASE_URL" -f scripts/migrate/crm-to-os.sql
```

Apa yang dilakukan:

- Memasang `postgres_fdw` ke `wrg_crm_prod` (schema `prod_fdw`, read-only).
- Pemetaan kunci: **`os.am_id = prod.user_id::text`** (id-space identik karena
  wrg-os dulu di-port dari prod ini).
- Strategi per tabel:
  - **id bigint sejajar** (`accurate_*`, `sales_plan`, `activity_log`) → `UPSERT by id`.
  - **uuid / re-seed** (`sales_todo`, `competitor_intel`, `user_leave`,
    `master_holiday`) → `INSERT-MISSING by natural key` (non-destruktif).
  - `master_territory`, `sales_target_*`, `master_user` → upsert by natural key.
- Kolom prod-only yang tak ada di skema wrg-os di-drop (mis. `photo_path`,
  `photo_geotag`, `pipeline_id`, `message_id` legacy). Foto kunjungan ada di
  tabel `visit` terpisah.
- Tidak pernah `DELETE`/`TRUNCATE`. Baris khas wrg-os dipertahankan.

Catatan koneksi FDW di SQL (host `localhost`, db `wrg_crm_prod`, role
`development`) spesifik mesin lokal — sesuaikan bila berbeda.

## Belum tercakup

- **Data `wrg-monitor`** (rekap/resume/pola/members) sumber aslinya **sqlite di
  `~/Documents/wrg-monitor`** yang terkunci **TCC macOS** (tak terbaca dari sini).
  Data monitor di wrg-os (`monitor_digest`/`monitor_member`/`monitor_pola`) berasal
  dari port sebelumnya. Bila perlu refresh dari sumber, beri akses folder tsb lalu
  tambahkan `monitor-to-os.sql`.
- `am_reminder` prod kosong saat migrasi → tak ada yang dipindah.

Lihat [`docs/CUTOVER.md`](../../docs/CUTOVER.md) untuk runbook cutover cron.
