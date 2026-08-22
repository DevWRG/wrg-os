-- 125 — penagihan per-tes juga masuk TREN, dan aturannya pindah ke satu view.
--
-- CACAT YANG DILAPORKAN DARI LAYAR: pada dialog detail satu faskes, tabel "Reagen keluar"
-- memuat dua baris `PEMERIKSAAN …` senilai Rp 16,58 jt, sementara grafik "Riwayat revenue
-- netto" di atasnya berjumlah ~Rp 18,3 jt untuk seluruh 2026 — grafiknya persis sama
-- dengan tabel TANPA kedua baris itu.
--
-- SEBABNYA PERUBAHAN SAYA SENDIRI SEHARI SEBELUMNYA. Migrasi 124 mengakui penagihan
-- per-tes sebagai revenue, tapi hanya di `kso_asset_produktivitas_v` — view yang mengisi
-- KARTU. Grafik dibaca dari `kso_faskes_tren_v` (111) dan tabel menggolongkan baris lewat
-- keanggotaan kategori di `kso_kategori_skema`. Jadi 124 membuat tiga tempat di SATU
-- dialog tidak lagi sepakat:
--
--   kartu  "Revenue netto"            kso_asset_produktivitas_v (124)   penagihan tes MASUK
--   grafik "Riwayat revenue netto"    kso_faskes_tren_v         (111)   tidak masuk
--   tabel  subtotal "dalam skema"     kategori ∈ kso_kategori_skema     digolongkan LUAR
--
-- Tidak ada yang gagal untuk menandainya. Yang terlihat cuma tiga angka yang berbeda di
-- satu layar — jenis kesalahan yang membuat pembaca meragukan ketiganya.
--
-- ── KENAPA ATURANNYA DIPINDAH KE VIEW, BUKAN DISALIN KE TREN ─────────────────────
-- Menambal tren saja berarti CTE `penagihan_tes` hidup di DUA tempat: di dalam definisi
-- view produktivitas (124) dan di dalam tren. Itu pola yang sudah dihukum dua kali di
-- repo ini — 107 menuntaskan blok `porsi` yang sempat dibawa lewat enam migrasi, dan 111
-- menolak menyalin aturan kategori untuk kedua kalinya. Aturan yang sama di dua tempat
-- akan menyimpang; pertanyaannya cuma kapan.
--
-- Jadi `kso_penagihan_tes_v` menjadi SATU-SATUNYA tempat aturan itu ditulis, dan ketiga
-- pemakainya membacanya:
--   * kso_asset_produktivitas_v — CTE-nya kini SELECT dari view ini (satu-satunya
--     suntingan; sisa 235 baris definisi 124 disalin mekanis, tidak ditulis ulang)
--   * kso_faskes_tren_v         — per bulan, lewat FULL JOIN
--   * subtotal tabel di TS      — lewat EXISTS ke view ini (apps/api/src/repo/kso-produktivitas.ts)
--
-- Konsekuensi yang disengaja, sama seperti 111: kartu, grafik, dan tabel TIDAK MUNGKIN
-- lagi memuat himpunan baris yang berbeda.
--
-- ── NULL DIJAGA, TIDAK DI-COALESCE JADI NOL ──────────────────────────────────────
-- Penjumlahan revenue memakai CASE, bukan COALESCE(a,0)+COALESCE(b,0). Bulan tanpa
-- faktur DAN tanpa penagihan tes harus tetap NULL — 111 sudah pernah kehilangan makna
-- itu (`alat_lapor` NULL berubah jadi 0) dan cacatnya baru ketahuan dari diff keluaran
-- view lama. NULL = "tidak ada laporan", 0 = "sudah dihitung, hasilnya nol".
--
-- ── VERIFIKASI DI PROD (tidak bisa di dev: fixture faktur cuma 10 baris) ─────────
--   -- 1. kartu = Σ grafik pada rentang yang sama (harus nol selisih):
--   SELECT round(sum(revenue_netto)) FROM kso_faskes_tren_v WHERE skema='PER_TEST';
--   SELECT round(sum(DISTINCT revenue_netto_customer)) FROM (
--     SELECT DISTINCT account_id, revenue_netto_customer FROM kso_asset_produktivitas_v
--     WHERE skema='PER_TEST') x;
--
--   -- 2. PENGGANDAAN LINTAS SKEMA sudah DITUTUP di view ini lewat CTE `kepemilikan`
--   --    (satu baris per account+jenis). Yang diverifikasi bukan lagi "apakah ada faskes
--   --    berskema ganda" — ADA, 6 pasangan terukur — melainkan bahwa view ini tetap
--   --    memberi satu baris saja per pasangan:
--   SELECT count(*) FROM (
--     SELECT account_id, periode, item_id FROM kso_penagihan_tes_v
--     GROUP BY 1,2,3 HAVING count(DISTINCT skema) > 1) x;
--   -- harus 0. Ini invarian view, bukan sifat data — kalau pecah, CTE `kepemilikan`
--   -- yang rusak, bukan datanya yang berubah.
--
--   -- 3. Warisan 124 di prod: sebelum migrasi ini, faskes berskema ganda menerima
--   --    penagihan tesnya dua kali. SUDAH DIUKUR di prod 2026-08-22 dan hasilnya
--   --    Rp 0,000000000 EKSAK — 3 pasangan yang punya item PEMERIKSAAN semuanya baris
--   --    pencatat kuantitas berharga nol (qty 4.594 / 697 / 7.799 tes). Jadi apply
--   --    migrasi ini TIDAK menggeser rupiah mana pun; koreksinya nol.
--
--   -- 4. PEMANTAUAN BERKALA, dan ini yang akan berubah kelak: baris penagihan tes pada
--   --    pasangan yang MENYEBERANG dua skema dan sudah BERHARGA. Selama nol, keputusan
--   --    atribusi ke PER_TEST belum menyentuh rupiah. Begitu > 0, ia mulai menentukan
--   --    angka — dan sisi BELI_REAGEN tidak dapat bagian tanpa itu terlihat di mana pun:
--   SELECT count(*) AS baris, round(sum(nilai_netto)) AS rupiah
--   FROM kso_penagihan_tes_v WHERE lintas_skema AND nilai_netto > 0;
--   -- 0 = keputusan atribusi masih netral terhadap angka. > 0 = layak ditinjau ulang,
--   -- karena saat itu ada pilihan lain (bagi porsi antar skema) yang berbeda hasilnya.

