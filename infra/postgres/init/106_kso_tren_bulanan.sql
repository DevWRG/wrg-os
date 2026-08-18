-- 106 — tren KSO per bulan (jumlah tes + revenue netto), per skema.
--
-- Untuk sub-menu "Ringkasan" di /kso-produktivitas/ringkasan. Angka bulanan tidak bisa
-- diturunkan dari kso_asset_produktivitas_v — view itu sudah menjumlahkan seluruh periode
-- jadi satu baris per aset.
--
-- ── PETA KATEGORI → SKEMA JADI TABEL, BUKAN CTE KE-EMPAT ───────────────────────────
-- Daftar kategori yang berlaku per skema sudah disalin ulang di SETIAP migrasi yang
-- membuat ulang view produktivitas (098 → 101 → 102 → 103 → 104 → 105), dan tiap kali
-- ia berubah (RUTIN masuk di 100-an, ECAT+PL di 101) salinannya harus diubah serentak.
-- Menambah salinan ketujuh di sini berarti tren dan tabel bisa memakai aturan berbeda
-- tanpa satu pun error muncul — persis kelas kesalahan yang tidak terlihat di total mana
-- pun. Jadi peta itu dijadikan tabel `kso_kategori_skema`.
--
-- YANG BELUM DIKERJAKAN, DAN HARUS DIKETAHUI PEMBACA BERIKUTNYA:
-- `kso_asset_produktivitas_v` MASIH memuat daftarnya secara hardcode di CTE
-- `kategori_skema`. Migrasi ini sengaja TIDAK membuat ulang view live itu — perubahan
-- kosmetik pada view yang sedang dipakai menu produksi tidak sepadan dengan risikonya.
-- Begitu view itu perlu dibuat ulang untuk alasan lain, GANTI CTE-nya jadi baca tabel ini
-- dan hapus paragraf ini. Sementara itu, deteksi penyimpangannya dengan:
--
--   SELECT skema, array_agg(kategori ORDER BY kategori) FROM kso_kategori_skema GROUP BY 1;
--   -- bandingkan dengan CTE kategori_skema di infra/postgres/init/105_*.sql
--
-- Kalau dua-duanya tidak sama, tren dan tabel sedang berbohong satu sama lain.

CREATE TABLE IF NOT EXISTS kso_kategori_skema (
  skema    text NOT NULL CHECK (skema IN ('PER_TEST','BELI_REAGEN')),
  kategori text NOT NULL,
  PRIMARY KEY (skema, kategori)
);

COMMENT ON TABLE kso_kategori_skema IS
  'Kategori pengadaan Accurate (detailItem[].charField1) yang boleh dihitung sebagai revenue tiap skema KSO. Sumber kebenaran untuk kso_tren_bulanan_v; kso_asset_produktivitas_v masih hardcode daftar yang sama (lihat 106).';

-- Seed = aturan yang berlaku per 2026-08-18 (098 REGULAR+KSO, +RUTIN, +ECAT/PL di 101).
-- Tanpa BEGIN/COMMIT sendiri: deploy-prod.sh membungkus tiap file migrasi.
INSERT INTO kso_kategori_skema (skema, kategori) VALUES
  ('PER_TEST',    'KSO'),
  ('BELI_REAGEN', 'REGULAR'),
  ('BELI_REAGEN', 'KSO'),
  ('BELI_REAGEN', 'RUTIN'),
  ('BELI_REAGEN', 'ECAT'),
  ('BELI_REAGEN', 'PL')
ON CONFLICT (skema, kategori) DO NOTHING;

-- ── Tren bulanan ───────────────────────────────────────────────────────────────────
--
-- CAKUPAN sengaja disamakan dengan kso_asset_produktivitas_v: hanya aset yang
-- account_id-nya sudah terpetakan dan skemanya dikenal. Kalau cakupannya berbeda, total
-- tren tidak akan sama dengan kartu angka di halaman yang sama — pembaca akan menganggap
-- salah satunya rusak, dan tidak akan tahu yang mana.
--
-- PORSI KSO memakai rasio TAHUNAN yang sama dengan 102 (dibagi menurut total tes tiap
-- skema di customer berskema ganda), lalu diterapkan ke tiap bulan. Bukan porsi per-bulan:
-- rasio bulanan akan berayun liar di bulan yang salah satu skemanya nol tes, dan totalnya
-- tidak akan berjumlah sama dengan angka tahunan di kartu ringkasan.
CREATE OR REPLACE VIEW kso_tren_bulanan_v AS
WITH tes_aset AS (
  SELECT asset_id, sum(jumlah_tes) AS total_tes
  FROM kso_asset_test_monthly
  GROUP BY asset_id
),
porsi AS (  -- cermin blok `porsi` di 105; lihat migrasi 102 untuk alasannya
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
  SELECT a.skema, m.periode,
         sum(m.jumlah_tes)          AS jumlah_tes,
         count(DISTINCT a.id)::int  AS alat_lapor,
         count(DISTINCT a.account_id)::int AS faskes_lapor
  FROM kso_asset_test_monthly m
  JOIN kso_asset a ON a.id = m.asset_id
  WHERE a.account_id IS NOT NULL AND a.skema IN ('PER_TEST','BELI_REAGEN')
    AND m.jumlah_tes IS NOT NULL
  GROUP BY a.skema, m.periode
),
rev AS (
  SELECT ks.skema, r.periode,
         sum(CASE WHEN r.kategori = 'KSO' THEN r.revenue_netto * p.porsi_kso
                  ELSE r.revenue_netto END) AS revenue_netto
  FROM kso_customer_revenue_v r
  JOIN kso_kategori_skema ks ON ks.kategori = r.kategori
  JOIN porsi p ON p.account_id = r.account_id AND p.skema = ks.skema
  GROUP BY ks.skema, r.periode
)
-- FULL JOIN, bukan LEFT: bulan yang punya faktur tapi belum ada laporan tes (dan
-- sebaliknya) tetap muncul. Dengan LEFT JOIN dari sisi tes, bulan ber-revenue tanpa
-- laporan akan hilang diam-diam dan grafiknya terlihat seolah tidak ada penjualan.
SELECT COALESCE(t.skema, rv.skema)     AS skema,
       COALESCE(t.periode, rv.periode) AS periode,
       t.jumlah_tes,
       t.alat_lapor,
       t.faskes_lapor,
       rv.revenue_netto
FROM tes t
FULL JOIN rev rv ON rv.skema = t.skema AND rv.periode = t.periode;

COMMENT ON VIEW kso_tren_bulanan_v IS
  'Tren KSO per bulan per skema: jumlah tes (kso_asset_test_monthly) + revenue netto (kso_customer_revenue_v, kategori dari kso_kategori_skema, porsi KSO tahunan seperti migrasi 102). Cakupan sama dengan kso_asset_produktivitas_v: hanya aset ber-account_id dan berskema dikenal. jumlah_tes NULL = bulan itu tidak ada laporan tes, BUKAN nol tes.';
