-- 101 — kategori ECAT & PL ikut skema BELI_REAGEN.
--
-- Ditetapkan user 2026-08-18 setelah diperiksa BERDASARKAN PRODUK dan hanya pada
-- customer yang benar-benar ada di sheet KSO (192 account_id terpetakan) — bukan dari
-- nama kategorinya.
--
-- ECAT — lolos bersih. 35 baris ke 10 faskes KSO, Rp 194,1 jt:
--     reagen/consumable  Rp 193.968.998  (99,9%)  WONDFO CTNI, I-SMART CARTRIDGE
--                                                 ELECTROLYTE, DIESSE TEST DEVICE,
--                                                 GLUCO DR STRIP, kontrol & kalibrator
--     ongkos kirim       Rp     171.172  ( 0,1%)  NON_INVENTORY
--
-- PL — mayoritas reagen, TAPI memuat alat. 17 baris ke 5 faskes KSO, Rp 131,3 jt:
--     reagen/consumable  Rp  77.275.964  (58,9%)  ZYBIO DIATERGE/PROBE DIATERGEN,
--                                                 ZYBIO UREA, kalibrator & QC, TECLOT,
--                                                 TCOAG
--     alat               Rp  54.010.135  (41,1%)  TE-SONIC BLOOD BAG TUBE SEALER 43,9jt
--                                                 ABN DM 500 SPHYGMOMANOMETER   10,1jt
--
-- KENAPA ALAT TIDAK DISARING: tidak ada klasifikasi produk di sisi Accurate yang bisa
-- dipakai. `accurate_item.category` hanya berisi INVENTORY/NON_INVENTORY (tipe item),
-- dan `detailItem[].item` tidak membawa nama kategori — dicek, kosong untuk seluruh
-- baris ECAT/PL. Menyaring berdasarkan pola nama barang akan lolos/gagal diam-diam
-- begitu ada produk baru, dan kesalahannya tidak akan terlihat di total mana pun.
--
-- DAMPAKNYA TERKONSENTRASI DI SATU CUSTOMER, dan itu perlu diketahui pembacanya:
--     PUTERI AULIA DITA MEDICA, PT KOTA PEKANBARU   basis 16,3 jt -> +43,9 jt  (+269%)
--         seluruhnya dari satu TE-SONIC BLOOD BAG TUBE SEALER. Angka Rp/tes faskes ini
--         sesudahnya TIDAK mencerminkan pemakaian reagen.
--     BINA SEHAT, RS KAB. JEMBER                    basis 563,3 jt -> +10,1 jt (+1,8%)
--         sphygmomanometer; terlalu kecil untuk menggeser apa pun.
-- Sisa PL (Pandeglang 58,7 jt, Jatirogo 17,8 jt) barangnya cairan pembersih & reagen.
--
-- Kalau kelak ada taksonomi produk di mirror Accurate, saring alat di sini dan hapus
-- catatan ini. Sampai saat itu, PUTERI AULIA harus diperlakukan sebagai outlier yang
-- diketahui, bukan temuan.

DROP VIEW IF EXISTS kso_asset_produktivitas_v;
CREATE VIEW kso_asset_produktivitas_v AS
WITH kategori_skema AS (
  SELECT 'PER_TEST'::text AS skema, ARRAY['KSO']::text[] AS kategori
  UNION ALL
  SELECT 'BELI_REAGEN', ARRAY['REGULAR','KSO','RUTIN','ECAT','PL']
),
aset AS (
  SELECT a.*, ks.kategori AS kategori_berlaku
  FROM kso_asset a
  JOIN kategori_skema ks ON ks.skema = a.skema
  WHERE a.account_id IS NOT NULL
),
rev AS (  -- revenue per (customer, skema) menurut kategori yang berlaku bagi skema itu
  SELECT r.account_id, ks.skema, sum(r.revenue_netto) AS revenue_netto,
         sum(r.jumlah_faktur) AS jumlah_faktur
  FROM kso_customer_revenue_v r
  JOIN kategori_skema ks ON r.kategori = ANY (ks.kategori)
  GROUP BY r.account_id, ks.skema
),
tes AS (
  SELECT asset_id, sum(jumlah_tes) AS total_tes, count(*) AS bulan_terlapor,
         avg(jumlah_tes) AS rata_tes_bulanan
  FROM kso_asset_test_monthly
  GROUP BY asset_id
),
seskema AS (  -- berapa alat & berapa tes yang berbagi satu angka revenue customer
  SELECT a.account_id, a.skema, count(*)::int AS n,
         sum(t.total_tes) AS total_tes_seskema
  FROM kso_asset a
  LEFT JOIN tes t ON t.asset_id = a.id
  WHERE a.account_id IS NOT NULL
  GROUP BY a.account_id, a.skema
)
SELECT a.id AS asset_id, a.sn_key, a.customer_raw, a.account_id, a.kota, a.station,
       a.type_alat, a.nama_alat, a.skema, a.pemilik_alat,
       a.target_jumlah_tes,
       t.total_tes, t.bulan_terlapor, t.rata_tes_bulanan,
       CASE WHEN a.target_jumlah_tes > 0
            THEN round((t.rata_tes_bulanan / a.target_jumlah_tes)::numeric, 3) END
         AS capaian_target,
       rev.revenue_netto AS revenue_netto_customer,
       rev.jumlah_faktur,
       s.n AS alat_seskema_di_customer,
       s.total_tes_seskema AS total_tes_customer_seskema,
       CASE WHEN rev.revenue_netto IS NOT NULL AND s.total_tes_seskema > 0
            THEN round(rev.revenue_netto / s.total_tes_seskema, 2) END
         AS rupiah_per_tes_customer,
       -- Pagar: false = penyebut terlalu kecil, JANGAN pakai Rp/tes-nya untuk memeringkat.
       -- NULL total_tes diperlakukan sebagai tidak memadai (COALESCE), bukan dibiarkan
       -- NULL — flag yang NULL akan lolos dari filter `WHERE basis_tes_memadai` maupun
       -- `WHERE NOT basis_tes_memadai`, jadi barisnya hilang diam-diam dari dua-duanya.
       (COALESCE(s.total_tes_seskema, 0) >= 100) AS basis_tes_memadai,
       EXISTS (
         SELECT 1 FROM kso_asset b
         WHERE b.account_id = a.account_id AND b.skema <> a.skema
           AND b.skema IN ('PER_TEST','BELI_REAGEN')
       ) AS revenue_tumpang_tindih
FROM aset a
LEFT JOIN tes t   ON t.asset_id = a.id
LEFT JOIN rev     ON rev.account_id = a.account_id AND rev.skema = a.skema
LEFT JOIN seskema s ON s.account_id = a.account_id AND s.skema = a.skema;

COMMENT ON VIEW kso_asset_produktivitas_v IS
  'Produktivitas aset KSO: realisasi tes vs target + revenue Accurate menurut kategori pengadaan yang berlaku bagi skemanya. revenue_netto_customer & rupiah_per_tes_customer = level CUSTOMER, sama untuk semua alat seskema (lihat alat_seskema_di_customer). JANGAN memeringkat dengan rupiah_per_tes_customer tanpa memfilter basis_tes_memadai = true. Jangan jumlahkan lintas skema saat revenue_tumpang_tindih = true.';
