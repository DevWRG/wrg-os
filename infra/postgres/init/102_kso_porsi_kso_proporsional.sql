-- 102 — porsi kategori 'KSO' dibagi proporsional menurut jumlah tes di customer
-- yang memegang DUA skema sekaligus.
--
-- MASALAH YANG DIPECAHKAN (terlihat pada peringkat Rp/tes prod pertama, 2026-08-18):
-- Kategori 'KSO' berlaku bagi PER_TEST maupun BELI_REAGEN. Di customer yang memegang
-- kedua skema, 098 memberikan revenue KSO PENUH ke dua-duanya — pembilang Rp/tes
-- digelembungkan di kedua sisi sekaligus. Akibatnya, di antara 142 (faskes x skema) yang
-- layak diperingkat:
--     BELI_REAGEN  bersih 54 faskes, median Rp   37.285  | tumpang tindih 22, median Rp 143.165
--     PER_TEST     bersih 40 faskes, median Rp    4.568  | tumpang tindih 26, median Rp   7.817
-- Faskes berskema ganda bermedian 3,8x lebih tinggi di BELI_REAGEN dan 1,7x di PER_TEST,
-- dan 6 dari 10 besar di KEDUA skema adalah baris tumpang tindih. Yang naik ke puncak
-- bukan yang alatnya paling menghasilkan, melainkan yang kebetulan punya dua skema.
-- Itu pembalikan makna peringkat, sama seperti masalah penyebut-nol yang ditutup 100.
--
-- ATURAN BARU (ditetapkan user 2026-08-18): porsi KSO dibagi PROPORSIONAL TERHADAP
-- JUMLAH TES tiap skema di customer itu. Sigma porsi = 1, jadi revenue KSO tidak lagi
-- terhitung dua kali. Kategori lain (REGULAR/RUTIN/ECAT/PL) hanya berlaku bagi
-- BELI_REAGEN sehingga tidak tersentuh.
--
-- KENAPA PROPORSIONAL TES, BUKAN JUMLAH ALAT: revenue KSO dihasilkan oleh pemeriksaan,
-- bukan oleh keberadaan alat. Satu alat yang berjalan 30.000 tes menyerap reagen jauh
-- lebih banyak daripada lima alat yang menganggur.
--
-- KONSEKUENSI YANG DISENGAJA: `revenue_tumpang_tindih` berubah makna. Sebelumnya
-- peringatan "jangan dijumlah lintas skema"; sekarang sekadar penanda bahwa customer itu
-- berskema ganda dan porsinya sudah dibagi. Menjumlahkan lintas skema KINI SAH dan
-- hasilnya sama dengan revenue customer yang sebenarnya. Kolom baru `porsi_kso`
-- membuat pembagiannya terlihat dan bisa diaudit, bukan tersembunyi di dalam angka.

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
tes AS (
  SELECT asset_id, sum(jumlah_tes) AS total_tes, count(*) AS bulan_terlapor,
         avg(jumlah_tes) AS rata_tes_bulanan
  FROM kso_asset_test_monthly
  GROUP BY asset_id
),
porsi AS (  -- porsi kategori 'KSO' untuk tiap skema di customer yang punya DUA skema
  -- Kategori 'KSO' berlaku bagi PER_TEST maupun BELI_REAGEN. Di customer yang memegang
  -- kedua skema, memberi revenue KSO penuh ke dua-duanya menggelembungkan pembilang di
  -- kedua sisi. Di sini dibagi PROPORSIONAL TERHADAP JUMLAH TES (ditetapkan user
  -- 2026-08-18), sehingga Σ porsi = 1 dan revenue KSO tidak lagi terhitung dua kali.
  --
  -- Customer berskema tunggal selalu dapat porsi 1 — tidak ada perubahan bagi mereka.
  --
  -- CADANGAN kalau total tes kedua skema NOL: dibagi menurut jumlah alat. Tanpa ini
  -- pembaginya nol dan porsinya jadi NULL, yang diam-diam menghapus revenue customer itu
  -- dari view. Pada data prod 2026-08-18 kasus ini belum ada (26 dari 30 customer
  -- berskema ganda punya tes di dua-duanya, 4 nol di salah satu, nol yang kosong
  -- dua-duanya) — cadangannya untuk jaga-jaga, bukan karena sudah terjadi.
  SELECT sc.account_id, sc.skema,
         CASE
           WHEN count(*) OVER (PARTITION BY sc.account_id) = 1 THEN 1::numeric
           WHEN sum(sc.tes) OVER (PARTITION BY sc.account_id) > 0
             THEN sc.tes::numeric / sum(sc.tes) OVER (PARTITION BY sc.account_id)
           ELSE sc.n::numeric / sum(sc.n) OVER (PARTITION BY sc.account_id)
         END AS porsi_kso
  FROM (
    SELECT a.account_id, a.skema, count(*)::int AS n,
           COALESCE(sum(t.total_tes), 0)::numeric AS tes
    FROM kso_asset a
    LEFT JOIN tes t ON t.asset_id = a.id
    WHERE a.account_id IS NOT NULL AND a.skema IN ('PER_TEST','BELI_REAGEN')
    GROUP BY a.account_id, a.skema
  ) sc
),
rev AS (  -- revenue per (customer, skema) menurut kategori yang berlaku bagi skema itu
  SELECT r.account_id, ks.skema,
         sum(CASE WHEN r.kategori = 'KSO' THEN r.revenue_netto * p.porsi_kso
                  ELSE r.revenue_netto END) AS revenue_netto,
         sum(r.jumlah_faktur) AS jumlah_faktur,
         max(p.porsi_kso) AS porsi_kso
  FROM kso_customer_revenue_v r
  JOIN kategori_skema ks ON r.kategori = ANY (ks.kategori)
  JOIN porsi p ON p.account_id = r.account_id AND p.skema = ks.skema
  GROUP BY r.account_id, ks.skema
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
       round(rev.porsi_kso, 4) AS porsi_kso,
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
  'Produktivitas aset KSO: realisasi tes vs target + revenue Accurate menurut kategori pengadaan yang berlaku bagi skemanya. revenue_netto_customer & rupiah_per_tes_customer = level CUSTOMER, sama untuk semua alat seskema (lihat alat_seskema_di_customer). JANGAN memeringkat dengan rupiah_per_tes_customer tanpa memfilter basis_tes_memadai = true. revenue_tumpang_tindih = customer memegang dua skema; sejak migrasi 102 revenue kategori KSO-nya SUDAH dibagi proporsional menurut jumlah tes (lihat porsi_kso), jadi menjumlahkan lintas skema kini SAH.';
