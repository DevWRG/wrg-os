# #OVERTIME — Pengajuan Lembur via WA

Migrasi `190_overtime_request.sql`. Kartu HRIS (#PRESENCE/#OVERTIME/#SLIP) dipersempit oleh Direktur
2026-09-30: **#PRESENCE dicoret** (sudah ada absensi digital), **#SLIP dicoret** (datanya hanya
terjangkau direksi/owner), **#OVERTIME jalan**.

## Alur

1. Karyawan yang berhak kirim di grup WA: `#overtime 2 jam 30 menit - closing laporan bulanan`
   (durasi wajib di depan; `90 menit`, `1,5 jam`, `2jam` juga terbaca; maks 12 jam).
2. Bot mengenali pengirim (`resolveSender` → `master_user`), mengambil divisi/HoD dari
   `employee.am_id`, cek aturan `overtime_rule`, lalu mencatat pengajuan `OT-0001` (status `pending`,
   tanggal lembur = hari pesan WIB — pengajuan dibuat SEBELUM lembur).
3. Bot DM HoD divisi (resolve LIVE `app_user.hod_key` + `wa_number`): "Balas `#APPROVE OT-0001` /
   `#REJECT OT-0001 <alasan>`".
4. HoD memutus lewat balasan WA (DM) atau tombol di `/overtime`. Hasil dibalas ke grup asal.
5. HR memakai rekap `/overtime` (filter status/tanggal, export CSV).

## Keputusan desain

- **Satu tahap, HoD divisi pengaju.** Sengaja BUKAN engine approval F11 (chain global 5 tahap, masih
  tersangkut #1071). Tabel & status sendiri (pola `leave_pending`). `#APPROVE`/`#REJECT` dipakai
  bersama: kode `OT-xxxx` dirutekan ke `decideOvertime`, `APR-xxxx` tetap ke engine F11.
- **Siapa boleh mengajukan = tabel aturan dinamis** `overtime_rule` (divisi `employee.dept` +/atau pola
  posisi + pengecualian per orang), diedit admin di tab "Aturan pengaju". Tanpa aturan aktif, tak ada
  yang bisa mengajukan.
- **HoD tak ketemu → pengajuan TETAP dicatat**, menunggu admin menetapkan HoD di `/overtime`
  ("Tetapkan & kirim"). Alasan kegagalan notifikasi tersimpan di `notify_status`.
- Otorisasi memutus ada di satu fungsi (`decideOvertime`): HoD dengan `hod_key` sama, atau
  admin/direktur. Jalur WA dan dashboard tak bisa menyimpang.
- Menu `/overtime` = fitur RBAC `overtime`, **default tertutup** — admin perlu Sync Fitur lalu
  mencentangnya untuk grup HR. Tab Aturan & "Tetapkan HoD" khusus admin/superuser.

## Batas yang diketahui

- Uji coba hanya di grup Research (`WA_INBOUND_GROUPS`); grup produksi ditentukan Direktur.
- Di grup WA `sender_jid` = `group_jid`, jadi pengenalan pengaju lewat nama/alias/pushname (bukan nomor).
  Balasan `#APPROVE` HoD hanya valid dari **DM** (di situ nomor terbaca).
- `employee.hod_key` bisa NULL bila atasan ambigu, dan akun HoD butuh `app_user.hod_key` + `wa_number`
  terisi — kalau tidak, pengajuan menunggu admin.
- Belum ada: laporan realisasi jam (hanya estimasi), pengajuan untuk tanggal selain hari ini.
