-- 103 — pembanding jumlah tes: sheet vs Accurate.
--
-- TEMUAN YANG MELATARI (2026-08-18): Accurate ternyata mencatat jumlah tes sendiri,
-- lewat baris item 'PEMERIKSAAN <jenis alat>' — 877 dari 1.145 barisnya berharga NOL,
-- jadi itu pencatat kuantitas, bukan penagihan (uangnya ada di baris reagen kategori
-- 'KSO'). Sekaligus menjelaskan bucket "Tanpa kategori" yang selama ini menggantung:
-- 96,8% isinya baris PEMERIKSAAN.
--
-- Ini sumber tes KEDUA yang independen dari spreadsheet, dan selalu mutakhir.
--
-- KENAPA MENAMBAH KOLOM PEMBANDING, BUKAN MENGGANTI PENYEBUT Rp/tes:
-- qty Accurate TIDAK selalu hasil hitung tes. Sebagian faskes ditagih MINIMUM KONTRAK
-- yang sama persis tiap bulan — 8 faskes dengan CV 0% (mis. 300 tes x 8 bulan berturut).
-- Bandingkan faskes besar: 8 nilai berbeda dalam 8 bulan, CV 17-26%. Mengganti penyebut
-- dengan angka kontrak akan menukar data yang mungkin kurang lapor dengan konstanta, dan
-- yang lebih buruk: MENGUBUR temuannya. Penyebut lebih besar -> Rp/tes lebih kecil ->
-- peringkatnya turun. Padahal posisi puncak itulah sinyalnya, contoh nyata:
--     SEKAR LANGIT  sheet 2026 lengkap 12 bulan, 6-15 tes/bulan (2025: pernah 475/bulan)
--                   Accurate menagih 200/bulan datar. Bukan sheet yang bolong — alatnya
--                   yang praktis berhenti dipakai sementara minimum tetap ditagih.
-- Menaikkan penyebutnya dari 1.425 ke 1.600 akan memindahkan faskes ini turun peringkat
-- dan menghapus justru fakta yang perlu dilihat.
--
-- Jadi kedua angka dipertahankan berdampingan: sheet = tes yang DIJALANKAN, Accurate =
-- tes yang DITAGIHKAN. Selisihnya sendiri informasi bisnis.

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
  WHERE a.account_id IS NOT NULL
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
