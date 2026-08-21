-- 121 — kalau SALAH SATU sisi skema nol tes, jangan pakai tes sebagai pembagi porsi KSO.
--
-- CACATNYA, dan ini interaksi dua hal yang masing-masing sudah diketahui:
--   • migrasi 102 membagi revenue kategori 'KSO' antar-skema PROPORSIONAL JUMLAH TES.
--   • sebagian jenis alat tidak pernah melaporkan tes sama sekali — Hemodialisa nol dari
--     38 alat (lihat pagar cakupan laporan di 113).
-- Bertemu di satu faskes, hasilnya bukan condong tapi TERBALIK PENUH: sisi yang nol tes
-- dapat porsi 0, sisi lain otomatis 1,0 — tanpa melihat reagen siapa yang sebenarnya keluar.
--
-- BUKTI YANG MEMICU PERBAIKAN INI — NGUDI WALUYO WLINGI, RSUD KAB. BLITAR (2264):
--     BELI_REAGEN : LED (129 tes) + POCT Clover (0) + URINALYZER (60)   -> 189 tes
--     PER_TEST    : Hemodialisa Fresenius 4008 S                        ->   0 tes
--     porsi lama  : BELI_REAGEN 189/(189+0) = 1,0000
--   Padahal SELURUH Rp 675 jt reagen berkategori KSO di faskes itu adalah reagen
--   HEMODIALISA — 34 baris, dan mesinnya ada di sisi PER_TEST. Sisi BELI_REAGEN nol
--   rupiah. Jadi Rp 675 jt diberikan 100% ke sisi yang tidak memakai sepeser pun.
--
-- Faskes berskema ganda yang salah satu sisinya nol tes (data 2026-08-22):
--     NGUDI WALUYO WLINGI      PER_TEST nol tes    Rp 675 jt
--     AISYIYAH Bojonegoro      BELI_REAGEN nol tes Rp 416 jt
--     SYMPONI DANARIEVA MEDIKA BELI_REAGEN nol tes Rp  38 jt
-- Tiga faskes, Rp 1,13 M, arah kesalahannya total.
--
-- CAKUPAN PERBAIKAN SENGAJA DISEMPITKAN KE KASUS ITU SAJA. Untuk 27 faskes ganda lainnya
-- aturan tes TIDAK diubah. Alasannya diukur: dibandingkan pembagian berbasis reagen,
-- agregat aturan tes sudah dekat (BELI_REAGEN Rp 1,452 M vs Rp 1,657 M, selisih 13%),
-- sementara pembagian berbasis JUMLAH ALAT — yang tadinya terlihat seperti perbaikan
-- sederhana — justru paling jauh dari bukti (Rp 3,468 M, melebihkan ~Rp 1,8 M). Mengganti
-- aturan untuk semua faskis berarti menggeser angka 27 faskes atas dasar yang belum cukup
-- kuat. Yang diperbaiki di sini hanya yang pembaginya memang bukan proporsi: nol.
--
-- Urutan cadangan porsi setelah migrasi ini:
--   1. faskes berskema tunggal            -> 1
--   2. SALAH SATU sisi nol tes + porsi reagen terdefinisi -> porsi reagen   (BARU)
--   3. total tes > 0                      -> proporsional tes  (tidak berubah, 27 faskes)
--   4. dua-duanya nol tes                 -> proporsional jumlah alat
-- Kalau porsi reagen tidak terdefinisi (faskes tidak punya reagen KSO sama sekali),
-- langkah 2 dilewati — jadi tidak ada faskes yang porsinya jadi NULL karena perbaikan ini.

