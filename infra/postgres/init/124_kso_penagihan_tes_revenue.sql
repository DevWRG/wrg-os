-- 124 — penagihan per-tes diakui sebagai revenue KSO (keputusan HoD 2026-08-22).
--
-- MASALAHNYA: item `PEMERIKSAAN <jenis alat> <merek>` mencatat tagihan per tes, tapi
-- charField1-nya SELALU kosong — diperiksa sampai level baris faktur: 1.194 baris,
-- 39 item, NOL pengecualian. Karena revenue skema dihitung dari kategori pengadaan, dan
-- 'Tanpa kategori' bukan anggota kso_kategori_skema, seluruh nilainya tidak pernah masuk
-- basis revenue skema mana pun — jadi tidak terhitung di Rp/tes.
--
-- Rp 553,6 jt, terkonsentrasi di PER_TEST (faskes berskema tunggal: PER_TEST Rp 217 jt,
-- BELI_REAGEN Rp 0 — nol baris berharga).
--
-- ── KENAPA INI DIPUTUSKAN HoD, BUKAN DIPUTUSKAN DI KODE ───────────────────────────
-- Dampak ke Rp/tes agregat cuma ~5-6%, tapi bukan itu alasannya: halaman Produktivitas
-- KSO dipakai MEMERINGKAT faskes, dan peringkatnya tidak stabil terhadap keputusan ini —
-- 66 dari 68 faskes berubah posisi, terbesar 42 posisi (GRATIA Manggarai 60 -> 18).
-- Pergeseran itu mengenai juga faskes yang penagihan tesnya NOL: NUSANTARA MEDIKA UTAMA
-- nilainya nyaris tak berubah (Rp 3.744 -> 3.791/tes) tapi turun 11 posisi karena
-- dilewati yang lain.
--
-- PENGHITUNGAN GANDA: NOL. Sembilan baris yang berdampingan dengan reagen sejenis di
-- bulan sama diperiksa satu per satu — tujuh pendampingnya bahan kontrol mutu &
-- pembersih probe (qty 1, tidak terpakai per tes), dua sisanya reagen habis-pakai yang
-- memang ditagihkan terpisah sebagai KONVENSI, terbukti di 155 dari 177 pasangan
-- faskes x jenis-alat (uji dibatasi ke jenis alat PER_TEST faskes itu sendiri, dengan
-- kontrol/pembersih/kalibrator dikeluarkan).
--
-- ── SASARANNYA ITEM, BUKAN LABEL ──────────────────────────────────────────────────
-- Sengaja TIDAK memasukkan 'Tanpa kategori' ke kso_kategori_skema: label itu memuat
-- Rp 590 jt sementara yang sungguh penagihan tes Rp 553,6 jt, jadi menyapu labelnya ikut
-- menarik ~Rp 36 jt yang bukan. Dan label itu artinya "tidak diisi", bukan "penagihan
-- tes" — mengikat aturan bisnis ke ketiadaan data akan salah lagi begitu ada item lain
-- yang kebetulan tak berkategori.
--
-- Juga TIDAK meminta tim faktur mengisi charField1 untuk 1.194 baris: konvensinya
-- konsisten bertahun-tahun dan sesuai peran item itu — 877 dari 1.145 barisnya bernilai
-- nol karena fungsinya mencatat KUANTITAS, bukan penjualan.
--
-- ── YANG BERUBAH DI LAYAR ─────────────────────────────────────────────────────────
-- revenue_netto_customer, rupiah_per_tes_customer, dan PERINGKAT di tabel Produktivitas
-- KSO. Angka Rp/tes historis di deck/laporan yang sudah beredar tidak akan cocok lagi
-- dengan layar — itu konsekuensi yang disengaja, bukan galat.
--
-- Diturunkan MEKANIS dari 122 (definisi view terakhir): blok CREATE VIEW disalin, CTE
-- `rev` dibungkus supaya bisa dijumlahkan dengan CTE `penagihan_tes` yang baru. Sisanya
-- utuh, termasuk porsi presisi 12 desimal (122) dan porsi berbasis reagen (121).

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
  SELECT r.account_id, a.skema, sum(r.nilai_netto) AS revenue_netto
  FROM kso_faskes_reagen_v r
  JOIN kso_item_jenis_v m ON m.item_id = r.item_id
  -- Jenis alat yang tertulis di nama item harus BENAR-BENAR dimiliki faskes itu pada
  -- skema tersebut. Tanpa syarat ini, tagihan tes untuk alat yang bukan miliknya ikut
  -- terhitung — dan justru ke sisi yang salah.
  -- DISTINCT (account, jenis, skema), BUKAN join langsung ke kso_asset: satu faskes bisa
  -- punya BEBERAPA alat berjenis sama, dan join per-aset menggandakan nilai reagennya
  -- sebanyak jumlah alat. Terukur di uji dev: Rp 6,84 jt menjadi Rp 20,52 jt (3 alat
  -- Hematology 5Diff). Penggandaan seperti ini tidak memunculkan error apa pun — yang
  -- terlihat cuma revenue yang membengkak.
  JOIN (SELECT DISTINCT account_id, kso_jenis_kanonik(type_alat) AS jenis, skema
        FROM kso_asset
        WHERE account_id IS NOT NULL AND skema IN ('PER_TEST','BELI_REAGEN')) a
    ON a.account_id = r.account_id AND a.jenis = m.jenis
  WHERE r.item_id IN (SELECT item_id FROM kso_item_pemeriksaan_v)
  GROUP BY r.account_id, a.skema
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
