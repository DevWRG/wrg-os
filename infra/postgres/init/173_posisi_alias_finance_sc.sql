-- 173 — 4 alias jabatan tambahan untuk divisi Finance & Supply Chain,
-- dikonfirmasi user 2026-09-07. Menutup 5 karyawan yang sebelumnya tak
-- tertaut (26 → 31 dari 53).
--
-- Semua DIBATASI `dept` — tanpa itu alias sependek 'ar' akan menyapu siapa pun
-- yang kebetulan menyebutnya. Pelajarannya sudah dibayar sekali di migrasi 171:
-- alias 'fakturis' tanpa pembatas ikut kena role "atasan Fakturis", pengklaim
-- jadi 3 untuk kapasitas 2, dan syarat kapasitas lalu menolak KETIGANYA —
-- sehingga 2 Fakturis asli pun ikut hangus.
--
-- ── YANG SENGAJA TIDAK ADA DI SINI: 'petty cash' ───────────────────────────
-- Renika ('Finance — Petty Cash') seharusnya menempati Staff Petty Cash &
-- Funding, dan sekilas itu satu INSERT. TIDAK BISA, dan bukan karena pembatas
-- yang kurang: himpunan kata role Siti Nurkolis
--   {finance, pengelola, piutang, atasan, fakturis, petty, cash}
-- adalah SUPERSET dari milik Renika
--   {finance, petty, cash}
-- Uji containment bersifat himpunan, jadi alias APA PUN yang cocok ke Renika
-- otomatis cocok ke Siti. Kapasitas posisi itu 1 → dua pengklaim → keduanya
-- ditolak, dan Renika tetap tak tertaut. Menaikkan kapasitas jadi 2 justru
-- salah: Siti atasan mereka, bukan pemegang posisi itu.
--
-- Dua jalan keluar yang sah, dua-duanya di luar file ini:
--   1. sheet 'Daftar Posisi' Finance & SC menambahkan baris SPV (SPV Finance
--      sekarang hanya muncul sebagai NILAI kolom PJ, tak punya baris posisi) →
--      Siti punya rumah sendiri dan bentrokannya lenyap; atau
--   2. tautan manual: INSERT ke posisi_employee dengan sumber='manual'.
-- Jangan mencoba mengakalinya dengan alias yang lebih panjang — secara
-- matematis tak ada alias yang memisahkan subset dari supersetnya.

INSERT INTO posisi_alias (divisi_key, posisi_nama, alias, dept, catatan) VALUES
  -- Navisa ('Finance — Piutang / AR') + Ayu ('Admin Finance — Credit Note (CN)
  -- & bantu AR') = 2 orang, kapasitas Staff AR & CN juga 2 → pas.
  -- Role Renika & Siti tidak memuat token 'ar', jadi tak ikut terklaim.
  ('finance_sc', 'Staff AR & CN', 'ar', 'finance',
   'Dikonfirmasi user 2026-09-07. Navisa (Piutang/AR) + Ayu (CN & bantu AR) = 2 = kapasitas. dept WAJIB: alias 2 huruf ini akan menyapu lintas divisi tanpa pembatas.'),

  ('finance_sc', 'Staff Shipping', 'shipping', 'supplychain',
   'Dikonfirmasi user 2026-09-07. Diana (Admin Shipping / Pengiriman); satu-satunya di dept supplychain yang memuatnya, kapasitas 1.'),

  -- Yugi ('Admin Gudang / PJ Barang') + Denys ('Staf Gudang / Inventory') = 2,
  -- kapasitas Staff Inventory juga 2. Denys sudah tertaut lewat containment
  -- ('staff inventory' ⊆ rolenya); alias ini menambah Yugi tanpa menggeser dia.
  ('finance_sc', 'Staff Inventory', 'gudang', 'supplychain',
   'Dikonfirmasi user 2026-09-07. Yugi (Admin Gudang) + Denys (Staf Gudang/Inventory) = 2 = kapasitas; Denys sudah tertaut via containment.'),

  ('finance_sc', 'Staff Distribution', 'distribusi', 'supplychain',
   'Dikonfirmasi user 2026-09-07. Isteffany (Admin Distribusi merangkap Admin Purchasing) → Distribution; Purchasing kapasitasnya 1 dan sudah dipegang Claudya.')
ON CONFLICT (divisi_key, posisi_nama, alias) DO UPDATE SET
  dept = EXCLUDED.dept, catatan = EXCLUDED.catatan;
