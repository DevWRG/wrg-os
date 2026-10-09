# F55 — Cuti & Backup PIC Registry (HR)

Saat karyawan cuti, sistem mencatat **pengganti (backup PIC)**, lalu memberi tahu
grup yang terdampak dan pengganti itu sendiri: *"PIC X cuti s/d <tgl>, sementara ke Y"*.
Ini bagian "Backup PIC" yang dipecah dari F14 (F14 sekarang Kalender Libur saja).

- **Domain**: HR · FR-ES-55 · R1 · MUST · Sprint B1 · owner HRD WRG + semua HoD
- **Menu**: tidak ada menu baru. `/leave` mendapat field + kolom Pengganti, dan
  `/calendar/[date]` mendapat kartu "Tidak Masuk & Backup PIC"
- **Migrasi**: `189_leave_backup_pic.sql`, satu kolom `user_leave.backup_am_id` (additive, idempoten)
- **Kenapa perlu**: 37 mention libur/cuti di arsip WA = 100% disruption event. Pita cuti
  bikin laporan macet; Bu Henny cuti bikin TTF tertunda 5 hari. Kalender libur saja tidak
  mencegah itu. Yang mencegah: pengganti ditunjuk, dan grup tahu harus menghubungi siapa.

## 1. Titik penunjukan pengganti

| Jalur | Di mana | Catatan |
|---|---|---|
| Tambah cuti manual | Sheet "Tambah cuti" di `/leave` → `POST /leave` | field `backup_am_id` |
| Approve pending (dashboard) | Tombol Approve di tabel Pending, membuka dialog pilih pengganti → `POST /leave/pending/:id/decide` | body `{approve:true, backup_am_id}` |
| Approve pending (WA) | Balasan approver di grup HRD: **`ya L<id> <nama pengganti>`** | nama di-resolve dengan fuzzy match roster yang sama (`resolveWajib`); `@mention` dan kata "pengganti:" dibuang |
| Edit cuti | Sheet edit di `/leave` → `PATCH /leave/:id` | pengganti bisa diganti atau dilengkapi belakangan |

`/leave/detect` (source `auto`, keyword lama) **tidak** diubah: tetap tanpa pengganti.

## 2. Aturan (`apps/api/src/repo/leave-backup.ts`)

| Aturan | Hasil |
|---|---|
| **Approve** pending jenis `cuti` (dashboard maupun WA) tanpa pengganti | ditolak: "pengganti (backup PIC) wajib diisi untuk cuti", **apa pun tanggalnya** |
| Tambah/edit di `/leave`: jenis `cuti` yang **belum selesai** (`end_date ≥ hari ini WIB`) tanpa pengganti | ditolak dengan pesan yang sama |
| Tambah/edit cuti lampau tanpa pengganti | boleh, supaya data lama (sebelum F55) dan input susulan tetap bisa diedit |
| `sakit` / `ijin` | pengganti opsional di semua jalur, karena sering mendadak |
| Pengganti = orang yang cuti | ditolak |
| Pengganti tidak ada di roster / `aktif = false` | ditolak |
| Pengganti juga punya `user_leave` yang beririsan | ditolak ("… juga tidak masuk <rentang>"), karena rantai pengganti putus |

