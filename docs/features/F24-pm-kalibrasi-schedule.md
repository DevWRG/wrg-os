# F24 — Preventive Maintenance & Kalibrasi Schedule

| | |
|---|---|
| Domain | AFTERSALES |
| FR | FR-ES-24 |
| Tier | R1 |
| Prioritas | SHOULD |
| Sprint | B3 |
| Status | DRAFT-SB3 |
| Branch | `feat/f24-pm-kalibrasi-schedule` (dibangun DI ATAS branch `feat/f22-instalasi-alat-lifecycle`) |

## Ringkasan

Cron reminder per alat berdasar tanggal install → notif teknisi 14 hari
sebelum jatuh tempo PM/kalibrasi. **Recurring**: begitu 1 siklus ditandai
selesai, sistem otomatis hitung siklus berikutnya — 1 baris per alat terus
dipakai ulang sepanjang umur alat itu.

## Dependensi ke F22

F24 butuh tanggal install per alat = `installation_unit.bast_at` (BAST selesai
di F22). Karena itu branch ini di-*fork* dari branch F22, bukan dari `dev` —
**F22 harus di-merge ke `dev` duluan** sebelum F24 di-PR, supaya diff PR F24
bersih (cuma perubahan F24 sendiri, tidak kebawa gabung sama F22).

## Cara kerja

- **Tabel**: `maintenance_schedule` (`infra/postgres/init/069_maintenance_schedule.sql`)
  — FK `installation_unit_id` ke tabel F22, `UNIQUE` (1 schedule per alat).
- **API**: `apps/api/src/repo/maintenance.ts` — `createSchedule`, `markDone`
  (advance ke siklus berikutnya), `runMaintenanceReminders` (dipanggil cron).
- **Cron**: job baru di `apps/api/src/scheduler.ts`, env
  `PM_KALIBRASI_REMINDER_ENABLED` (default off) + `PM_KALIBRASI_REMINDER_CRON`
  (default `0 8 * * *`, 08:00 WIB). Cari baris `status='scheduled' AND
  due_date = current_date + 14`, kirim WA ke `teknisi_wa_number` per-baris,
  tandai `notified` kalau sukses kirim (gagal kirim → tetap `scheduled`,
  dicoba lagi run besok — retry-safe).
- **Web**: halaman `/maintenance` (grup Operations).

## Keputusan desain

1. **1 baris per alat, recurring in-place** — bukan riwayat multi-baris per
   siklus. `completed_count`/`last_completed_at`/`last_note` cuma simpan
   ringkasan siklus terakhir.
2. **`reference_date` siklus baru = tanggal SELESAI diklik** (rolling dari
   completion, bukan dari `due_date` lama) — hindari drift kalau PM sering
   telat/lebih cepat dari jadwal asli.
3. **ETA/interval**: `interval_bulan` diisi manual per-alat saat dijadwalkan
   (fleksibel, alat beda punya interval beda) — bukan fixed global.
4. **`teknisi_wa_number` teks bebas** — bukan lookup ke `master_user`/HR
   (off-limits, lihat `ONBOARDING.md` §2).

## Verifikasi

Testing cron tanpa nunggu jam 08:00 — set `due_date` manual ke `current_date + 14`
lewat `docker compose exec -T postgres psql ...`, lalu panggil
`runMaintenanceReminders()` langsung via `npx tsx` (bukan lewat scheduler
sungguhan). WA terkirim mode **stub** di lokal (tak ada `WA_SEND_URL`).

## Terkait

- [F22 — Instalasi Alat Lifecycle](./F22-instalasi-alat-lifecycle.md) — dependensi wajib, harus merge duluan.