-- Sumber tunggal aturan "baris faktur ini adalah penagihan per-tes yang diakui".
-- Granular sampai (periode, item_id) supaya bisa dipakai tren DAN subtotal per item;
-- pemakai yang butuh agregat menjumlahkannya sendiri.
CREATE OR REPLACE VIEW kso_penagihan_tes_v AS
WITH kepemilikan AS (
  -- SATU baris per (account, jenis) — bukan per skema. Ini yang menutup penggandaan
  -- lintas skema, dan alasannya diukur: 6 pasangan faskes x jenis alat ada di KEDUA
  -- skema (5 faskes, 14 aset). Dengan satu baris per skema, penagihan tes untuk jenis
  -- itu terhitung DUA KALI — sekali di PER_TEST, sekali di BELI_REAGEN — dan tidak ada
  -- apa pun yang gagal untuk menandainya.
  --
  -- ATURAN PEMECAHNYA, keputusan user 2026-08-22: seluruhnya ke PER_TEST bila faskes
  -- punya alat jenis itu di sana. Penagihan PER TES adalah mekanisme skema PER_TEST —
  -- di BELI_REAGEN yang ditagih reagennya, bukan tesnya. Bukti pendukungnya sudah ada
  -- di 124: pada faskes berskema TUNGGAL, penagihan tes PER_TEST Rp 217 jt sementara
  -- BELI_REAGEN Rp 0 (nol baris berharga).
  --
  -- Faskes yang punya jenis itu HANYA di BELI_REAGEN tetap menerimanya — CASE ini
  -- memilih, bukan membuang.
  --
  -- DIJAGA SECARA STRUKTURAL, bukan dengan syarat tambahan: GROUP BY (account, jenis)
  -- membuat lebih dari satu baris per pasangan tidak mungkin ada, jadi join di bawah
  -- tidak bisa menggandakan seberapa pun datanya berubah kelak.
  SELECT account_id, jenis,
         CASE WHEN bool_or(skema = 'PER_TEST') THEN 'PER_TEST' ELSE 'BELI_REAGEN' END AS skema,
         -- Penanda: pasangan ini MENYEBERANG dua skema, jadi atribusinya hasil keputusan
         -- di atas — bukan satu-satunya kemungkinan. Diukur saat migrasi ini dibuat:
         -- 6 pasangan menyeberang, 3 di antaranya punya item PEMERIKSAAN, dan ketiganya
         -- berharga Rp 0,000000000 EKSAK (baris pencatat kuantitas: qty 4.594 / 697 /
         -- 7.799 tes, rupiah nol). Jadi keputusan atribusi ini belum menyentuh rupiah
         -- mana pun.
         --
         -- KENAPA DITANDAI KALAU NOL: yang menahannya cuma keadaan data, bukan aturan.
         -- Begitu satu faktur PEMERIKSAAN BERHARGA terbit untuk salah satu pasangan itu,
         -- nilainya masuk PER_TEST tanpa ada apa pun yang menyebutkan bahwa sisi
         -- BELI_REAGEN baru saja tidak dapat bagian. Kolom ini membuat kejadian itu bisa
         -- ditemukan, bukan cuma terjadi.
         (count(DISTINCT skema) > 1) AS lintas_skema
  FROM (
    -- DISTINCT dulu: satu faskes bisa punya BEBERAPA alat berjenis sama, dan join
    -- per-aset menggandakan nilainya sebanyak jumlah alat — terukur Rp 6,84 jt menjadi
    -- Rp 20,52 jt saat 124 diuji (3 alat Hematology 5Diff).
    SELECT DISTINCT account_id, kso_jenis_kanonik(type_alat) AS jenis, skema
    FROM kso_asset
    WHERE account_id IS NOT NULL AND skema IN ('PER_TEST','BELI_REAGEN')
  ) x
  GROUP BY account_id, jenis
)
SELECT r.account_id, a.skema, r.periode, r.item_id, r.nilai_netto, a.lintas_skema
FROM kso_faskes_reagen_v r
JOIN kso_item_jenis_v m ON m.item_id = r.item_id
-- Jenis alat yang tertulis di nama item harus BENAR-BENAR dimiliki faskes itu. Tanpa
-- syarat ini, tagihan tes untuk alat yang bukan miliknya ikut terhitung.
JOIN kepemilikan a ON a.account_id = r.account_id AND a.jenis = m.jenis
WHERE r.item_id IN (SELECT item_id FROM kso_item_pemeriksaan_v);

