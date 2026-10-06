-- 193 — Riwayat cabang AM bertanggal (mutasi sales tak menggeser revenue area).
--
-- MASALAH. Area sebuah faktur diturunkan dari master_user.cabang milik AM-nya
-- (joinAmFromSalesman → mu.cabang). Kolom itu cuma menyimpan cabang SEKARANG,
-- jadi begitu AM dimutasi, SELURUH revenue historisnya ikut pindah area.
-- Kasus pemicu: Ari (am_id 11) mutasi BALI → JAKARTA per 10 Agu 2026 — tab Per
-- Cabang 2026 kehilangan BALI sama sekali dan JAKARTA menelan ±Rp124 jt
-- revenue Bali (region East/Rocky → West/Yogi).
--
-- ATURAN (keputusan user 5 Okt 2026):
--   * Revenue per AREA tidak terpengaruh mutasi — faktur ikut cabang AM pada
--     TANGGAL FAKTUR.
--   * Revenue per SALES tetap melekat ke orangnya; status cabang barunya baru
--     berlaku sejak tanggal mutasi.
--
-- SEMANTIK TABEL. Satu baris = "mulai tanggal X, AM ini di cabang Y". Cabang
-- efektif untuk tanggal T = baris dengan berlaku_mulai <= T paling akhir. Bila
-- tak ada baris yang berlaku (AM tanpa riwayat mutasi), fallback ke
-- master_user.cabang — jadi AM yang tak pernah mutasi tak perlu baris apa pun.
-- Saat mencatat mutasi: tambah DUA baris kalau belum ada riwayat — cabang lama
-- (berlaku_mulai jauh di masa lalu) + cabang baru (tanggal mutasi) — lalu
-- update master_user.cabang ke cabang baru.

CREATE TABLE IF NOT EXISTS am_cabang_riwayat (
  am_id          varchar     NOT NULL,
  cabang         text        NOT NULL,
  berlaku_mulai  date        NOT NULL,
  catatan        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (am_id, berlaku_mulai)
);

-- Ari Kurnia Yuda: BALI sampai 9 Agu 2026, JAKARTA mulai 10 Agu 2026.
-- Disemai hanya bila am_id 11 memang Ari (lingkungan dev/seed bisa beda isi).
INSERT INTO am_cabang_riwayat (am_id, cabang, berlaku_mulai, catatan)
SELECT v.am_id, v.cabang, v.berlaku_mulai, v.catatan
FROM (VALUES
  ('11', 'BALI',    DATE '2000-01-01', 'cabang sebelum mutasi'),
  ('11', 'JAKARTA', DATE '2026-08-10', 'mutasi BALI → JAKARTA')
) AS v(am_id, cabang, berlaku_mulai, catatan)
WHERE EXISTS (SELECT 1 FROM master_user WHERE am_id = '11' AND panggilan = 'Ari')
ON CONFLICT (am_id, berlaku_mulai) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON am_cabang_riwayat TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON am_cabang_riwayat TO wrg_readonly;
  END IF;
END $$;