CREATE OR REPLACE VIEW kso_porsi_reagen_v AS
WITH sisi AS (
  SELECT a.account_id, a.skema, count(*)::numeric AS alat
  FROM kso_asset a
  WHERE a.account_id IS NOT NULL AND a.skema IN ('PER_TEST','BELI_REAGEN')
  GROUP BY 1,2
),
jenis_sisi AS (
  SELECT a.account_id, kso_jenis_kanonik(a.type_alat) AS jenis, a.skema
  FROM kso_asset a
  WHERE a.account_id IS NOT NULL AND a.skema IN ('PER_TEST','BELI_REAGEN')
  GROUP BY 1,2,3
),
baris AS (
  SELECT r.account_id, r.jenis_alat, sum(r.nilai_netto) AS nilai
  FROM kso_faskes_reagen_v r WHERE r.kategori = 'KSO'
  GROUP BY 1,2
),
cocok AS (
  SELECT b.account_id, b.jenis_alat, b.nilai, js.skema
  FROM baris b
  LEFT JOIN kso_jenis_gabungan gb ON gb.jenis_gabungan = b.jenis_alat
  LEFT JOIN jenis_sisi js ON js.account_id = b.account_id
                         AND js.jenis = COALESCE(gb.jenis_anggota, b.jenis_alat)
),
klas AS (
  SELECT account_id, jenis_alat, min(nilai) AS nilai,
         count(DISTINCT skema) AS n_skema, min(skema) AS skema_putus
  FROM cocok GROUP BY 1,2
),
terputus AS (
  SELECT account_id, jenis_alat, nilai, n_skema, skema_putus,
         (n_skema = 1 AND jenis_alat IS NOT NULL
          AND jenis_alat NOT LIKE 'UMUM%' AND jenis_alat NOT LIKE 'MANUAL%') AS jelas
  FROM klas
),
langsung AS (SELECT account_id, skema_putus AS skema, sum(nilai) AS nilai
             FROM terputus WHERE jelas GROUP BY 1,2),
residu AS (SELECT account_id, sum(nilai) AS nilai FROM terputus WHERE NOT jelas GROUP BY 1),
hitung AS (
  SELECT s.account_id, s.skema, s.alat,
         sum(s.alat) OVER (PARTITION BY s.account_id) AS alat_tot,
         COALESCE(l.nilai, 0) AS nilai_jelas,
         COALESCE(r.nilai, 0) AS nilai_residu_faskes
  FROM sisi s
  LEFT JOIN langsung l ON l.account_id = s.account_id AND l.skema = s.skema
  LEFT JOIN residu   r ON r.account_id = s.account_id
),
bobot AS (
  SELECT h.*, h.nilai_jelas + h.nilai_residu_faskes * h.alat / h.alat_tot AS bobot FROM hitung h
)
SELECT account_id, skema, round(nilai_jelas) AS nilai_jelas,
       round(nilai_residu_faskes * alat / alat_tot) AS nilai_residu,
       round(bobot / NULLIF(sum(bobot) OVER (PARTITION BY account_id), 0), 6) AS porsi_reagen,
       round(sum(nilai_jelas) OVER (PARTITION BY account_id)
             / NULLIF(sum(nilai_jelas + nilai_residu_faskes * alat / alat_tot) OVER (PARTITION BY account_id), 0), 4)
         AS cakupan_bukti
FROM bobot;

COMMENT ON VIEW kso_porsi_reagen_v IS
  'Porsi revenue kategori KSO antar-skema di satu faskes, ditentukan dari REAGEN yang benar-benar difakturkan: jenis alat item (kso_item_jenis_v via kso_faskes_reagen_v) dijodohkan ke jenis alat yang dipegang tiap sisi skema. Nilai yang jenisnya tidak dapat dijodohkan (ambigu dua skema / item belum terpetakan / bukan reagen alat) dibagi menurut jumlah alat dan dilaporkan di nilai_residu. cakupan_bukti = share yang ditentukan bukti, bukan cadangan; porsi_reagen NULL/cakupan rendah = jangan dipercaya.';

