-- 174 — Jejak keputusan untuk tautan MANUAL di posisi_employee.
--
-- KENAPA PERLU: sampai sekarang seluruh baris posisi_employee ditulis skrip,
-- dan `sumber` sudah cukup menjelaskan dasarnya (nama di form / nama posisi di
-- role / alias). Begitu ada UI yang membiarkan orang menetapkan tautan, itu
-- tidak cukup lagi: "Rengga → Admin Cabang" karena SESEORANG memutuskan begitu,
-- dan enam bulan lagi harus bisa ditelusuri siapa dan kapan — terutama karena
-- 12 dari 22 kasus yang tersisa muncul justru dari kapasitas form yang salah,
-- jadi keputusannya bisa jadi perlu ditinjau ulang.
--
-- HANYA BERMAKNA untuk sumber='manual'. Baris tulisan skrip meninggalkan kedua
-- kolom ini NULL, dan itu benar: yang memutuskan bukan orang, dan `catatan`
-- sudah memuat dasar mesinnya.
--
-- Diisi dari SESI LOGIN di sisi server, bukan dari input klien — kalau diambil
-- dari body request, siapa pun yang bisa memanggil endpoint-nya bisa mengaku
-- sebagai orang lain, dan jejaknya justru jadi lebih berbahaya daripada tidak
-- ada (terlihat resmi, isinya karangan).

ALTER TABLE posisi_employee ADD COLUMN IF NOT EXISTS diputuskan_oleh  text;
ALTER TABLE posisi_employee ADD COLUMN IF NOT EXISTS diputuskan_pada  timestamptz;

COMMENT ON COLUMN posisi_employee.diputuskan_oleh IS
  'Email/id app_user yang menetapkan tautan ini lewat UI. NULL untuk baris tulisan skrip (sumber != manual). Diambil dari sesi login sisi server, JANGAN dari body request.';
COMMENT ON COLUMN posisi_employee.diputuskan_pada IS
  'Kapan keputusan manual dibuat. NULL untuk baris tulisan skrip.';
