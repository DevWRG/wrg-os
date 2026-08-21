-- 070 — Seed cuti bersama 2026 ke master_holiday (keputusan WRG: ikut SKB).
--
-- Dipisah dari 069 (libur nasional) karena sifatnya beda: libur nasional itu
-- ketetapan negara, cuti bersama untuk SWASTA = kebijakan perusahaan. Kalau suatu
-- saat WRG memutuskan tidak ikut (mis. cuti bersama dipotong dari hak cuti tahunan
-- dan tetap masuk kerja), cukup revert migrasi ini tanpa mengganggu 069.
--
-- Sumber: SKB 3 Menteri (Menag/Menaker/MenPANRB) 19 September 2025 — 8 hari cuti
-- bersama 2026. Kedelapannya jatuh di hari kerja (Sen-Jum), jadi semuanya memang
-- mengubah hitungan hari kerja:
--   16 Feb Senin · 18 Mar Rabu · 20 Mar Jumat · 23 Mar Senin · 24 Mar Selasa ·
--   15 Mei Jumat · 28 Mei Kamis · 24 Des Kamis.
--
-- Efek yang diharapkan: rangkaian Idulfitri (20-24 Mar) sekarang benar-benar kosong —
-- reminder plan/report, hodreminder, accurate-sync tidak jalan, dan working_days di
-- weeklyreport ikut turun. Sebelum ini 3 hari kerja di rangkaian itu masih dihitung
-- hari kerja sehingga AM ditagih laporan saat kantor tutup.
--
-- Keterangan diawali "Cuti Bersama —" supaya bisa dibedakan dari libur nasional di
-- menu /holidays dan kalender (tabelnya sama, tak ada kolom jenis).
--
-- Idempoten: ON CONFLICT (tanggal) DO NOTHING.

INSERT INTO master_holiday (tanggal, keterangan) VALUES
  ('2026-02-16', 'Cuti Bersama — Tahun Baru Imlek 2577 Kongzili'),
  ('2026-03-18', 'Cuti Bersama — Hari Suci Nyepi'),
  ('2026-03-20', 'Cuti Bersama — Idulfitri 1447H'),
  ('2026-03-23', 'Cuti Bersama — Idulfitri 1447H'),
  ('2026-03-24', 'Cuti Bersama — Idulfitri 1447H'),
  ('2026-05-15', 'Cuti Bersama — Kenaikan Yesus Kristus'),
  ('2026-05-28', 'Cuti Bersama — Iduladha 1447H'),
  ('2026-12-24', 'Cuti Bersama — Kelahiran Yesus Kristus (Natal)')
ON CONFLICT (tanggal) DO NOTHING;