Ruang lingkup "wajib" dikonfirmasi Direktur 2026-10-09 (audit Issue #1443): **hanya
jenis cuti**; sakit/ijin tetap opsional. Pengecualian tanggal tidak berlaku saat approve,
karena requirement-nya "wajib diisi saat approve cuti" tanpa pengecualian. Jalur approve
memanggil `checkBackup({..., approval: true})` / `isBackupRequired(..., { approval: true })`.

Satu definisi (`isBackupRequired`, `checkBackup`) dipakai oleh `POST /leave`,
`PATCH /leave/:id`, approve dashboard, dan approve WA. PATCH memvalidasi keadaan
**setelah** edit: field yang tidak dikirim dianggap nilai lama, dan
`backup_am_id` yang tidak dikirim berarti tidak diubah.

**Approve WA** (`detectleave.ts handleApproval`):
- `ya L5` untuk cuti tanpa nama: bot membalas format yang benar, L5 **tetap pending**.
- `ya L5 Zzz` dengan nama tak dikenal: untuk cuti ditahan seperti di atas. Untuk sakit/ijin
  teksnya diabaikan dan cuti tercatat tanpa pengganti, persis seperti sebelum F55
  (`ya L3 makasih` tetap jalan).
- Pengganti ketemu tapi melanggar aturan di tabel: bot membalas alasannya, L5 tetap pending.
- Pesan konfirmasi deteksi kini menyebut format `ya L<id> <nama pengganti>`.
- Catatan: pending tetap kedaluwarsa setelah 24 jam seperti sebelumnya.

**Approve jadi satu transaksi**: `approvePendingLeave` (`leave.ts`) menjalankan insert
`user_leave` dan update status `leave_pending` dalam satu `sql.begin`. Fungsi ini dipakai
bersama jalur dashboard dan WA (sebelumnya query-nya disalin di dua tempat). Kalau cuti
yang beririsan sudah tercatat lebih dulu, baris itu yang dipakai, dan pengganti diisikan
ke sana bila masih kosong.

## 3. Notifikasi WA

Setelah cuti tersimpan dengan pengganti, `notifyLeaveBackup(leaveId)` mengirim:
- **Grup**: tiap JID di `LEAVE_BACKUP_NOTIFY_TARGET` (dipisah koma).
  ```
  🔁 *Backup PIC*
  *Pita* (Surabaya) cuti 2026-10-05 s/d 2026-10-07.
  Sementara urusan Pita ke *Rina* — 62811…
  ```
- **DM pengganti** ke `master_user.wa_number`, bila ada.

| Keputusan | Alasan |
|---|---|
| Grup tujuan dari **env**, kosong berarti tidak ada broadcast | CLAUDE.md: target broadcast WA ditentukan user, bukan diinferensi. Belum ada pemetaan orang/cabang → grup di sistem (`last_active_group` hanya terisi untuk pengirim #PLAN/#REPORT). Pola sama dengan F45/F38/F91 |
| Grup HRD tidak ditambah ke target | balasan "✅ Tercatat …" di grup HRD sudah memuat nama pengganti |
| Anti-dobel lewat `notif_state` key `f55:leave:<id>`, signature `pengganti\|mulai\|selesai` | edit keterangan saja tidak memicu kirim ulang. Ganti pengganti atau rentang memicu kirim ulang dengan judul "(diperbarui)". Ditandai hanya bila ada kiriman sungguhan (stub/dry-run tidak), pola F91 |
| Cuti yang sudah lewat tidak diumumkan | tidak ada gunanya |
| Dari route HTTP dikirim **di latar** (`notifyLeaveBackupInBackground`) | kirim lewat openclaw bisa makan 13–60 detik per tujuan (CLAUDE.md), jangan tahan respons dashboard. Jalur WA (di dalam scan) memakai `await` biasa |
| Tanpa cron / job baru | event-driven, sesuai card ("saat cuti disetujui") |

## 4. Kalender

`GET /report/calendar/day` sekarang juga mengembalikan `leave[]` (siapa tidak masuk di
tanggal itu, jenis, rentang, dan penggantinya), dan ditampilkan di `/calendar/[date]`.
Sengaja **tidak** di-scope per AM, sama seperti libur nasional: tujuannya justru supaya
semua tahu harus menghubungi siapa. Filter `cabang` tetap berlaku. Grid bulanan
`/calendar` belum menampilkan cuti (card: opsional), dicatat sebagai lanjutan.

## 5. Di luar scope / batasan yang diketahui

- **Hak akses tidak diubah.** Route `/leave*` memang belum mengecek permission per
  fitur di API (hanya sesi dan gate halaman `leave` di `nav.ts`). F55 tidak mengubahnya.
- **X yang cuti padahal dia pengganti orang lain** di periode yang sama: tidak diblok,
  karena sakit mendadak tidak boleh gagal dicatat. Kasus ini terlihat di detail hari kalender.
- Kalau cuti yang beririsan sudah punya pengganti **berbeda**, approve pending tidak
  menimpanya. Ganti lewat edit.
- `leave_pending` tidak diberi kolom pengganti: pengganti dipilih saat approve, bukan saat deteksi LLM.

## 6. Uji

- `leave-backup.test.ts`: 9 tes murni (aturan wajib/lampau/diri sendiri, parse nama WA, format pesan).
- Smoke test ke DB dummy lokal plus gateway WA palsu (port 18999):
  - dashboard: 8 skenario approve (5 penolakan, sukses, decide ulang 404, sakit tanpa pengganti)
  - PATCH: keterangan saja tidak mengirim ulang; kosongkan pengganti cuti ditolak;
    perpanjang rentang mengirim "(diperbarui)"; cuti lampau bisa diedit
  - POST: cuti tanpa/dengan pengganti, ijin tanpa pengganti
  - WA: `ya L5`, nama tak dikenal, pengganti bentrok, `*ya L5 @Rina QA*`, `ya L6 makasih`
  - kalender detail hari