DROP VIEW IF EXISTS kso_asset_produktivitas_v;
CREATE VIEW kso_asset_produktivitas_v AS
WITH kategori_skema AS (  -- DIBACA dari tabel (106), tidak lagi disalin ke tiap migrasi
  SELECT skema, array_agg(kategori ORDER BY kategori) AS kategori
  FROM kso_kategori_skema
  GROUP BY skema
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
faktur_customer AS (  -- ada tidaknya faktur sama sekali, terlepas dari isinya
  SELECT customer_id AS account_id, count(*)::int AS jumlah_faktur_total
  FROM accurate_invoice WHERE customer_id IS NOT NULL GROUP BY customer_id
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
           -- BARU (121): pembagi nol-vs-sesuatu bukan proporsi. Kalau satu sisi nol tes
           -- dan porsi berbasis reagen terdefinisi, pakai itu — bukti, bukan proksi.
           WHEN min(sc.tes) OVER (PARTITION BY sc.account_id) = 0
            AND sum(sc.tes) OVER (PARTITION BY sc.account_id) > 0
            AND pr.porsi_reagen IS NOT NULL THEN pr.porsi_reagen
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
  LEFT JOIN kso_porsi_reagen_v pr
    ON pr.account_id = sc.account_id AND pr.skema = sc.skema
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
       -- `bulan_tertagih_accurate = 0` MENCAMPUR dua keadaan yang sangat berbeda, dan
       -- itu menyesatkan: 94 faskes BELI_REAGEN ditagih normal tanpa baris pencatat tes
       -- (memang begitu skemanya), sementara segelintir faskes benar-benar tidak punya
       -- faktur apa pun. Kolom ini memisahkannya:
       --   'ada_catatan_tes'          ada baris PEMERIKSAAN/PENGULANGAN -> rasio berlaku
       --   'faktur_tanpa_catatan_tes' ditagih, tapi tanpa baris pencatat tes. Normal bagi
       --                              BELI_REAGEN (94 faskes); pada PER_TEST hanya 2
       --                              (MARISA, SYMPONI) dan itu layak ditanya.
       --   'tanpa_faktur'             NOL faktur atas nama customer ini. Pada PER_TEST
       --                              hanya 2 (TEJA HUSADA, HAJI RSIA Batu) — alat aktif,
       --                              tidak ada apa pun yang keluar atas namanya.
       -- Preseden kenapa ini penting: WIDODO sempat masuk kelompok terakhir, dan ternyata
       -- ditagih lewat badan hukum yang namanya tidak menyerupai nama faskes.
       CASE WHEN b.bulan_tertagih > 0            THEN 'ada_catatan_tes'
            WHEN COALESCE(fc.jumlah_faktur_total, 0) > 0 THEN 'faktur_tanpa_catatan_tes'
            ELSE 'tanpa_faktur' END AS status_penagihan,
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
LEFT JOIN banding b ON b.account_id = a.account_id
LEFT JOIN faktur_customer fc ON fc.account_id = a.account_id;

COMMENT ON VIEW kso_asset_produktivitas_v IS
  'Produktivitas aset KSO: realisasi tes vs target + revenue Accurate menurut kategori pengadaan yang berlaku bagi skemanya. revenue_netto_customer & rupiah_per_tes_customer = level CUSTOMER, sama untuk semua alat seskema (lihat alat_seskema_di_customer). JANGAN memeringkat dengan rupiah_per_tes_customer tanpa memfilter basis_tes_memadai = true. revenue_tumpang_tindih = customer memegang dua skema; sejak migrasi 102 revenue kategori KSO-nya SUDAH dibagi proporsional menurut jumlah tes (lihat porsi_kso), jadi menjumlahkan lintas skema kini SAH. PEMBANDING TES (103/104/105): tes_ditagihkan_accurate = jumlah tes menurut baris PEMERIKSAAN/PENGULANGAN di Accurate, digeser 1 bulan (faktur bulan M = tes bulan M-1) dan dibatasi ke irisan periode kedua sumber; bandingkan lewat rasio_tagih_lapor terhadap tes_sheet_periode_banding. rasio NULL = customer tak punya baris pencatat tes, bukan 0%. status_penagihan memisahkan tanpa_faktur (nol faktur atas nama customer) dari faktur_tanpa_catatan_tes (ditagih tapi tanpa baris PEMERIKSAAN - NORMAL bagi BELI_REAGEN); jangan baca bulan_tertagih_accurate = 0 sebagai tidak-ditagih. tagih_pola_datar = true berarti qty Accurate itu minimum kontrak, bukan hasil hitung tes. SUMBER ATURAN kategori->skema sejak 107 adalah tabel kso_kategori_skema (satu-satunya tempat mengubahnya); view ini tidak lagi memuat salinannya.';

-- Komentar tabelnya ikut dibetulkan: sejak migrasi ini tidak ada lagi salinan hardcode.
COMMENT ON TABLE kso_kategori_skema IS
  'Kategori pengadaan Accurate (detailItem[].charField1) yang boleh dihitung sebagai revenue tiap skema KSO. SATU-SATUNYA sumber kebenaran: dibaca oleh kso_tren_bulanan_v (106) dan kso_asset_produktivitas_v (107). Mengubah aturan = mengubah isi tabel ini, jangan menyalinnya ke query lain. Mengosongkan tabel ini membuat kedua view nol baris tanpa error.';
