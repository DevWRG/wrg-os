-- 181 — Bersihkan role login yang tak dipakai: 'viewer' → 'user'.
--
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.
--
-- Nomornya 181, bukan 180, karena 180 sudah dipakai 180_cashin_selisih.sql yang
-- hanya ada di main (F-CASHIN di-port langsung ke sana). Selama keduanya di
-- branch berbeda, check-migration-numbers.mjs tak melihat tabrakannya — baru
-- gagal saat PR promosi dev → main menyatukan kedua pohon.
--
-- Duduk perkaranya: app_user.role adalah sisa era pra-RBAC (sebelum 044). Sejak
-- matriks Akses Grup ada, izin per-menu (Aktif/Buat/Ubah/Hapus/Lihat) sepenuhnya
-- datang dari access_permission lewat keanggotaan app_user_group. Yang masih
-- dibaca kode dari kolom role tinggal dua nilai:
--
--   admin    → bypass seluruh matriks (perms.ts can()/canOrLegacy, requireAdmin)
--   direktur → gate Executive, Insentif, NPK, approval Fund Request & PO,
--              edit target WatchPoint, Purchase Forecast, Pricebook
--
-- 'user' bertahan sebagai nilai netral (default createUser). 'viewer' TIDAK
-- pernah dicek di mana pun — tak ada satu baris kode pun membandingkannya —
-- padahal namanya menjanjikan read-only. Itu jebakan aktif: admin menyetel
-- seseorang jadi 'viewer' dan mengira sudah membatasi, padahal orang itu tetap
-- bisa Buat/Ubah/Hapus sesuai grupnya.
--
-- AKSES TIDAK BERUBAH oleh migrasi ini. Yang menentukan akses adalah baris di
-- app_user_group, dan tabel itu TIDAK disentuh di sini: bekas pemegang 'viewer'
-- tetap anggota grup Viewer (view-only) hasil backfill 044 baris 118-127. Yang
-- hilang cuma label yang menyesatkan di kolom role.
--
-- Kenapa harus diubah datanya, bukan cuma daftar di UI: begitu 'viewer' dicabut
-- dari daftar opsi sementara barisnya masih 'viewer', <select value="viewer">
-- tak punya <option> yang cocok → dropdown terlihat kosong dan sekali tersentuh
-- nilainya ketimpa diam-diam. UI tetap memasang pengaman (nilai tak dikenal ikut
-- ditampilkan) supaya urutan deploy web vs migrasi tak jadi soal.

UPDATE app_user
   SET role = 'user'
 WHERE lower(trim(role)) = 'viewer';

-- Rapikan sekalian ejaan role yang menyimpang (spasi/huruf besar). Ini bukan
-- kosmetik: perms.ts membandingkan `role === "admin"` PERSIS tanpa trim/lowercase
-- sedangkan berkas *-access.ts memakai norm() yang melakukan keduanya. Satu baris
-- ' Admin' membuat orang lolos gate Insentif tapi gagal di can() — akses berbeda
-- antar menu untuk orang yang sama, tanpa pesan error apa pun.
UPDATE app_user
   SET role = lower(trim(role))
 WHERE role <> lower(trim(role));

-- SENGAJA TANPA CHECK CONSTRAINT. Godaannya besar (kunci kolom ke tiga nilai di
-- lapisan DB), tapi CHECK — termasuk yang NOT VALID — ikut menolak UPDATE kolom
-- LAIN pada baris yang role-nya nilai tak terduga. Kalau di prod tersisa satu
-- baris ber-role di luar dugaan, admin jadi tak bisa menonaktifkan akun itu atau
-- mengganti nomor WA-nya, dan pesan gagalnya menunjuk role — jauh dari yang
-- sedang dikerjakan. Penegakannya ditaruh di aplikasi (normalizeLoginRole,
-- apps/api/src/index.ts → 400) yang menolak di titik masuk dengan pesan jelas.
--
-- Pemeriksaan setelah migrasi jalan (harus hanya admin/direktur/user):
--   SELECT role, count(*) FROM app_user GROUP BY role ORDER BY 2 DESC;
