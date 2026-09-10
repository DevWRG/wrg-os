# F133 — Aset Assignment + Transfer + History Timeline

| | |
|---|---|
| Domain | GA |
| FR | FR-GA-133 |
| Tier | R1 |
| Prioritas | MUST |
| Sprint | S10 |
| Owner | HoD (approver), Dito (R), Husni (C) |
| Branch | `feat/f133-ga-asset-assignment` (DI ATAS `feat/f132-ga-aset-master`) |

## Ringkasan

Assign/return/transfer PIC aset kantor + histori lengkap. Beda dari override
PIC cepat yang sudah ada di F132 (`repo/ga-asset.ts`, PATCH biasa tanpa
histori) — fitur ini "aksi resmi" yang selalu tercatat di
`ga_asset_assignments`/`ga_asset_transfers` kalau PIC-nya user terdaftar.

## Cara kerja

- **Assign** (`POST /ga-assets/:id/assign`): `user_id` ATAU `pic_name` bebas
  (auto-resolve exact case-insensitive match ke `app_user.name`). Guard
  "1 aset = 1 PIC aktif" — DITOLAK kalau aset non-shared sudah punya PIC
  aktif. Kategori `is_shared` (F132) DIKECUALIKAN dari guard ini (dicek di
  app-layer, bukan constraint DB — partial unique index tak bisa join
  kategori). Assign via nama yang TIDAK match user terdaftar tetap berhasil
  (nempel ke `ga_assets.pic_name_override`) tapi TANPA baris histori —
  trade-off diadopsi dari source `gais`.
- **Return** (`POST /ga-assets/:id/return`): tutup assignment aktif
  (`returned_date`). Kalau ambigu (kategori shared, >1 assignment aktif),
  wajib sebut `assignment_id` atau `user_id`. Setelah return, cache
  `ga_assets.current_pic_user_id` di-recompute (assignment aktif lain kalau
  ada, kalau tidak dikosongkan).
- **Transfer** (`POST /ga-assets/:id/transfer`): pindah PIC + opsional
  lokasi. `to_user_id` WAJIB resolve ke user terdaftar (simplifikasi
  sengaja drpd source `gais` yang izinkan free-text juga di transfer —
  histori transfer selalu punya `to_user_id` valid, kalau PIC tujuan belum
  terdaftar arahkan user pakai override PIC F132 dulu).
- **History** (`GET /ga-assets/:id/history`): gabungan assign+return+transfer
  satu aset, urut tanggal terbaru dulu.
- **WA notif**: PIC baru dapat pesan WA (nomor dari `app_user.wa_number`
  langsung — ternyata SUDAH ADA kolomnya, migrasi 031, bukan perlu join ke
  `master_user` seperti asumsi awal). CC opsional via env
  `GA_ASSET_NOTIFY_CC`. One-shot (bukan cron), jadi tidak perlu penanda
  anti-spam seperti F37/F45/F50 — kalau WA gagal kirim, assign/transfer-nya
  sendiri tetap sukses (`.catch(() => {})`, best-effort).
- **Picker PIC**: endpoint baru `GET /app-users` (id+name+active saja),
  SENGAJA bukan admin-only (beda dari `/admin/users` yang di-gate
  `requireAdmin`) — staf GA non-admin tetap bisa pilih PIC saat assign.
- **Audit log**: tiap assign/return/transfer (termasuk assign nama-bebas
  yang tak dapat baris histori F133 sendiri) di-log ke `audit_log`
  (governance D6, migrasi 002) sbg **Layer 5 = Human** — kolom itu
  disediakan skema justru utk aksi manusia non-AI, jadi dipakai persis
  sesuai peruntukannya. `agent_id` NULL (bukan run AI-agent), `use_case_id
  ='F133'`, `r_tier='R1'`. Best-effort (gagal audit tak gagalkan aksi
  utamanya). ⚠️ `audit_log` **append-only** (RULE DB no-update/no-delete)
  — baris uji coba di sana permanen, tak bisa dihapus manual, cuma
  hilang kalau DB direset total.

## Keputusan desain

- PIC WAJIB `app_user.id` (bukan teks bebas seperti F22/F50/F52) — sesuai
  deskripsi asli fitur, dikonfirmasi user meski beda dari konvensi lain di
  repo.
- Tabel `ga_asset_transfers.to_user_id` **NOT NULL** (beda dari
  `from_user_id` yang nullable) — transfer selalu punya tujuan jelas.

## ⚠️ BUTUH MIGRASI DB

`infra/postgres/init/088_ga_asset_assignment.sql` — `ga_asset_assignments` +
`ga_asset_transfers` (tabel baru, FK ke `ga_assets` migrasi 086).

## Pengujian

Assign → guard duplikat ditolak (non-shared) / diizinkan (shared) → assign
free-text tak nambah histori → transfer (histori+lokasi+cache update) →
return (cache reset, assignment aktif lain kepilih kalau shared) → history
gabungan urut benar. `audit_log` terisi 1 baris per aksi (termasuk
free-text) dgn `layer=5`/payload benar. Halaman `/ga-aset` kolom "PIC"
render tombol kontekstual (Assign vs Return+Transfer) + Riwayat. Typecheck
+ lint bersih.
