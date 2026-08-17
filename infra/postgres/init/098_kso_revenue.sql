-- 098 — Jembatan aset KSO (097) ke transaksi Accurate: peta customer + view revenue.
--
-- ATURAN ATRIBUSI (ditetapkan user 2026-08-17, direvisi 2026-08-18):
--   • Aset skema PER_TEST ("KSO Tes", alat investasi WRG)  -> kategori penjualan 'KSO'
--   • Aset skema BELI_REAGEN ("KSO Reagen")                -> 'REGULAR', 'KSO', atau 'RUTIN'
--
-- "Kategori penjualan" = kategori PENGADAAN, custom field Accurate di level BARIS:
-- detailItem[].charField1 (REGULAR / KSO / RUTIN / PL / ECAT). Level baris, bukan level
-- faktur — jadi satu faktur bisa memuat baris REGULAR dan baris KSO sekaligus.
--
-- KENAPA 'RUTIN' IKUT BELI_REAGEN (revisi 2026-08-18): aturan versi pertama hanya
-- mengenal REGULAR + KSO, disusun sebelum ada yang melihat sebaran charField1 yang
-- sebenarnya. Setelah diukur ke prod (3.752 faktur / 11.308 baris):
--     KSO 18,90 M (67,4%) · RUTIN 5,04 M (18,0%) · REGULAR 2,12 M (7,6%)
--     ECAT 0,85 M (3,0%)  · PL 0,57 M (2,0%)     · Tanpa kategori 0,56 M (2,0%)
-- RUTIN = pembelian reagen rutin. Basis revenue BELI_REAGEN naik 21,02 M -> 26,06 M
-- (+24,0%); PER_TEST tidak berubah. Rp/tes aset BELI_REAGEN ikut naik ~24%.
--
-- ECAT & PL SENGAJA MASIH DI LUAR (0,85 M + 0,57 M = 5% revenue): belum ada keputusan
-- user soal keduanya. Jangan tambahkan tanpa itu — memasukkan kategori ke skema yang
-- salah tidak memunculkan error, cuma menggeser Rp/tes diam-diam.
--
-- KENAPA ALOKASI PROPORSIONAL, BUKAN "faktur ini kategori X": karena faktur campur itu
-- nyata. Kalau faktur campur dihitung utuh ke tiap kategori yang disentuhnya, total per
-- kategori akan melebihi total revenue. View ini memakai mekanisme yang SAMA PERSIS
-- dengan analyticsPerPengadaan (apps/api/src/repo/sales-analytics.ts): netto faktur
-- dibagi ke tiap kategori sesuai porsi nilai barisnya, sehingga Σ porsi = 1 dan grand
-- total-nya rekonsiliasi persis ke Total Revenue. Faktur yang `raw`-nya tidak punya
-- detailItem sama sekali dibagi rata (fallback inv_net/cnt), bukan dibuang.
--
-- BASIS REVENUE = NETTO TANPA PPN (total − tax_amount), konsisten dengan seluruh Sales
-- Analytics. Jangan diganti ke `total` — angkanya tidak akan nyambung dengan menu lain.

