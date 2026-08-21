-- 104 — batasi pembanding tes ke periode yang dipunyai KEDUA sumber.
--
-- CACAT YANG DIPERBAIKI (terlihat pada data prod 2026-08-18, setelah WIDODO dipetakan ke
-- akun penagihnya): `rasio_tagih_lapor` bias ke bawah untuk hampir seluruh populasi.
--
-- 103 membatasi pembanding ke "periode yang dilaporkan sheet". Itu belum cukup: sheet
-- memuat 2025, mirror Accurate baru memuat faktur 2026-01 ke atas. Periode 2025 menyumbang
-- tes ke PENYEBUT tapi nol ke PEMBILANG.
--
-- WIDODO memperlihatkannya paling gamblang:
--     tes sheet 2026    43.521  |  ditagihkan 43.488  ->  100%   (cocok nyaris sempurna)
--     tes sheet SEMUA  121.523  |  ditagihkan 43.488  ->   36%   <- yang tampil di kolom
-- Angkanya bukan salah hitung, tapi terbaca "cuma 36% tes yang ditagihkan" padahal
-- penagihannya justru rapi. 167 dari 189 faskes punya data sheet 2025, jadi hampir semua
-- terkena.
--
-- Perbaikannya: irisan periode kedua sumber, dihitung DARI DATA (bukan tanggal keras)
-- supaya ikut bergerak saat mirror bertambah, dan digeser satu bulan mengikuti jeda tagih.
-- Pada data sekarang jendelanya 2025-12-01..2026-07-01.
--
-- `tes_sheet_periode_banding` karena itu berubah arti: bukan lagi "seluruh tes yang
-- dilaporkan sheet", melainkan "tes sheet pada periode yang bisa dibandingkan". Itu memang
-- yang seharusnya — kolom pembanding tidak boleh memakai penyebut yang pembilangnya
-- mustahil terisi. `total_tes` dan `total_tes_customer_seskema` TIDAK tersentuh: penyebut
-- Rp/tes tetap memakai seluruh periode.

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
jendela_banding AS (  -- rentang periode yang DIPUNYAI KEDUA sumber
  -- Mirror Accurate hanya memuat faktur 2026-01 ke atas, sementara sheet memuat 2025 juga.
  -- 103 membatasi pembanding ke "periode yang dilaporkan sheet" — itu belum cukup: periode
  -- 2025 menyumbang tes ke penyebut tapi NOL ke pembilang, sehingga rasionya bias ke bawah
  -- untuk 167 dari 189 faskes.
  --
  -- Dihitung dari data, bukan tanggal keras, supaya ikut bergerak saat mirror bertambah.
  -- Digeser satu bulan mengikuti jeda tagih (faktur bulan M = tes bulan M-1): faktur
  -- 2026-01-05..2026-08-14  =>  periode tes 2025-12-01..2026-07-01.
  SELECT (date_trunc('month', min(tanggal)) - interval '1 month')::date AS dari,
         (date_trunc('month', max(tanggal)) - interval '1 month')::date AS sampai
  FROM accurate_invoice WHERE tanggal IS NOT NULL
),
tagih AS (  -- jumlah tes menurut ACCURATE, dari baris PEMERIKSAAN/PENGULANGAN
  -- Accurate mencatat jumlah tes sebagai baris item 'PEMERIKSAAN <jenis alat>' (dan
  -- 'PENGULANGAN ...' untuk ulangan). 877 dari 1.145 baris berharga NOL: itu pencatat
  -- kuantitas, bukan penagihan — uangnya ada di baris reagen berkategori 'KSO'.
  --
  -- JEDA SATU BULAN, diukur bukan diasumsikan: faktur bulan M memuat tes bulan M-1.
  -- Dicek atas 67 faskes PER_TEST terhadap tes sheet Jan-Jul 2026:
  --     jendela sejajar (Jan-Jul)  -> agregat 106%, median 102%, 32/67 dalam +-5%
  --     jendela geser (Feb-Agu)    -> agregat  99%, median 100%, 41/67 dalam +-5%
  -- Karena itu tanggal faktur digeser mundur satu bulan sebelum dijodohkan ke periode.
  SELECT ai.customer_id AS account_id,
         (date_trunc('month', ai.tanggal) - interval '1 month')::date AS periode,
         sum((d.val->>'quantity')::numeric) AS qty
  FROM accurate_invoice ai
  JOIN LATERAL jsonb_array_elements(COALESCE(ai.raw->'detailItem','[]'::jsonb)) AS d(val) ON true
  WHERE ai.customer_id IS NOT NULL AND ai.tanggal IS NOT NULL
    AND (COALESCE(d.val->'item'->>'name','') ILIKE 'PEMERIKSAAN%'
      OR COALESCE(d.val->'item'->>'name','') ILIKE '%PENGULANGAN%')
  GROUP BY 1, 2
),
periode_sheet AS (  -- periode yang benar-benar dilaporkan sheet, per customer
  -- Pembanding HARUS dibatasi ke periode yang sama. Mirror Accurate baru memuat faktur
  -- 2026-01 ke atas, sementara sheet memuat 2025 juga; membandingkan total mentah akan
  -- selalu menunjukkan "Accurate kurang" padahal cuma beda jendela.
  SELECT a.account_id, m.periode, sum(m.jumlah_tes) AS tes
  FROM kso_asset a
  JOIN kso_asset_test_monthly m ON m.asset_id = a.id
  CROSS JOIN jendela_banding j
  WHERE a.account_id IS NOT NULL
    AND m.periode BETWEEN j.dari AND j.sampai
  GROUP BY a.account_id, m.periode
),
banding AS (
  SELECT ps.account_id,
         sum(ps.tes)                    AS tes_sheet_periode_banding,
         sum(COALESCE(t.qty, 0))        AS tes_ditagihkan_accurate,
         count(*) FILTER (WHERE t.qty IS NOT NULL) AS bulan_tertagih,
         count(DISTINCT t.qty)          AS nilai_qty_unik
  FROM periode_sheet ps
  LEFT JOIN tagih t ON t.account_id = ps.account_id AND t.periode = ps.periode
  GROUP BY ps.account_id
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
       b.tes_sheet_periode_banding,
       b.tes_ditagihkan_accurate,
       -- NULL, BUKAN 0, kalau customer tak punya satu pun baris PEMERIKSAAN: 103 dari 144
       -- faskes BELI_REAGEN memang tidak ditagih per tes, jadi rasio 0 akan terbaca
       -- "nol persen tertagih" padahal artinya "tidak berlaku". Yang tetap bermakna:
       -- faskes PER_TEST dengan bulan_tertagih = 0 — itu benar-benar tak ada catatan
       -- penagihan per tes (6 faskes pada data 2026-08-18).
       CASE WHEN b.bulan_tertagih > 0 AND b.tes_sheet_periode_banding > 0
            THEN round(b.tes_ditagihkan_accurate / b.tes_sheet_periode_banding, 3) END
         AS rasio_tagih_lapor,
       b.bulan_tertagih AS bulan_tertagih_accurate,
       -- true = qty bulanan Accurate nyaris tak berubah => itu MINIMUM KONTRAK yang
       -- ditagihkan tiap bulan, bukan hasil hitung tes. Rp/tes faskes seperti ini harus
       -- dibaca sebagai 'bayar minimum, alat jarang dipakai', bukan sebagai galat data.
       (b.bulan_tertagih >= 4 AND b.nilai_qty_unik <= 2) AS tagih_pola_datar,
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
LEFT JOIN seskema s ON s.account_id = a.account_id AND s.skema = a.skema
LEFT JOIN banding b ON b.account_id = a.account_id;

COMMENT ON VIEW kso_asset_produktivitas_v IS
  'Produktivitas aset KSO: realisasi tes vs target + revenue Accurate menurut kategori pengadaan yang berlaku bagi skemanya. revenue_netto_customer & rupiah_per_tes_customer = level CUSTOMER, sama untuk semua alat seskema (lihat alat_seskema_di_customer). JANGAN memeringkat dengan rupiah_per_tes_customer tanpa memfilter basis_tes_memadai = true. revenue_tumpang_tindih = customer memegang dua skema; sejak migrasi 102 revenue kategori KSO-nya SUDAH dibagi proporsional menurut jumlah tes (lihat porsi_kso), jadi menjumlahkan lintas skema kini SAH.';
