-- 100 — pagar untuk `rupiah_per_tes_customer`: tandai baris yang penyebutnya terlalu
-- kecil untuk dipercaya.
--
-- MASALAH YANG DIPECAHKAN (terlihat pada data prod pertama, 2026-08-18):
-- Wondfo OCG 102 di RSUD Dr. Harjono Ponorogo tercatat 4 tes dengan Rp 26,5 jt/tes, dan
-- deretan teratas Rp/tes SELURUHNYA berpola sama — alat dengan 1-50 tes setahun. Itu
-- bukan bug view: pembilangnya revenue seluruh kategori yang berlaku bagi skema itu di
-- customer tersebut, penyebutnya realisasi tes yang nyaris nol. Rp/tes-nya meledak, dan
-- kalau diurutkan menurun, alat yang PALING TIDAK terpakai justru muncul sebagai
-- "paling produktif". Itu pembalikan makna, bukan sekadar angka besar.
--
-- 098 sudah memaksa Rp/tes dihitung di level customer (bukan per alat), tapi tidak
-- memasang apa pun untuk penyebut yang mendekati nol. Ini menutup celah itu.
--
-- KENAPA MENANDAI, BUKAN MENG-NULL-KAN: angkanya tetap benar secara aritmetika dan
-- kadang justru itu sinyalnya — "customer ini beli reagen banyak tapi alatnya nyaris
-- tak dipakai" adalah temuan, bukan sampah. Yang berbahaya cuma memakainya sebagai
-- peringkat produktivitas tanpa sadar. Jadi angkanya dipertahankan dan konsumen
-- diwajibkan memilih secara sadar lewat `basis_tes_memadai`.
--
-- AMBANG 100 TES/TAHUN — dari sebaran nyata, bukan dikarang. Total tes 2026 per
-- (customer x skema), 133 grup:
--     min 0 · p5 1 · p10 12 · p25 120 · median 647 · p75 3.758 · maks 61.950
-- Sebarannya sangat miring: 12 grup di bawah 10 tes (tiga di antaranya NOL), sementara
-- median 647. Ambang 100 (~8 tes/bulan) duduk tepat di bawah kuartil pertama dan
-- menandai 29 grup (21,8%). Alternatif yang dipertimbangkan: 10 (9,0%) terlalu longgar,
-- masih meloloskan grup 12-99 tes yang Rp/tes-nya tetap didominasi derau penyebut;
-- 500 (46,6%) menandai hampir separuh populasi sehingga flag-nya kehilangan arti.
-- Kalau ambang ini mau digeser, geser dengan mengukur ulang sebarannya.

DROP VIEW IF EXISTS kso_asset_produktivitas_v;
CREATE VIEW kso_asset_produktivitas_v AS
WITH kategori_skema AS (
  SELECT 'PER_TEST'::text AS skema, ARRAY['KSO']::text[] AS kategori
  UNION ALL
  SELECT 'BELI_REAGEN', ARRAY['REGULAR','KSO','RUTIN']
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