COMMENT ON VIEW kso_penagihan_tes_v IS
  'Baris faktur yang diakui sebagai penagihan per-tes KSO (keputusan HoD 2026-08-22, migrasi 124). SUMBER TUNGGAL aturannya: dibaca oleh kso_asset_produktivitas_v (kartu), kso_faskes_tren_v (grafik), dan subtotal dalam-skema di repo TS. Satu baris per (account, jenis) — penggandaan lintas skema tidak mungkin, bukan sekadar tidak terjadi.';
COMMENT ON COLUMN kso_penagihan_tes_v.lintas_skema IS
  'TRUE = faskes punya jenis alat ini di KEDUA skema, jadi baris ini diatribusikan ke PER_TEST berdasarkan keputusan user 2026-08-22, bukan karena hanya ada satu kemungkinan. Pantau: baris lintas_skema DENGAN nilai_netto > 0 = keputusan itu mulai menentukan rupiah dan layak ditinjau (saat migrasi ini dibuat, seluruhnya Rp 0 eksak).';

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
-- BARU (124): penagihan per-tes. Item PEMERIKSAAN <jenis> <merek> mencatat tagihan per
-- tes, tapi charField1-nya SELALU kosong sehingga jatuh ke 'Tanpa kategori' dan tidak
-- pernah masuk basis revenue skema mana pun. Diakui sebagai revenue KSO atas keputusan
-- HoD 2026-08-22 (Rp 553,6 jt).
--
-- TIDAK DIBAGI PORSI KSO, dan itu keputusan yang disengaja: porsi (102/121) membagi
-- revenue kategori 'KSO' antar dua skema karena faktur tidak menyebut mesin mana yang
-- memakainya. Di sini mesinnya DISEBUT — ada di nama itemnya. Jadi atribusinya langsung
-- ke skema yang memiliki jenis alat itu; membaginya lagi lewat porsi justru membuang
-- bukti yang lebih kuat dan mengirim sebagian nilainya ke sisi yang tidak memakainya.
--
-- Lewat accurate_invoice_item (butuh item_id), bukan raw->detailItem yang dipakai
-- kso_customer_revenue_v — detailItem tidak membawa item_id sehingga item PEMERIKSAAN
-- tak bisa dibedakan di sana. Kedua jalur terbukti sepadan di prod (faktur tanpa baris
-- item = 0), lihat komentar migrasi 120.
penagihan_tes AS (
  -- Aturannya TIDAK lagi ditulis di sini: dibaca dari kso_penagihan_tes_v di atas, view
  -- yang sama yang dipakai kso_faskes_tren_v. Itu inti migrasi ini.
  SELECT account_id, skema, sum(nilai_netto) AS revenue_netto
  FROM kso_penagihan_tes_v
  GROUP BY account_id, skema
),
rev AS (  -- revenue per (customer, skema) menurut kategori yang berlaku bagi skema itu
  SELECT COALESCE(k.account_id, pt.account_id) AS account_id,
         COALESCE(k.skema, pt.skema)           AS skema,
         COALESCE(k.revenue_netto, 0) + COALESCE(pt.revenue_netto, 0) AS revenue_netto,
         k.jumlah_faktur,
         k.porsi_kso
  FROM (
    SELECT r.account_id, ks.skema,
           sum(CASE WHEN r.kategori = 'KSO' THEN r.revenue_netto * p.porsi_kso
                    ELSE r.revenue_netto END) AS revenue_netto,
           sum(r.jumlah_faktur) AS jumlah_faktur,
           max(p.porsi_kso) AS porsi_kso
    FROM kso_customer_revenue_v r
    JOIN kategori_skema ks ON r.kategori = ANY (ks.kategori)
    JOIN porsi p ON p.account_id = r.account_id AND p.skema = ks.skema
    GROUP BY r.account_id, ks.skema
  ) k
  -- FULL JOIN: faskes yang HANYA punya penagihan tes (nol reagen berkategori) tetap
  -- muncul. Dengan INNER/LEFT dari sisi kategori, revenue-nya hilang tanpa jejak.
  FULL JOIN penagihan_tes pt
    ON pt.account_id = k.account_id AND pt.skema = k.skema
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
       round(rev.porsi_kso, 12) AS porsi_kso,
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

-- ── TREN PER FASKES: turunan 111 dengan penagihan tes ditambahkan ────────────────
-- Blok `tes_aset`, `porsi`, `tes`, dan `rev` disalin APA ADANYA dari 111. Yang baru cuma
-- CTE `pt` dan `rev_all`. Kolom keluaran tidak berubah sama sekali (account_id, skema,
-- periode, jumlah_tes, alat_lapor, revenue_netto) — syarat CREATE OR REPLACE, dan juga
-- alasan kso_tren_bulanan_v tidak perlu ikut didefinisikan ulang: ia menjumlahkan view
-- ini, jadi perubahannya terbawa sendiri.
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
),
-- BARU (125): penagihan per-tes per bulan, dari view aturan. TIDAK dikali porsi_kso —
-- barisnya sudah spesifik ke jenis alat, jadi atribusinya langsung ke skema pemilik jenis
-- itu. porsi hanya dipakai untuk kategori 'KSO' yang memang tidak bisa dipecah per alat.
pt AS (
  SELECT account_id, skema, periode, sum(nilai_netto) AS revenue_netto
  FROM kso_penagihan_tes_v
  GROUP BY account_id, skema, periode
),
rev_all AS (
  SELECT COALESCE(k.account_id, p.account_id) AS account_id,
         COALESCE(k.skema, p.skema)           AS skema,
         COALESCE(k.periode, p.periode)       AS periode,
         -- CASE, bukan COALESCE(a,0)+COALESCE(b,0): kalau KEDUANYA NULL hasilnya harus
         -- tetap NULL. Lihat catatan NULL di kepala berkas.
         CASE WHEN k.revenue_netto IS NULL AND p.revenue_netto IS NULL THEN NULL
              ELSE COALESCE(k.revenue_netto, 0) + COALESCE(p.revenue_netto, 0)
         END AS revenue_netto
  FROM rev k
  FULL JOIN pt p
    ON p.account_id = k.account_id AND p.skema = k.skema AND p.periode = k.periode
)
-- FULL JOIN, bukan LEFT: bulan yang punya faktur tapi belum ada laporan tes (dan
-- sebaliknya) tetap muncul.
SELECT COALESCE(t.account_id, rv.account_id) AS account_id,
       COALESCE(t.skema, rv.skema)           AS skema,
       COALESCE(t.periode, rv.periode)       AS periode,
       t.jumlah_tes,
       t.alat_lapor,
       rv.revenue_netto
FROM tes t
FULL JOIN rev_all rv
  ON rv.account_id = t.account_id AND rv.skema = t.skema AND rv.periode = t.periode;

COMMENT ON VIEW kso_faskes_tren_v IS
  'Tren KSO per FASKES per bulan per skema — sumber tunggal; kso_tren_bulanan_v menjumlahkannya. Sejak 125 revenue_netto memuat penagihan per-tes (kso_penagihan_tes_v), sepadan dengan kartu di kso_asset_produktivitas_v. jumlah_tes NULL = bulan itu tidak ada laporan tes, BUKAN nol tes.';