-- Peta nama customer di spreadsheet KSO -> customer Accurate.
-- KENAPA TABEL SENDIRI, BUKAN LANGSUNG kso_asset.account_id: satu faskes memegang
-- beberapa alat (rata-rata >1). Kalau pencocokan disimpan per-aset, admin harus
-- membetulkan nama yang sama berkali-kali dan bisa tidak konsisten antar alat.
-- Di sini dikoreksi SEKALI per customer, lalu disebar ke semua asetnya.
CREATE TABLE IF NOT EXISTS kso_customer_map (
  customer_key  text        PRIMARY KEY,   -- customer_raw yang dinormalisasi (slug)
  customer_raw  text        NOT NULL,      -- contoh yang terbaca manusia
  account_id    bigint      REFERENCES accurate_customer(id) ON DELETE SET NULL,
  metode        text        NOT NULL DEFAULT 'belum'
                  CHECK (metode IN ('belum','exact','tanpa_kota','fuzzy','manual','tidak_ada')),
  skor          numeric,                   -- 0..1, hanya untuk metode fuzzy
  kandidat      jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- usulan lain + skornya
  dikonfirmasi  boolean     NOT NULL DEFAULT false,
  catatan       text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN kso_customer_map.metode IS
  'exact/tanpa_kota = aman, dipakai otomatis. fuzzy = USULAN, jangan dipercaya sebelum dikonfirmasi. tidak_ada = sudah dicek, memang bukan customer Accurate.';
COMMENT ON COLUMN kso_customer_map.dikonfirmasi IS
  'true = sudah ditinjau manusia. Skrip pencocokan TIDAK PERNAH menimpa baris yang dikonfirmasi.';

CREATE INDEX IF NOT EXISTS kso_customer_map_account_idx
  ON kso_customer_map (account_id) WHERE account_id IS NOT NULL;

-- Revenue netto per customer × bulan × kategori pengadaan.
--
-- VIEW BIASA, bukan materialized: angkanya harus ikut bergerak tiap kali job
-- `accurate-sync` menarik faktur baru (6x hari kerja). MV berarti satu tempat lagi yang
-- bisa basi diam-diam, dan sudah ada preseden pahitnya. Biayanya: satu lateral
-- jsonb_array_elements atas accurate_invoice pada rentang yang diminta — untuk volume
-- faktur sekarang (~11,8rb) masih murah. Kalau kelak terasa berat, ganti ke tabel
-- turunan yang diisi di akhir accurate-sync, JANGAN ke MV tanpa jadwal refresh.
CREATE OR REPLACE VIEW kso_customer_revenue_v AS
WITH inv AS (
  SELECT ai.id,
         ai.customer_id,
         date_trunc('month', ai.tanggal)::date          AS periode,
         (ai.total - COALESCE(ai.tax_amount, 0))::numeric AS inv_net,
         ai.raw
  FROM accurate_invoice ai
  WHERE ai.customer_id IS NOT NULL AND ai.tanggal IS NOT NULL
),
cat AS (
  SELECT inv.id, inv.customer_id, inv.periode, inv.inv_net,
         COALESCE(NULLIF(d.val->>'charField1', ''), 'Tanpa kategori') AS kategori,
         COALESCE(sum(GREATEST((d.val->>'totalPrice')::numeric, 0)), 0) AS w
  FROM inv
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(inv.raw->'detailItem', '[]'::jsonb)) AS d(val)
    ON true
  GROUP BY inv.id, inv.customer_id, inv.periode, inv.inv_net,
           COALESCE(NULLIF(d.val->>'charField1', ''), 'Tanpa kategori')
),
share AS (
  SELECT cat.*,
         sum(w)   OVER (PARTITION BY id) AS wsum,
         count(*) OVER (PARTITION BY id) AS cnt
  FROM cat
)
SELECT customer_id AS account_id,
       periode,
       kategori,
       sum(CASE WHEN wsum > 0 THEN inv_net * w / wsum ELSE inv_net / cnt END)::numeric
         AS revenue_netto,
       count(DISTINCT id)::int AS jumlah_faktur
FROM share
GROUP BY customer_id, periode, kategori;

COMMENT ON VIEW kso_customer_revenue_v IS
  'Revenue netto (tanpa PPN) per customer Accurate x bulan x kategori pengadaan (detailItem[].charField1), teralokasi proporsional untuk faktur campur. Dipakai menghitung produktivitas aset KSO (097).';

-- Produktivitas per aset: realisasi tes + revenue yang berlaku menurut skema.
--
-- KEHATI-HATIAN YANG DIBANGUN KE DALAM VIEW INI:
-- 1. Revenue itu milik CUSTOMER, bukan milik satu alat. Satu faskes bisa punya beberapa
--    alat dengan skema sama. Kolom `revenue_netto_customer` karena itu SENGAJA tidak
--    dibagi-bagi ke tiap alat — membaginya (rata atau proporsional-tes) akan
--    menciptakan angka yang terlihat presisi padahal karangan. Kolom
--    `alat_seskema_di_customer` memberi tahu berapa alat yang berbagi angka itu;
--    kalau nilainya 1, revenue-nya memang milik alat itu sendiri.
-- 2. Untuk customer yang punya alat PER_TEST DAN BELI_REAGEN sekaligus, revenue
--    kategori 'KSO' masuk ke kedua-duanya (aturan user: BELI_REAGEN = REGULAR/KSO/RUTIN).
--    Itu artinya menjumlahkan kolom ini lintas skema akan MENGHITUNG GANDA porsi KSO.
--    Flag `revenue_tumpang_tindih` menandai baris yang terkena, supaya penjumlahan
--    naif ketahuan alih-alih diam-diam salah.
-- 3. Rp/tes DIHITUNG DI LEVEL CUSTOMER, bukan per alat: pembilangnya revenue milik
--    customer, jadi penyebutnya wajib total tes SEMUA alat seskema di customer itu.
--    Membaginya dengan tes satu alat saja menghasilkan angka yang bukan cuma salah tapi
--    salah arah — RS Muslimat punya 18 alat BELI_REAGEN berbagi satu angka revenue;
--    alat yang paling sedikit tesnya justru akan terlihat paling "mahal per tes".
--    Kolom ini karena itu bernilai SAMA untuk semua alat seskema di satu customer.
-- DROP dulu: CREATE OR REPLACE VIEW menolak perubahan nama/urutan kolom, dan migrasi ini
-- harus tetap bisa dijalankan ulang di atas versi view yang lebih lama.
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
  'Produktivitas aset KSO: realisasi tes vs target + revenue Accurate menurut kategori pengadaan yang berlaku bagi skemanya. revenue_netto_customer & rupiah_per_tes_customer = level CUSTOMER, sama untuk semua alat seskema (lihat alat_seskema_di_customer). Jangan jumlahkan lintas skema saat revenue_tumpang_tindih = true.';
