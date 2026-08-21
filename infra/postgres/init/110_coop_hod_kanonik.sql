-- 110: seragamkan `deal.coop_model` (KSO/BELI) dan `deal.pic_hod` (Rocky/Yogi).
--
-- Dua kolom ini bernasib sama seperti brand di 108/109 — nilainya bebas, jadi
-- dropdown filter di /pipeline (yang isinya nilai unik apa adanya) penuh kembaran:
--
--   coop_model : 'KSO' 480 · 'SALE'/'Sale' 276 · 'BELI' 9  → user minta 2 saja.
--   pic_hod    : 13 variasi untuk 2 orang — 'Rocky'/'ROCKY'/'Roki'/'Roki ' (561)
--                dan 'Yogi'/'YOGI '/'yogi'/'HOD YOGI '/'Pak yogi'/'Pak Yogi '/
--                'Pak yofi' (100). Entri yang tampak dobel di dropdown sebetulnya
--                beda SPASI DI UJUNG. 103 baris kosong → dibiarkan NULL.
--
-- Sumber bocornya ikut ditutup di form (lihat deal-form-modal.tsx): pilihan
-- 'Sale' diganti 'BELI', dan PIC HOD dari input teks bebas jadi combo bersaran.
--
-- Daftar varian di sini EKSPLISIT, bukan tebakan pola: 'Roki' → Rocky ditulis
-- karena memang ada di data, bukan karena cocok regex. Nilai di luar daftar
-- dibiarkan utuh — HoD baru tak boleh hilang gara-gara belum terdaftar.
--
-- Idempoten. TIDAK memanggil BEGIN/COMMIT sendiri — runner (migrate.sh) yang atur.

-- ── 1) Fungsi normalisasi ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION norm_coop(t TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(regexp_replace(COALESCE(t, ''), '[^a-zA-Z0-9]', '', 'g'))
    WHEN 'KSO' THEN 'KSO'
    WHEN 'SALE' THEN 'BELI'
    WHEN 'BELI' THEN 'BELI'
    WHEN 'BELIPUTUS' THEN 'BELI'
    WHEN '' THEN NULL
    ELSE btrim(t)
  END;
$$;

CREATE OR REPLACE FUNCTION norm_hod(t TEXT) RETURNS TEXT
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(regexp_replace(COALESCE(t, ''), '[^a-zA-Z0-9]', '', 'g'))
    WHEN 'ROCKY' THEN 'Rocky'
    WHEN 'ROKI' THEN 'Rocky'
    WHEN 'PAKROCKY' THEN 'Rocky'
    WHEN 'PAKROKI' THEN 'Rocky'
    WHEN 'HODROCKY' THEN 'Rocky'
    WHEN 'YOGI' THEN 'Yogi'
    WHEN 'YOFI' THEN 'Yogi'
    WHEN 'PAKYOGI' THEN 'Yogi'
    WHEN 'PAKYOFI' THEN 'Yogi'
    WHEN 'HODYOGI' THEN 'Yogi'
    WHEN '' THEN NULL
    ELSE btrim(t)
  END;
$$;

-- ── 2) Terapkan ke data lama ────────────────────────────────────────────────
UPDATE deal SET coop_model = norm_coop(coop_model)
 WHERE norm_coop(coop_model) IS DISTINCT FROM coop_model;

UPDATE deal SET pic_hod = norm_hod(pic_hod)
 WHERE norm_hod(pic_hod) IS DISTINCT FROM pic_hod;

-- ── 3) Jaga ke depan ────────────────────────────────────────────────────────
-- Digabung ke trigger brand yg sudah ada (108) supaya `deal` cukup punya SATU
-- trigger normalisasi, bukan tiga yang urutannya harus dipikirkan.
CREATE OR REPLACE FUNCTION deal_brand_norm() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.brand      := norm_brand(NEW.brand);
  NEW.coop_model := norm_coop(NEW.coop_model);
  NEW.pic_hod    := norm_hod(NEW.pic_hod);
  RETURN NEW;
END;
$$;

-- Trigger 108 hanya memantau kolom brand → perluas ke dua kolom baru.
DROP TRIGGER IF EXISTS deal_brand_norm_trg ON deal;
CREATE TRIGGER deal_brand_norm_trg
  BEFORE INSERT OR UPDATE OF brand, coop_model, pic_hod ON deal
  FOR EACH ROW EXECUTE FUNCTION deal_brand_norm();
