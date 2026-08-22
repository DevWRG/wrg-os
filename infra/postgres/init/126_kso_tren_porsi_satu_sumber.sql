-- 126 — `kso_faskes_tren_v` berhenti menghitung porsi sendiri.
--
-- CACAT INI MILIK SAYA, dan bentuknya persis yang sedang saya kutip. Migrasi 125
-- menuliskan di komentarnya sendiri: "blok `tes_aset`, `porsi`, `tes`, dan `rev` disalin
-- APA ADANYA dari 111" — sementara di kepala berkas yang SAMA mengutip pelajaran 107 dan
-- 111 tentang tidak menyalin aturan. Menyalin blok porsi adalah tepat hal yang dilarang
-- oleh pelajaran yang dikutipnya.
--
-- AKIBATNYA, terukur di prod 2026-08-22: Σ grafik Rp 10.479.826.741 vs Σ kartu
-- Rp 11.120.240.234 — selisih Rp 640.413.493 pada 3 dari 75 faskes:
--
--   NGUDI WALUYO WLINGI   kartu 675.215.100   grafik           0   (+675.215.100)
--   AISYIYAH Bojonegoro   kartu 410.986.156   grafik 416.218.438   (  -5.232.282)
--   SYMPONI DANARIEVA     kartu   8.271.855   grafik  37.841.181   ( -29.569.326)
--
-- Ketiganya persis faskes yang migrasi 121 sentuh. 121 mengganti aturan porsi untuk faskes
-- yang salah satu sisinya nol tes (pakai porsi berbasis REAGEN, bukan tes) — tapi hanya di
-- `kso_asset_produktivitas_v`. Salinan di `kso_faskes_tren_v` tetap memakai aturan lama
-- (proporsional jumlah tes), jadi NGUDI WALUYO mendapat 189/(189+0) = seluruhnya ke
-- BELI_REAGEN dan sisi PER_TEST-nya nol — angka yang 121 justru ada untuk memperbaiki.
--
-- KEJADIAN KETIGA DARI POLA YANG SAMA: 107 (aturan atribusi disalin ke tiap migrasi),
-- #998 (repo TS menurunkan porsi sendiri, pecah dalam SEHARI saat 121 masuk), sekarang
-- ini. Gejalanya selalu sama: satu aturan, dua sumber, TIDAK ADA ERROR saat menyimpang —
-- yang terlihat cuma dua angka berbeda, dan cuma kalau ada yang membandingkannya.
--
-- ── SISIRAN: TIDAK ADA SALINAN KEEMPAT ────────────────────────────────────────────
-- Seluruh view di public disisir untuk pola porsi:
--   kso_asset_produktivitas_v   baca kso_porsi_reagen_v (121)   -> benar
--   kso_faskes_tren_v           salinan sendiri                 -> DIPERBAIKI DI SINI
--   kso_porsi_reagen_v          sumbernya                       -> n/a
--   kso_revenue_jenis_v         porsi KONSEP LAIN (tes/Σtes per JENIS ALAT dalam satu
--                               customer, bukan antar skema)     -> bukan salinan
-- Kode TS/JS: nol yang menghitung porsi sendiri (#998 tidak kembali).
--
-- ── KENAPA MEMBACA `kso_asset_produktivitas_v`, BUKAN VIEW PORSI BARU ────────────
-- Yang paling rapi adalah `kso_porsi_skema_v` kanonik yang DIBACA kedua view. Itu berarti
-- mendefinisikan ulang `kso_asset_produktivitas_v` (235 baris) untuk ketiga kalinya dalam
-- satu hari, pada view yang baru dirilis 3x — risiko regresi yang tidak dibayar oleh
-- kerapian. Jadi arahnya dibalik: view produktivitas menjadi SATU-SATUNYA pemilik aturan
-- porsi, dan tren membacanya. Duplikasinya tetap nol, yang berubah cuma siapa pemiliknya.
--
-- Kalau kelak ada alasan lain menyentuh view produktivitas, PINDAHKAN blok porsinya ke
-- view sendiri dan buat keduanya membaca itu.
--
-- Cakupan diverifikasi identik SEBELUM dipakai (bukan diasumsikan): himpunan
-- (account_id, skema) di `kso_asset_produktivitas_v` sama persis dengan himpunan porsi
-- lama — 0 baris selisih di kedua arah — dan `porsi_kso` satu nilai per pasangan
-- (0 pasangan dengan >1 nilai). Tanpa kesamaan itu, perbaikan ini akan menghilangkan
-- baris tren tanpa error.
--
-- `tes_aset` DIHAPUS: CTE itu hanya melayani blok porsi yang kini pergi.
--
-- ── SATU BAHAYA YANG DIPERIKSA, BUKAN DIASUMSIKAN: porsi_kso NULL ────────────────
-- `porsi_kso` di view produktivitas bisa NULL, dan artinya BUKAN "porsi tak diketahui"
-- melainkan "pasangan ini tidak punya revenue berkategori berlaku" (kolomnya lahir dari
-- CTE `rev`, yang tak berbaris bila fakturnya tak ada). Kalau sampai ada pasangan berporsi
-- NULL yang PUNYA faktur kategori 'KSO', maka `revenue_netto * p.porsi_kso` = NULL dan
-- bagian KSO-nya hilang DIAM-DIAM dari grafik — sum() melewati NULL tanpa mengeluh.
--
-- Diuji, bukan disimpulkan:
--   WITH porsi AS (SELECT DISTINCT account_id, skema, porsi_kso FROM kso_asset_produktivitas_v)
--   SELECT count(*) FROM porsi p
--   JOIN kso_kategori_skema ks ON ks.skema = p.skema AND ks.kategori = 'KSO'
--   JOIN kso_customer_revenue_v r ON r.account_id = p.account_id AND r.kategori = 'KSO'
--   WHERE p.porsi_kso IS NULL;                       -- 0
--
-- Sebabnya struktural, jadi tetap 0: begitu sebuah faskes punya faktur 'KSO', CTE `rev`
-- di view produktivitas berbaris dan porsinya terisi. Diverifikasi dengan menyuntik faktur
-- KSO ke faskes yang porsinya NULL (18 aset, nol faktur) — porsi langsung menjadi 1,0 dan
-- kartu = grafik = Rp 30 jt.
--
-- KARENA ITU JOIN biasa, TANPA COALESCE(porsi, 1): kalau invarian itu kelak pecah, yang
-- benar adalah barisnya hilang dan TERLIHAT, bukan diam-diam dianggap "tidak dibagi" —
-- COALESCE ke 1 akan MELEBIHKAN revenue faskes berskema ganda, arah kesalahan yang
-- menguntungkan diri sendiri (pelajaran yang sama dengan migrasi 114).
--
-- Verifikasi setelah apply (prod):
--   SELECT round(sum(revenue_netto)) FROM kso_faskes_tren_v WHERE skema='PER_TEST';
--   SELECT round(sum(revenue_netto_customer)) FROM (
--     SELECT DISTINCT account_id, revenue_netto_customer
--     FROM kso_asset_produktivitas_v WHERE skema='PER_TEST') x;
--   -- HARUS sama. Sebelum 126: beda Rp 640.413.493.

CREATE OR REPLACE VIEW kso_faskes_tren_v AS
WITH porsi AS (
  -- SATU-SATUNYA sumber aturan porsi: view produktivitas (yang membaca kso_porsi_reagen_v
  -- dari 121 dan mengekspos 12 desimal dari 122). DISTINCT karena view itu per-ASET
  -- sementara porsi hidup di level (faskes, skema) — nilainya sama untuk semua aset
  -- seskema, sudah diverifikasi 0 pasangan dengan lebih dari satu nilai.
  SELECT DISTINCT account_id, skema, porsi_kso
  FROM kso_asset_produktivitas_v
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
-- Penagihan per-tes per bulan (125). TIDAK dikali porsi — barisnya sudah spesifik ke
-- jenis alat, jadi atribusinya langsung ke skema pemilik jenis itu.
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
         -- tetap NULL ("tidak ada laporan"), bukan 0 ("dihitung, hasilnya nol").
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
  'Tren KSO per FASKES per bulan per skema — sumber tunggal; kso_tren_bulanan_v menjumlahkannya. Porsi KSO DIBACA dari kso_asset_produktivitas_v (migrasi 126), tidak dihitung di sini: salinan blok porsi pernah menyimpang dari aturan 121 dan membuat Σ grafik beda Rp 640 jt dari Σ kartu. revenue_netto memuat penagihan per-tes (125). jumlah_tes NULL = tidak ada laporan, BUKAN nol tes.';
