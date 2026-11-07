-- 246 — Roster teknisi Aftersales SATU sumber dengan F154 (keputusan user 25 Okt 2026).
--
-- MASALAH: modul Aftersales (F8/F22/F24/F26, migrasi 130–207, masih dev-only)
-- punya roster sendiri `teknisi_capacity` — nama/WA/wilayah diketik bebas di
-- Readiness Board. F154 Jadwal Teknisi (235, SUDAH live) memakai master_user
-- role Teknisi + `teknisi_wilayah`. Dipromosikan apa adanya, prod punya dua
-- daftar teknisi dan dua pemetaan wilayah yang bisa saling menyimpang.
--
-- SEKARANG:
--   * identitas  = master_user (role Teknisi). teknisi_capacity.am_id menautkan;
--                  nama/wa_number/aktif DISALIN dari master_user oleh trigger,
--                  tak lagi diedit di Readiness Board.
--   * wilayah    = teknisi_wilayah (F154) — dibaca lewat am_id. Kolom
--                  teknisi_capacity.wilayah (175) TIDAK dipakai lagi.
--   * kapasitas  = teknisi_capacity.max_concurrent_jobs — satu-satunya yang
--                  masih milik tabel ini.
-- PK uuid sengaja dipertahankan: 5 tabel (install_schedule, installation_unit,
-- maintenance_schedule, service_ticket, teknisi_report) FK ke sana.
--
-- Baris tanpa am_id (dummy Hesti/Fajar/Gilang di dev, isian manual lama)
-- dinonaktifkan — histori FK tetap utuh. Pengecualian: baris bypass grup uji
-- ber-nama '[UJI] ...' (lihat wa-test-bypass.ts) dibiarkan.
--
-- Idempoten. Tanpa BEGIN/COMMIT sendiri — runner yang mengatur transaksi.

ALTER TABLE teknisi_capacity
  ADD COLUMN IF NOT EXISTS am_id varchar(50) UNIQUE
    REFERENCES master_user (am_id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION teknisi_capacity_sync() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- 1. Adopsi baris lama yang namanya PERSIS sama (dinormalisasi) dengan teknisi
  --    master_user — supaya histori FK-nya ikut, bukan lahir baris kembar.
  UPDATE teknisi_capacity tc SET am_id = mu.am_id
  FROM master_user mu
  WHERE tc.am_id IS NULL
    AND upper(mu.role) = 'TEKNISI'
    AND lower(regexp_replace(btrim(tc.nama), '[[:space:]]+', ' ', 'g'))
      = lower(regexp_replace(btrim(mu.nama), '[[:space:]]+', ' ', 'g'))
    AND NOT EXISTS (SELECT 1 FROM teknisi_capacity x WHERE x.am_id = mu.am_id);

  -- 2. Teknisi master_user yang belum punya baris → buat (kapasitas default 3).
  --    Nama kembar dengan baris lain → dilewati, bukan gagal seluruh transaksi.
  INSERT INTO teknisi_capacity (am_id, nama, wa_number, aktif)
  SELECT mu.am_id, mu.nama, mu.wa_number, mu.aktif
  FROM master_user mu
  WHERE upper(mu.role) = 'TEKNISI'
    AND NOT EXISTS (SELECT 1 FROM teknisi_capacity x WHERE x.am_id = mu.am_id)
  ON CONFLICT DO NOTHING;

  -- 3. Salin identitas terkini. Orang yang keluar/ganti role → nonaktif
  --    (barisnya tetap, demi histori).
  UPDATE teknisi_capacity tc
  SET nama = mu.nama,
      wa_number = mu.wa_number,
      aktif = (mu.aktif AND upper(mu.role) = 'TEKNISI'),
      updated_at = now()
  FROM master_user mu
  WHERE mu.am_id = tc.am_id
    AND (tc.nama IS DISTINCT FROM mu.nama
      OR tc.wa_number IS DISTINCT FROM mu.wa_number
      OR tc.aktif IS DISTINCT FROM (mu.aktif AND upper(mu.role) = 'TEKNISI'));

  -- 4. Baris di luar master_user → nonaktif (kecuali penanda grup uji).
  UPDATE teknisi_capacity SET aktif = false, updated_at = now()
  WHERE am_id IS NULL AND aktif AND nama NOT LIKE '[UJI] %';
END $$;

CREATE OR REPLACE FUNCTION teknisi_capacity_sync_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM teknisi_capacity_sync();
  RETURN NULL;
END $$;

-- Per STATEMENT + daftar kolom: last_active_at/last_active_group di-UPDATE tiap
-- pesan WA masuk — jangan memicu sinkron untuk itu.
DROP TRIGGER IF EXISTS master_user_teknisi_capacity_sync ON master_user;
CREATE TRIGGER master_user_teknisi_capacity_sync
  AFTER INSERT OR DELETE OR UPDATE OF am_id, nama, wa_number, role, aktif ON master_user
  FOR EACH STATEMENT EXECUTE FUNCTION teknisi_capacity_sync_trg();

SELECT teknisi_capacity_sync();

COMMENT ON COLUMN teknisi_capacity.am_id IS
  '246 — tautan ke master_user (role Teknisi). nama/wa_number/aktif disalin trigger dari sana; NULL = baris lama di luar master_user (nonaktif) atau bypass [UJI].';
COMMENT ON COLUMN teknisi_capacity.wilayah IS
  'TIDAK DIPAKAI sejak 246 — wilayah dibaca dari teknisi_wilayah (F154) lewat am_id.';
COMMENT ON TABLE teknisi_capacity IS
  'F8 — kapasitas kerja teknisi. Identitas dari master_user (246), wilayah dari teknisi_wilayah (F154).';
