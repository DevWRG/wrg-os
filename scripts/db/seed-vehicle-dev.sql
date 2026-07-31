-- Seed DEV-ONLY untuk F50 (Kendaraan Operasional Log) — 7 mobil dummy buat
-- testing lokal. JANGAN dipakai di produksi — data 7 mobil ASLI (plat nomor,
-- sopir, dsb) perlu diinput manual oleh Direktur/Fafa via SQL serupa sebelum
-- fitur ini dipakai sungguhan (lihat 080_vehicle_operational_log.sql).
-- Idempoten (ON CONFLICT DO NOTHING berdasar plate_number UNIQUE).

INSERT INTO vehicle (plate_number, model, sopir_name, current_km, stnk_expiry, service_interval_km, last_service_km, last_service_date)
VALUES
  ('L 1234 AB', 'Toyota Avanza', 'Budi', 45000, CURRENT_DATE + INTERVAL '90 days', 5000, 40000, CURRENT_DATE - INTERVAL '60 days'),
  ('L 1235 AB', 'Toyota Avanza', 'Joko', 52000, CURRENT_DATE + INTERVAL '20 days', 5000, 47000, CURRENT_DATE - INTERVAL '90 days'),
  ('L 1236 AC', 'Daihatsu Gran Max', 'Slamet', 88000, CURRENT_DATE + INTERVAL '10 days', 8000, 80500, CURRENT_DATE - INTERVAL '30 days'),
  ('L 1237 AC', 'Daihatsu Gran Max', 'Yanto', 61000, CURRENT_DATE + INTERVAL '200 days', 8000, 56000, CURRENT_DATE - INTERVAL '45 days'),
  ('L 1238 AD', 'Mitsubishi L300', NULL, 120000, CURRENT_DATE - INTERVAL '5 days', 10000, 110000, CURRENT_DATE - INTERVAL '20 days'),
  ('L 1239 AD', 'Toyota Hiace', 'Rudi', 33000, CURRENT_DATE + INTERVAL '150 days', 5000, 28000, CURRENT_DATE - INTERVAL '15 days'),
  ('L 1240 AE', 'Honda Beat', 'Fajar', 15000, CURRENT_DATE + INTERVAL '300 days', 3000, 12000, CURRENT_DATE - INTERVAL '10 days')
ON CONFLICT (plate_number) DO NOTHING;
