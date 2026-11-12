-- 309 — Konversi satuan HPP: kemasan Setup Harga → satuan faktur Accurate.
--
-- Masalah (temuan F150 & F67, 7 Nov 2026): HPP di `product_pricelist_setup.hpp` (073)
-- dicatat PER KEMASAN price book (box/kit/botol), sedangkan qty faktur Accurate dalam
-- satuan item Accurate itu sendiri (sering PCS/TEST). Rumus `net − hpp × qty` tanpa
-- konversi → laba kotor minus berlipat-lipat. Konversi TIDAK bisa diambil otomatis dari
-- Accurate: semua baris faktur unitRatio = 1 dan item hampir tak pernah membawa unit2.
-- Jadi konversinya diisi manusia (Finance / HoD Business / Purchasing) di aplikasi —
-- Setup Harga › "Konversi satuan HPP".
--
-- 1. Tabel `hpp_konversi_satuan` — satu baris per item Accurate:
--      isi_per_kemasan  berapa satuan Accurate dalam SATU kemasan HPP price book
--                       → HPP per satuan Accurate = hpp / isi_per_kemasan
--      hpp_per_satuan   HPP langsung per satuan Accurate (override); MENANG atas isi.
--                       Juga menuntaskan kode ambigu (beberapa HPP berbeda per item).
--    Minimal salah satu terisi. Jejak: diubah_oleh / diubah_at (diisi API dari sesi).
--
-- 2. Fungsi `hpp_item_satuan(periode)` — SATU-SATUNYA sumber "HPP per satuan Accurate per
--    item untuk satu periode price book". Dulu CTE `hpp_item` disalin di tiga tempat
--    (biaya-area.ts F150, insentif.ts F67, product-scorecard.ts F6); kini ketiganya membaca
--    fungsi ini. Fungsi (bukan view) karena periode HPP adalah parameter (insentif memakai
--    `periodeHpp` per perhitungan). Aturan ambigu tetap: n_hpp = jumlah HPP berbeda pada
--    kode Setup Harga item itu, konsumen hanya memakai n_hpp = 1; override hpp_per_satuan
--    memaksa n_hpp = 1. isi_per_kemasan TIDAK menuntaskan ambigu (min(hpp)/isi tetap tebakan).
--    Kolom `sumber`: 'kemasan' (belum dikonversi) | 'konversi' (hpp/isi) | 'override'.
--
-- Hasil insentif yang sudah tersimpan TIDAK dihitung ulang oleh migrasi ini; periode DRAFT
-- baru berubah saat seseorang menjalankan hitung ulang.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS hpp_konversi_satuan (
  accurate_item_id bigint PRIMARY KEY REFERENCES accurate_item (id) ON DELETE CASCADE,
  isi_per_kemasan  numeric CHECK (isi_per_kemasan IS NULL OR isi_per_kemasan > 0),
  hpp_per_satuan   numeric CHECK (hpp_per_satuan IS NULL OR hpp_per_satuan >= 0),
  catatan          text,
  diubah_oleh      text,
  diubah_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hpp_konversi_satuan_isi_ck CHECK (isi_per_kemasan IS NOT NULL OR hpp_per_satuan IS NOT NULL)
);
COMMENT ON TABLE hpp_konversi_satuan IS
  '309: konversi HPP kemasan Setup Harga → satuan faktur Accurate per item. Diisi manual di Setup Harga › Konversi satuan HPP. Dibaca lewat hpp_item_satuan(periode).';
COMMENT ON COLUMN hpp_konversi_satuan.isi_per_kemasan IS
  'Jumlah satuan Accurate dalam satu kemasan HPP price book. HPP per satuan = hpp / isi.';
COMMENT ON COLUMN hpp_konversi_satuan.hpp_per_satuan IS
  'Override HPP per satuan Accurate; menang atas isi_per_kemasan dan menuntaskan HPP ambigu.';

CREATE OR REPLACE FUNCTION hpp_item_satuan(p_periode text)
RETURNS TABLE (item_id bigint, hpp numeric, n_hpp int, kode text, hpp_kemasan numeric, sumber text)
LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT pc.accurate_item_id AS item_id, min(pps.hpp) AS hpp,
           count(DISTINCT pps.hpp)::int AS n_hpp, min(pc.kode) AS kode
    FROM product_code pc
    JOIN product_pricelist_setup pps ON pps.product_kode = pc.kode AND pps.periode = p_periode
    WHERE pc.accurate_item_id IS NOT NULL AND pps.hpp IS NOT NULL
    GROUP BY pc.accurate_item_id
  )
  SELECT COALESCE(b.item_id, k.accurate_item_id) AS item_id,
         CASE WHEN k.hpp_per_satuan IS NOT NULL THEN k.hpp_per_satuan
              WHEN k.isi_per_kemasan IS NOT NULL THEN b.hpp / k.isi_per_kemasan
              ELSE b.hpp END AS hpp,
         CASE WHEN k.hpp_per_satuan IS NOT NULL THEN 1 ELSE b.n_hpp END AS n_hpp,
         b.kode,
         b.hpp AS hpp_kemasan,
         CASE WHEN k.hpp_per_satuan IS NOT NULL THEN 'override'
              WHEN k.isi_per_kemasan IS NOT NULL THEN 'konversi'
              ELSE 'kemasan' END AS sumber
  FROM base b
  FULL JOIN hpp_konversi_satuan k ON k.accurate_item_id = b.item_id
  -- Konversi isi tanpa HPP price book = tak ada yang dikonversi → buang.
  WHERE b.item_id IS NOT NULL OR k.hpp_per_satuan IS NOT NULL
$$;
COMMENT ON FUNCTION hpp_item_satuan(text) IS
  '309: HPP per satuan Accurate per item untuk satu periode price book (sumber tunggal F150/F67/F6). Pakai hanya n_hpp = 1.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hpp_konversi_satuan TO wrg_app;
    GRANT EXECUTE ON FUNCTION hpp_item_satuan(text) TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON hpp_konversi_satuan TO wrg_readonly;
    GRANT EXECUTE ON FUNCTION hpp_item_satuan(text) TO wrg_readonly;
  END IF;
END $$;
