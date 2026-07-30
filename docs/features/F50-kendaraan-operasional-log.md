# F50 — Kendaraan Operasional Log

| | |
|---|---|
| Domain | OPS |
| FR | FR-ES-50 |
| Tier | R1 |
| Prioritas | SHOULD |
| Sprint | B2 |
| Status | DRAFT-SB2 |
| Owner | Dito, Husni, Direktur |
| Branch | `feat/f50-kendaraan-operasional-log` (dari `dev`, standalone) |

## Ringkasan

Per-vehicle log (km, BBM, service, STNK expiry, sopir) + auto-alert service
due. 7 mobil per data Fafa (belum diinput — lihat "Data produksi" di bawah).

## Cara kerja

- **Tabel `vehicle`** (`infra/postgres/init/068_vehicle_operational_log.sql`)
  — master KECIL (7 mobil), **SENGAJA tanpa halaman "tambah kendaraan"**
  (konvensi magang: master data kecil/statis = seed SQL, bukan CRUD — lihat
  memory `wrg-os-magang-seed-over-ui`). `sopir_name` TEXT bebas, bukan FK ke
  `master_user` (sopir belum tentu karyawan terdaftar).
- **Tabel `vehicle_log`** — transaksional (km/BBM/service), tumbuh terus,
  ini yang punya halaman input (`AddLogDialog`).
- **API**: `apps/api/src/repo/vehicle.ts` — `listVehicles` (hitung
  `service_due`/`stnk_due` on-the-fly), `createVehicleLog` (update
  `current_km`/`last_service_km` otomatis), `updateVehicle` (edit
  sopir/STNK/interval), `runVehicleAlerts` (cron).
- **Cron**: `apps/api/src/scheduler.ts` job `vehicle-alert`, env
  `VEHICLE_ALERT_ENABLED` (default off) + `VEHICLE_ALERT_CRON` (default
  `0 8 * * *`). Kirim WA ke `VEHICLE_ALERT_WA_TARGET` (kosong = skip, anti
  broadcast tak sengaja).
- **Web**: halaman `/vehicles` (grup Operations) — tabel status +
  3 aksi per baris: Tambah Log, Riwayat, Edit.

## Keputusan desain

1. **Alert service-due: KM-BASED, sekali per crossing** — beda dari STNK
   (date-based, bisa H-14/H-30). `current_km - last_service_km >=
   service_interval_km` → alert sekali (`service_alert_sent_at`), reset
   otomatis begitu ada log `service` baru. Tak ada "H-14" utk service krn km
   tak bisa diprediksi majú berapa hari lagi tanpa data pemakaian harian.
2. **Alert STNK: H-30** (bukan H-14 spt F24) — **ASUMSI ballpark**, STNK
   butuh lead time administratif lebih panjang dari PM alat. Reset otomatis
   kalau `stnk_expiry` di-update (renewal) via `PATCH /vehicles/:id`.
3. **`service_interval_km` default 5000, per-kendaraan bisa beda** (edit
   manual) — konsisten filosofi F24 `interval_bulan` manual per alat.
4. **Tanpa hashtag WA** — deskripsi board eksplisit "Hashtag —", jadi semua
   input lewat web (bukan pola #KIRIM/#BAST spt F12/F42).

## Data produksi — BELUM diisi

Migrasi **schema-only** (tanpa data — migrasi jalan ke prod juga, jangan
taruh dummy di situ). Dev-only seed 7 mobil dummy: `scripts/db/seed-vehicle-dev.sql`.
**7 mobil ASLI (plat nomor, model, sopir) perlu diinput manual oleh
Direktur/Fafa** via SQL serupa sebelum fitur ini dipakai sungguhan di
produksi — TIDAK ada halaman input utk ini (sesuai keputusan desain #4 di
`wrg-os-magang-seed-over-ui`).

## Verifikasi (2026-07-30, lokal)

- Seed 7 mobil dummy → `GET /vehicles` tampilkan status `service_due`/
  `stnk_due` sesuai kombinasi km/tanggal yang diseed.
- `POST /vehicles/:id/logs` (`log_type:"service"`) → `current_km` &
  `last_service_km` ke-update, `service_due` balik `false`.
- `PATCH /vehicles/:id` (`stnk_expiry` baru) → `stnk_due`/`stnk_days_left`
  ke-update.
- Validasi `log_type` invalid → `400` dgn pesan jelas.
- Typecheck + lint (api & web) + `next build` semua clean.
