# F8 — Teknisi Readiness Board (install scheduling + capacity + post-install reports)

| | |
|---|---|
| Domain | AFTERSALES |
| Hashtag | #INSTALL #SERVIS #TRAINING #KALIBRASI |
| FR | FR-SB2-08 |
| Tier | R2 |
| Prioritas | MUST |
| Sprint | S18-S22 |
| Status | DRAFT-SB2 |
| Owner | Mufid (HoD Aftersales) |
| Branch | `feat/f8-teknisi-readiness-board` (di atas `feat/f24-pm-kalibrasi-schedule`, yang sudah include F22) |

## Ringkasan

Dashboard kesiapan teknisi: kapasitas kerja per teknisi, penjadwalan install (terhubung ke alat dari F22), dan laporan lapangan pasca-instalasi via 4 hashtag WA (#install/#servis/#training/#kalibrasi) — pola sama `#plan`/`#report` yang sudah dipakai Teknisi.

> **Latar belakang tugas** ("4 dari 5 teknisi PHANTOM in archive", "briefing 24/5 RS NMU install gap") **tidak bisa diverifikasi dari data lokal** — itu soal riwayat WA production yang tak ter-reflect di DB dummy. Dikonfirmasi: ini cuma motivasi kenapa fitur ini dibutuhkan, BUKAN tugas rekonsiliasi data historis. F8 dibangun forward-looking.

## Dependensi ke F22 + F24

Board ini **terhubung** ke `installation_unit` (F22, penjadwalan install tertaut alat terdaftar) dan `maintenance_schedule` (F24, kapasitas mempertimbangkan PM/kalibrasi yang sedang berjalan). Karena itu branch F8 di-*fork* dari branch F24 (yang sudah include F22) — **bukan** dari `dev`. Push/PR F8 nunggu F22 **dan** F24 kelar merge duluan (sama situasi F24-di-atas-F22, cuma 1 level lebih dalam).

## Cara kerja

- **Tabel** (`infra/postgres/init/070_teknisi_readiness_board.sql`):
  - `teknisi_capacity` — roster + kapasitas kerja (`max_concurrent_jobs`). **Self-contained**, TIDAK reuse `teknisi_roster` F26 (beda lineage branch). Dev/demo tetap pakai 3 teknisi dummy dari seed (`scripts/db/seed-dev-full.sql`: Fajar/Gilang/Hesti) — tapi sekarang **ada CRUD** (`POST /teknisi-capacity`, `PATCH /teknisi-capacity/:id`, `PATCH /teknisi-capacity/:id/deactivate`, tombol "Tambah Teknisi" + edit/nonaktifkan di halaman) supaya Admin bisa isi roster asli (6 orang aftersales — galih/martin/nopa/haidar/halim/enggar, ada di tabel `employee`/BSC, TERPISAH dari tabel ini) tanpa sentuh DB manual. Deactivate bukan DELETE (jaga histori `install_schedule`/`teknisi_report` yang FK ke sini).
  - `install_schedule` — jadwal install, **FK wajib** ke `installation_unit` (F22).
  - `teknisi_report` — laporan lapangan (4 jenis sesuai hashtag), `wa_message_id UNIQUE` (idempotensi).
- **API**: `apps/api/src/repo/readinessboard.ts` — `getReadinessBoard()` (agregat kapasitas), `createInstallSchedule`/`updateScheduleStatus`, `createTeknisiReport`/`listTeknisiReports`.
- **Hook WA inbound** (`apps/api/src/repo/inbound.ts`, EXTEND — bukan hook baru): `detectKind()` + SELECT filter `processUnprocessed()` di-extend dengan 4 hashtag baru. **Beda dari F26**: grup WA-nya KEMUNGKINAN SUDAH ADA (grup yang sama dipakai Teknisi utk `#plan`/`#report`), jadi **tidak ada env-gate baru** — cukup nebeng `WA_INBOUND_GROUPS`/`groupAllowed()` yang sudah ada. Identitas pengirim di-match ke `teknisi_capacity` via `matchTeknisiByName` (fuzzy `ILIKE`, bukan `resolveSender`/`master_user`).
- **Web**: halaman `/readiness-board` — 3 section (Kapasitas, Install Schedule, Laporan Terbaru).

## Kapasitas — cara hitung

`capacity_used` = jumlah `install_schedule` status `'scheduled'` (F8 sendiri) **+** jumlah `maintenance_schedule` (F24) status `'scheduled'`/`'notified'` yang `teknisi_name`-nya match nama teknisi ini (cross-tabel by **name-match**, `maintenance_schedule.teknisi_name` teks bebas tanpa FK).

**Limitasi eksplisit**: name-match ini **tanpa fallback** (beda dari `assignTeknisi` F26 yang sudah di-fix pakai fallback) — karena ini murni metrik **display**, bukan aksi assignment. Kalau nama tak match, kontribusi dari F24 dianggap 0 (bukan bug, cuma keterbatasan cross-tabel tanpa FK).

## Migrasi numbering — catatan penting

Migrasi ini `070` **relatif ke lineage F22→F24→F8**. Branch F26 (lineage terpisah dari `dev`) **juga** pakai nomor `070` (`070_service_ticket_triage.sql`) di lineage-nya sendiri — ini BUKAN git-conflict (branch independen), tapi siapa pun yang merge branch KEDUA ke `dev` (setelah salah satu dari F8-chain atau F26 duluan merge) **wajib renumber filenya sendiri jadi `071`**.

## Verifikasi

Berbeda dari F26 — jalur WA F8 **bisa ditest penuh lokal** (grup gate = allow-all selama `WA_INBOUND_GROUPS` kosong):

```bash
# 1. Buat unit F22 + BAST-in (prasyarat install_schedule)
curl -X POST localhost:4000/installations -H 'content-type: application/json' -d '{"alat_name":"USG Test","customer_name":"RS Test"}'
# ... po-control → sj → assign-teknisi → training → bast (lihat verifikasi F22)

# 2. Jadwalkan install
curl -X POST localhost:4000/install-schedule -H 'content-type: application/json' \
  -d '{"installation_unit_id":"<id>","scheduled_date":"2026-08-01"}'

# 3. Cek readiness board
curl localhost:4000/readiness-board

# 4. Simulasi WA nyata (set WA_INBOUND_PROCESS=true dulu di .env, restart api):
#    INSERT wa_message manual (sender_name = salah satu nama seed, body = "#install ...")
#    lalu trigger processUnprocessed() — cek teknisi_report baru + wa_message.processed_kind='install'
```

## Terkait

- [F22 — Instalasi Alat Lifecycle](./F22-instalasi-alat-lifecycle.md) — dependensi wajib (install_schedule FK ke installation_unit).
- [F24 — PM & Kalibrasi Schedule](./F24-pm-kalibrasi-schedule.md) — dependensi wajib (kapasitas baca maintenance_schedule).
- [F26 — Service Ticket Triage](./F26-service-ticket-triage.md) — lineage branch terpisah, TIDAK terhubung (nomor migrasi 070 kebetulan sama, lihat catatan numbering di atas).
