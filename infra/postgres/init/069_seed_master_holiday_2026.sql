-- 069 — Seed libur nasional 2026 ke master_holiday.
--
-- master_holiday dibuat di 011 tapi TIDAK pernah di-seed, jadi tabelnya kosong.
-- Akibatnya semua gate "hari kerja" menganggap tiap hari Senin-Jumat = hari kerja:
--   - scheduler.ts isWorkday()  → reminder & job tetap jalan di hari libur
--   - accurate-sync             → tetap pull di hari libur
--   - hodreminder / plandash    → hari kerja & KPI kepatuhan over-count
--   - weeklyreport              → working_days selalu 5
--
-- Sumber: SKB 3 Menteri (Menag/Menaker/MenPANRB), ditandatangani 19 September 2025 —
-- 17 hari libur nasional 2026. CATATAN: seed legacy
-- (legacy/crm/schema/master_data_seed.sql:273 & schema_update_v2.sql:63) TIDAK dipakai
-- karena isinya tanggal 2025 yang dilabeli 2026 (Imlek 29 Jan, Iduladha 6 Jun,
-- Isra Mikraj 27 Jan = tanggal 2025) — kalau diseed, sistem skip hari yang salah.
--
-- Libur yang jatuh di Sabtu/Minggu tetap dimasukkan (21-22 Mar, 5 Apr, 31 Mei):
-- konsumen sudah filter akhir pekan sendiri (weeklyreport pakai dow BETWEEN 1 AND 5,
-- plandash & hodreminder pakai filter dow), jadi tak ada double-count.
--
-- CUTI BERSAMA 2026 (8 hari) SENGAJA TIDAK DISEED — untuk swasta itu kebijakan
-- perusahaan, bukan kewajiban. Kalau WRG ikut, tambahkan lewat menu /holidays atau
-- migrasi baru: 16 Feb (Imlek), 18 Mar (Nyepi), 20 Mar + 23 Mar + 24 Mar (Idulfitri),
-- 15 Mei (Kenaikan Yesus), 28 Mei (Iduladha), 24 Des (Natal).
--
-- Idempoten: ON CONFLICT (tanggal) DO NOTHING — aman di-rerun, dan tidak menimpa
-- entri yang sudah diinput manual lewat /holidays.

INSERT INTO master_holiday (tanggal, keterangan) VALUES
  ('2026-01-01', 'Tahun Baru 2026 Masehi'),
  ('2026-01-16', 'Isra Mikraj Nabi Muhammad SAW'),
  ('2026-02-17', 'Tahun Baru Imlek 2577 Kongzili'),
  ('2026-03-19', 'Hari Suci Nyepi (Tahun Baru Saka 1948)'),
  ('2026-03-21', 'Idulfitri 1447H Hari 1'),
  ('2026-03-22', 'Idulfitri 1447H Hari 2'),
  ('2026-04-03', 'Wafat Yesus Kristus'),
  ('2026-04-05', 'Kebangkitan Yesus Kristus (Paskah)'),
  ('2026-05-01', 'Hari Buruh Internasional'),
  ('2026-05-14', 'Kenaikan Yesus Kristus'),
  ('2026-05-27', 'Iduladha 1447H'),
  ('2026-05-31', 'Hari Raya Waisak 2570 BE'),
  ('2026-06-01', 'Hari Lahir Pancasila'),
  ('2026-06-16', '1 Muharam Tahun Baru Islam 1448H'),
  ('2026-08-17', 'Proklamasi Kemerdekaan RI'),
  ('2026-08-25', 'Maulid Nabi Muhammad SAW'),
  ('2026-12-25', 'Kelahiran Yesus Kristus (Natal)')
ON CONFLICT (tanggal) DO NOTHING;
