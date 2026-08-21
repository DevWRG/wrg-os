-- 111 — tren bulanan PER FASKES, dan `kso_tren_bulanan_v` jadi agregat di atasnya.
--
-- Untuk dialog "Lihat detail" di /kso-produktivitas: mengklik satu baris membuka riwayat
-- bulanan faskes itu sendiri. 106 hanya menyediakan tren yang sudah dijumlahkan lintas
-- faskes, jadi tidak bisa dipakai.
--
-- ── KENAPA VIEW LAMA DIDEFINISIKAN ULANG DI ATAS YANG BARU ─────────────────────────
-- Cara termudah adalah menambah satu view per-faskes dan membiarkan `kso_tren_bulanan_v`
-- apa adanya. Itu berarti blok `porsi` dan aturan kategori disalin untuk KEDUA kalinya —
-- persis pola yang baru saja dituntaskan 107 setelah salinannya sempat dibawa lewat enam
-- migrasi. Jadi yang per-faskes menjadi SATU-SATUNYA sumber, dan yang agregat sekadar
-- menjumlahkannya.
--
-- Konsekuensi yang disengaja: total tren TIDAK MUNGKIN lagi berbeda dari jumlah detail
-- tiap faskes. Kalau nanti dialog detail dan grafik ringkasan menampilkan angka yang tak
-- sejalan, penyebabnya pasti di lapisan UI — bukan dua definisi SQL yang menyimpang.
--
-- KESETARAAN diverifikasi sebelum dipakai, bukan diasumsikan:
--   SELECT skema, periode, jumlah_tes, alat_lapor, faskes_lapor, revenue_netto
--   FROM kso_tren_bulanan_v EXCEPT SELECT ... FROM <definisi lama>;   -- harus 0 baris
--
-- Kolom `alat_lapor` aman dijumlahkan: satu aset hanya dimiliki satu account_id, jadi
-- menjumlahkan hitungan per-faskes sama dengan menghitung DISTINCT lintas faskes.
-- `faskes_lapor` TIDAK dijumlahkan — ia dihitung ulang sebagai COUNT DISTINCT account_id
-- yang benar-benar melaporkan tes bulan itu (jumlah_tes NOT NULL), sama seperti 106.

CREATE OR REPLACE VIEW kso_faskes_tren_v AS
WITH tes_aset AS (
  SELECT asset_id, sum(jumlah_tes) AS total_tes
  FROM kso_asset_test_monthly
  GROUP BY asset_id
),
porsi AS (  -- cermin blok `porsi` di 105/107; lihat migrasi 102 untuk alasannya
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
    LEFT JOIN tes_aset t ON t.asset_id = a.id
    WHERE a.account_id IS NOT NULL AND a.skema IN ('PER_TEST','BELI_REAGEN')
    GROUP BY a.account_id, a.skema
  ) sc
),
tes AS (
  SELECT a.account_id, a.skema, m.periode,
         sum(m.jumlah_tes)         AS jumlah_tes,
         count(DISTINCT a.id)::int AS alat_lapor
  FROM kso_asset_test_monthly m
  JOIN kso_asset a ON a.id = m.asset_id
  WHERE a.account_id IS NOT NULL AND a.skema IN ('PER_TEST','BELI_REAGEN')
    AND m.jumlah_tes IS NOT NULL
  GROUP BY a.account_id, a.skema, m.periode
),
rev AS (
  SELECT r.account_id, ks.skema, r.periode,
         sum(CASE WHEN r.kategori = 'KSO' THEN r.revenue_netto * p.porsi_kso
                  ELSE r.revenue_netto END) AS revenue_netto
  FROM kso_customer_revenue_v r
  JOIN kso_kategori_skema ks ON ks.kategori = r.kategori
  JOIN porsi p ON p.account_id = r.account_id AND p.skema = ks.skema
  GROUP BY r.account_id, ks.skema, r.periode
)
-- FULL JOIN, bukan LEFT: bulan yang punya faktur tapi belum ada laporan tes (dan
-- sebaliknya) tetap muncul. Dengan LEFT JOIN dari sisi tes, bulan ber-revenue tanpa
-- laporan hilang diam-diam dan riwayatnya terlihat seolah tidak ada penjualan.
SELECT COALESCE(t.account_id, rv.account_id) AS account_id,
       COALESCE(t.skema, rv.skema)           AS skema,
       COALESCE(t.periode, rv.periode)       AS periode,
       t.jumlah_tes,
       t.alat_lapor,
       rv.revenue_netto
FROM tes t
FULL JOIN rev rv
  ON rv.account_id = t.account_id AND rv.skema = t.skema AND rv.periode = t.periode;

COMMENT ON VIEW kso_faskes_tren_v IS
  'Tren KSO per FASKES per bulan per skema — sumber tunggal; kso_tren_bulanan_v menjumlahkannya. jumlah_tes NULL = bulan itu tidak ada laporan tes, BUKAN nol tes.';

-- Agregat lintas faskes. Nama, urutan, dan tipe kolom dipertahankan persis seperti 106
-- supaya CREATE OR REPLACE diterima dan pemakai yang sudah ada tidak perlu berubah.
CREATE OR REPLACE VIEW kso_tren_bulanan_v AS
SELECT skema,
       periode,
       sum(jumlah_tes)   AS jumlah_tes,
       -- TANPA COALESCE ke 0, dan faskes_lapor lewat NULLIF: bulan yang punya faktur tapi
       -- TIDAK punya laporan tes harus tetap NULL, bukan 0. Perbedaannya bukan kosmetik —
       -- 0 berarti "sudah dihitung, hasilnya nol alat", NULL berarti "tidak ada laporan",
       -- dan aturan itu yang dipegang view ini sejak 106. Ketahuan dari diff terhadap
       -- keluaran view lama (BELI_REAGEN 2026-04: revenue ada, laporan tes tidak).
       sum(alat_lapor)::int                                                          AS alat_lapor,
       NULLIF(count(DISTINCT account_id) FILTER (WHERE jumlah_tes IS NOT NULL), 0)::int AS faskes_lapor,
       sum(revenue_netto)                                                            AS revenue_netto
FROM kso_faskes_tren_v
GROUP BY skema, periode;

COMMENT ON VIEW kso_tren_bulanan_v IS
  'Tren KSO per bulan per skema — AGREGAT dari kso_faskes_tren_v (migrasi 111), bukan definisi sendiri, supaya total tidak mungkin menyimpang dari detail per faskes. jumlah_tes NULL = bulan itu tidak ada laporan tes, BUKAN nol tes.';
