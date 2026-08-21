-- 113 — pecah revenue KSO per JENIS ALAT, lengkap dengan pagar cakupan laporan.
--
-- Sampai sekarang revenue KSO cuma bisa dilihat per faskes (kso_asset_produktivitas_v)
-- dan per skema. Pertanyaan "alat jenis apa yang menghasilkan berapa per tes" tidak bisa
-- dijawab, karena tidak ada yang menghubungkan BARIS FAKTUR ke jenis alat.
--
-- ── KENAPA MEREK ITEM TIDAK BISA DIPAKAI (diukur, bukan diduga) ────────────────────
-- Godaan pertamanya: cocokkan merek reagen ke merek mesin. Itu SALAH, dan salahnya
-- besar. Diukur di prod 2026-08-19 atas faktur yang konteks mesinnya tunggal:
--
--     mesin WIENERLAB CM250  ->  reagen ZYBIO Rp 1.113 jt  vs  WIENERLAB Rp 44 jt
--     mesin PICTUS 400       ->  reagen ZYBIO Rp   710 jt  vs  WIENERLAB Rp 38 jt
--     mesin METROLAB 2300    ->  reagen ZYBIO Rp   194 jt  vs  WIENERLAB Rp 22 jt
--
-- 96% reagen bermerek yang masuk ke mesin Wienerlab justru Zybio. Dari seluruh nilai yang
-- kedua mereknya bisa dinilai, 36,6% masuk ke mesin BEDA MEREK. Jadi merek reagen nyaris
-- tidak memberi tahu apa pun tentang mesinnya.
--
-- Yang STABIL adalah JENISNYA: reagen kimia tetap masuk analyzer kimia, apa pun mereknya.
-- Karena itu yang dipetakan jenis alat, bukan merek.
--
-- ── SUMBER BUKTI, BERURUT DARI YANG PALING KUAT ────────────────────────────────────
-- 1. KONTEKS FAKTUR. Ada 45 item bernama 'PEMERIKSAAN <JENIS> <MEREK MODEL>' — jenisnya
--    tertulis di nama item itu sendiri. 985 faktur memuat TEPAT SATU jenis semacam itu,
--    jadi baris reagen di faktur yang sama terikat ke jenis tersebut. Basis: 169 item.
-- 2. CUSTOMER BERALAT TUNGGAL. 109 dari 191 customer KSO cuma punya satu jenis alat, jadi
--    belanjanya tidak ambigu. Ini menambal item yang tak pernah muncul di faktur ber-
--    PEMERIKSAAN. LEBIH LEMAH dan sengaja diberi prioritas lebih rendah: "tunggal" itu
--    tunggal menurut aset KSO — faskesnya masih bisa punya alat non-KSO. Bukti nyatanya:
--    tanpa koreksi, 'I-SMART CARTRIDGE ELECTROLYTE' jatuh ke Coagulasi dan 'MITRA BLOOD
--    BAG' ke Immunology.
-- 3. NAMA ITEM SENDIRI (aturan di bawah). Kalau nama item menyebut analit atau mesinnya,
--    itu bukti LANGSUNG dan menang atas dua sinyal di atas — co-occurrence cuma korelasi
--    tempat. Ini yang membetulkan kasus-kasus seperti I-SMART ELECTROLYTE di atas.
--
-- ── YANG SENGAJA TIDAK DIBEBANKAN KE ALAT MANA PUN ─────────────────────────────────
-- 83 item (Rp 1.066 jt, 5,9% nilai) bukan reagen mesin: tabung/tip/cup/object glass,
-- pewarnaan manual (Gram, Wright, lugol), dan rapid test kartu baca-mata. Kalau dibiarkan
-- terbebankan, Rp/tes naik semu dan naiknya TIDAK RATA — jadi peringkat antar-jenis ikut
-- bergeser. Mereka tetap muncul di view dengan jenis_alat_nyata = false supaya jumlahnya
-- tetap rekonsiliasi, bukan dibuang diam-diam.

-- ── Kamar koreksi manual ───────────────────────────────────────────────────────────
-- Aturan regex di bawah menangani pola; tabel ini untuk item satuan yang polanya tidak
-- bisa menangkapnya. Prioritasnya PALING TINGGI, di atas semua bukti dan aturan.
CREATE TABLE IF NOT EXISTS kso_item_jenis_override (
  item_id bigint PRIMARY KEY REFERENCES accurate_item(id) ON DELETE CASCADE,
  jenis   text   NOT NULL,
  catatan text,
  dibuat  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE kso_item_jenis_override IS
  'Koreksi manual per item untuk peta item->jenis alat. Menang atas semua bukti otomatis maupun aturan nama. Sengaja kosong saat dibuat: dipakai hanya kalau aturan pola di 113 tidak bisa menangkap kasusnya.';

-- ── 1) Item PEMERIKSAAN: jenis alat tertulis di namanya ────────────────────────────
CREATE OR REPLACE VIEW kso_item_pemeriksaan_v AS
SELECT it.id AS item_id, it.name,
  CASE
    WHEN it.name ILIKE '%HEMATOLOGY 3DIFF%'      THEN 'Hematology 3Diff'
    WHEN it.name ILIKE '%HEMATOLOGY 5DIFF%'      THEN 'Hematology 5Diff'
    -- Analyzer & Semi sudah disatukan jadi 'Kimia Klinik' oleh 112: faktur tidak menyebut
    -- mesin mana yang memakai reagennya, jadi memisahkannya menghasilkan artefak.
    WHEN it.name ILIKE '%KIMIA KLINIK%'          THEN 'Kimia Klinik'
    WHEN it.name ILIKE '%POCT IMMUNOLOGY%'       THEN 'POCT IMMUNOLOGY'
    WHEN it.name ILIKE '%POCT CLOVER%'           THEN 'POCT Clover'
    WHEN it.name ILIKE '%ELECTROLYTE%'           THEN 'Elektrolite'
    WHEN it.name ILIKE '%COAGULASI%'
      OR it.name ILIKE '%TROMBOTRACK%'           THEN 'Coagulasi'
    WHEN it.name ILIKE '%BLOODGAS%'              THEN 'BGA'
    WHEN it.name ILIKE '%BDRS%'                  THEN 'BDRS'
    WHEN it.name ILIKE '%HEMODIALIS%'            THEN 'Hemodialisa'
    WHEN it.name ILIKE '%IMMUNOLOGY%'            THEN 'Immunology'
    WHEN it.name ILIKE '%URINALYZER%'            THEN 'URINALYZER'
    WHEN it.name ILIKE '%LED%'                   THEN 'LED'
    WHEN it.name ILIKE '%GLUCOSE%'
      OR it.name ILIKE '%GCU%'                   THEN 'POCT'
  END AS jenis
FROM accurate_item it
WHERE it.name ILIKE 'PEMERIKSAAN%';

COMMENT ON VIEW kso_item_pemeriksaan_v IS
  'Item pencatat tes (PEMERIKSAAN <jenis> <merek model>) beserta jenis alat yang tertulis di namanya. Dipakai sbg jangkar konteks mesin di tiap faktur. jenis NULL = nama tidak mengandung jenis yang dikenali; periksa kalau muncul.';

-- ── 2) Aturan nama item (bukti langsung, menang atas co-occurrence) ────────────────
CREATE OR REPLACE VIEW kso_item_aturan_nama_v AS
SELECT it.id AS item_id,
  CASE
    -- (a) habis pakai / alat bantu / jasa: tidak terikat mesin mana pun
    WHEN it.name ~* '(BLUE|YELLOW) TIP|SAMPLE CUP|OBJECT GLASS|COVER GLASS|TABUNG REAKSI'
      OR it.name ~* 'CENTRIFUGE TUBE|POT URINE|LANCET|ALKOHOL SWAB|PLESTERIN|SEDIPLAS'
      OR it.name ~* 'AQUADES|AQUABIDES|CHLORINE|ENDO THERMAL|BIAYA KIRIM|TUBE SEALER'
      OR it.name ~* 'VACUM|VACUUM|VACULLAB|K3 EDTA|NA CITRAT|CLOT ACTIVATOR|BLOOD COLLECTION'
      OR it.name ~* 'KARTU GOLONGAN DARAH'                      THEN 'UMUM habis pakai'
    -- (b) pewarnaan & reagen manual (mikroskopis/tabung), bukan mesin
    WHEN it.name ~* '\m(IR|MERCK)\M.*(WRIGHT|GRAM|LUGOL|SAFRANIN|MDT|GENTIAN|BUFFER|HEMOGLOBIN|EDTA 10)'
                                                                THEN 'MANUAL pewarnaan'
    -- (c) rapid test kartu/strip baca-mata
    WHEN it.name ~* 'WIDAL|VDRL|TYPHIDOT|MALARIA|SYPHILIS (CARD|STRIP|3\.0)|HBS ?AG (CARD|STRIP|RAPID)'
      OR it.name ~* 'HCV CARD|HIV (CARD|TRILINE|1/2)|TES KEHAMILAN|HCG RAPID|TROPONIN I \(10T\)'
      OR it.name ~* 'GOLONGAN DARAH [ABD]|FAMILY DR HB|FORA 6|VERI-Q|MULTI LIPID'
                                                                THEN 'MANUAL rapid test'
    -- (d) nama item menyebut analit / mesinnya sendiri
    WHEN it.name ~* '5 ?DIFF'                                   THEN 'Hematology 5Diff'
    WHEN it.name ~* '3 ?DIFF'                                   THEN 'Hematology 3Diff'
    WHEN it.name ~* 'I-SMART.*ELECTROLYTE|CORNLEY|K-?LITE|EC90|ERBA CARTRIDGE ELECTROLYTE'
                                                                THEN 'Elektrolite'
    WHEN it.name ~* 'TCOAG|T-COAG|PROTIME|ACTIME|CALCIUM CHLORIDE|APTT|\mPT\M'
                                                                THEN 'Coagulasi'
    WHEN it.name ~* 'BLOOD GAS|\mBGA\M'                         THEN 'BGA'
    WHEN it.name ~* 'BLOOD BAG|REDCELL'                         THEN 'BDRS'
    WHEN it.name ~* 'URIN.*(STRIP|CALIBRATOR|CONTROL)|URINALISYS'
                                                                THEN 'URINALYZER'
    WHEN it.name ~* 'KONSUNG'                                   THEN 'Kimia Klinik'
    WHEN it.name ~* 'WONDFO (PCT|HSCRP|TEST CARD)|FIA METER'    THEN 'POCT IMMUNOLOGY'
    WHEN it.name ~* 'XPER GLUCOSE'                              THEN 'POCT'
    WHEN it.name ~* 'LABNOVATION|PENGULANGAN HEMATOLOGY|NIHON (CLEANAC|ISOTONAC|HEMOLINAC)'
                                                                THEN 'Hematology (3Diff & 5Diff)'
  END AS jenis
FROM accurate_item it;

COMMENT ON VIEW kso_item_aturan_nama_v IS
  'Aturan berbasis NAMA item. Dua kelas: penyempitan (menunjuk satu jenis, berlaku di semua mutu bukti) dan pelebaran (label "A & B" = pengakuan ambigu, hanya dipakai kalau bukti otomatisnya lemah). Merek reagen SENGAJA bukan dasar aturan — 36,6% nilai masuk ke mesin beda merek.';

-- ── 3) Peta item -> jenis alat ─────────────────────────────────────────────────────
-- DITURUNKAN, BUKAN DIDAFTAR. Alternatifnya menuliskan ~292 nama produk sebagai seed;
-- itu ditolak karena dua hal: repo ini PUBLIK, dan daftar tetap akan basi diam-diam
-- begitu katalog bertambah. Bentuk ini mengklasifikasi item baru dengan sendirinya, dan
-- yang tertulis di sini cuma ATURAN-nya — yang memang perlu ditinjau manusia.
CREATE OR REPLACE VIEW kso_item_jenis_v AS
WITH konteks AS (  -- faktur yang baris PEMERIKSAAN-nya menunjuk TEPAT SATU jenis
  SELECT ii.invoice_id, min(p.jenis) AS jenis
  FROM accurate_invoice_item ii
  JOIN kso_item_pemeriksaan_v p ON p.item_id = ii.item_id AND p.jenis IS NOT NULL
  GROUP BY ii.invoice_id HAVING count(DISTINCT p.jenis) = 1
),
kamar AS (  -- customer yang seluruh aset KSO-nya satu jenis
  SELECT a.account_id, min(kso_jenis_kanonik(a.type_alat)) AS jenis
  FROM kso_asset a WHERE a.account_id IS NOT NULL
  GROUP BY a.account_id HAVING count(DISTINCT kso_jenis_kanonik(a.type_alat)) = 1
),
bukti AS (
  SELECT ii.item_id, k.jenis, i.customer_id, 1 AS prio
  FROM accurate_invoice_item ii
  JOIN konteks k ON k.invoice_id = ii.invoice_id
  JOIN accurate_invoice i ON i.id = ii.invoice_id
  WHERE ii.item_id NOT IN (SELECT item_id FROM kso_item_pemeriksaan_v)
  UNION ALL
  SELECT ii.item_id, km.jenis, i.customer_id, 2
  FROM accurate_invoice_item ii
  JOIN accurate_invoice i ON i.id = ii.invoice_id
  JOIN kamar km ON km.account_id = i.customer_id
  WHERE ii.item_id NOT IN (SELECT item_id FROM kso_item_pemeriksaan_v)
),
per AS (SELECT item_id, prio, jenis, count(*) AS baris,
               count(DISTINCT customer_id) AS cust FROM bukti GROUP BY 1,2,3),
-- bukti faktur (prio 1) selalu mengalahkan bukti customer (prio 2), tidak dicampur
terkuat AS (SELECT item_id, min(prio) AS prio FROM per GROUP BY 1),
kandidat AS (SELECT per.* FROM per JOIN terkuat USING (item_id, prio)),
skor AS (
  SELECT k.*, sum(baris) OVER (PARTITION BY item_id) AS baris_item,
         count(*)   OVER (PARTITION BY item_id) AS n_jenis,
         row_number() OVER (PARTITION BY item_id ORDER BY baris DESC, cust DESC) AS rn
  FROM kandidat k
),
otomatis AS (
  SELECT item_id, jenis, prio, cust, n_jenis,
         round(100.0*baris/baris_item) AS persen_dominan,
         CASE WHEN prio=1 AND n_jenis=1 AND cust>=3                     THEN 'A'
              WHEN prio=1 AND (n_jenis=1 OR baris::numeric/baris_item>=0.8) THEN 'B'
              WHEN prio=2 AND (n_jenis=1 OR baris::numeric/baris_item>=0.8) THEN 'C'
              ELSE 'D' END AS mutu
  FROM skor WHERE rn = 1
)
SELECT o.item_id,
       -- Urutan kemenangan: koreksi manual > aturan nama > bukti otomatis.
       -- Aturan PELEBARAN ('A & B') adalah pengakuan ambigu, jadi hanya boleh dipakai
       -- kalau bukti otomatisnya memang lemah (mutu D). Tanpa pagar ini ia menggerus
       -- bukti kuat: 'LABNOVATION LYSE WBC 5 DIFF' pernah dilebarkan jadi '3Diff & 5Diff'
       -- padahal namanya sendiri sudah menyebut 5 DIFF.
       COALESCE(ov.jenis,
                CASE WHEN an.jenis IS NOT NULL
                       AND (an.jenis NOT LIKE '%&%' OR o.mutu = 'D')
                     THEN an.jenis END,
                o.jenis) AS jenis,
       CASE WHEN ov.jenis IS NOT NULL THEN 'koreksi manual'
            WHEN an.jenis IS NOT NULL AND (an.jenis NOT LIKE '%&%' OR o.mutu='D')
                 THEN 'aturan nama'
            WHEN o.prio = 1 THEN 'bukti faktur' ELSE 'bukti customer' END AS sumber,
       o.mutu AS mutu_bukti, o.jenis AS jenis_bukti, o.cust AS customer_bukti,
       o.n_jenis AS jenis_terlihat, o.persen_dominan
FROM otomatis o
LEFT JOIN kso_item_jenis_override ov ON ov.item_id = o.item_id
LEFT JOIN kso_item_aturan_nama_v  an ON an.item_id = o.item_id;

COMMENT ON VIEW kso_item_jenis_v IS
  'Peta item Accurate -> jenis alat KSO, DITURUNKAN dari bukti + aturan nama (bukan daftar hardcode). mutu_bukti: A=bukti faktur >=3 customer tanpa konflik, B=bukti faktur, C=bukti customer beralat tunggal (LEBIH LEMAH: faskes bisa punya alat non-KSO), D=lintas jenis. jenis yang memuat "&" = item memang dipakai dua jenis bertetangga. jenis "UMUM"/"MANUAL" = bukan reagen mesin, jangan dibebankan ke alat.';

-- ── 4) Jenis gabungan: item yang memang dipakai dua jenis bertetangga ──────────────
-- Tabel, bukan CTE, dengan alasan yang sama seperti kso_kategori_skema (106/107): kalau
-- daftarnya disalin ke dalam view, ia bisa menyimpang dari label yang dihasilkan
-- kso_item_aturan_nama_v tanpa satu pun error muncul.
CREATE TABLE IF NOT EXISTS kso_jenis_gabungan (
  jenis_gabungan text NOT NULL,
  jenis_anggota  text NOT NULL,
  PRIMARY KEY (jenis_gabungan, jenis_anggota)
);
COMMENT ON TABLE kso_jenis_gabungan IS
  'Label jenis gabungan (mis. reagen hematologi Labnovation yang dipakai 3Diff maupun 5Diff) beserta anggotanya. Nilai jenis_gabungan HARUS sama persis dengan label yang dihasilkan kso_item_aturan_nama_v; kalau tidak, revenue-nya tidak akan terpecah dan tersangkut di label gabungan.';
INSERT INTO kso_jenis_gabungan (jenis_gabungan, jenis_anggota) VALUES
  ('Hematology (3Diff & 5Diff)', 'Hematology 3Diff'),
  ('Hematology (3Diff & 5Diff)', 'Hematology 5Diff')
ON CONFLICT DO NOTHING;

-- ── 5) Revenue netto per customer x periode x jenis alat ───────────────────────────
-- ALOKASI PER BARIS, bukan per faktur. Faktur campur itu nyata: satu faktur bisa memuat
-- reagen hematologi, reagen kimia, dan tabung sekaligus. Netto faktur dibagi ke tiap
-- baris sesuai porsi nilainya, jadi Σ seluruh view = total netto faktur, persis.
-- Mekanismenya sama dengan kso_customer_revenue_v (098) — kalau diganti jadi "faktur ini
-- jenis X", total per jenis akan melebihi total revenue tanpa ada yang gagal.
--
-- BASIS NETTO TANPA PPN (total - tax_amount), konsisten dgn seluruh Sales Analytics.
CREATE OR REPLACE VIEW kso_revenue_jenis_v AS
WITH inv AS (
  SELECT i.id, i.customer_id, date_trunc('month', i.tanggal)::date AS periode,
         (i.total - COALESCE(i.tax_amount,0))::numeric AS netto
  FROM accurate_invoice i WHERE i.customer_id IS NOT NULL AND i.tanggal IS NOT NULL
),
lin AS (
  SELECT inv.id, inv.customer_id, inv.periode, inv.netto,
         COALESCE(m.jenis, 'TAK TERPETAKAN') AS jenis,
         COALESCE(NULLIF(ii.raw->>'charField1',''), 'Tanpa kategori') AS kategori,
         GREATEST(ii.total, 0) AS w
  FROM inv JOIN accurate_invoice_item ii ON ii.invoice_id = inv.id
  LEFT JOIN kso_item_jenis_v m ON m.item_id = ii.item_id
),
alokasi AS (
  SELECT customer_id, periode, jenis, kategori,
         sum(CASE WHEN wsum > 0 THEN netto * w / wsum ELSE netto / cnt END) AS rev
  FROM (SELECT lin.*, sum(w) OVER (PARTITION BY id) AS wsum,
               count(*) OVER (PARTITION BY id) AS cnt FROM lin) x
  GROUP BY 1,2,3,4
),
-- Porsi pemecahan label gabungan, per CUSTOMER: dibagi menurut jumlah tes anggotanya di
-- customer itu. Customer yang cuma punya satu anggota otomatis dapat porsi 1.
porsi AS (
  SELECT g.jenis_gabungan, g.jenis_anggota, t.account_id,
         t.tes::numeric / NULLIF(sum(t.tes) OVER (PARTITION BY g.jenis_gabungan, t.account_id), 0) AS porsi
  FROM kso_jenis_gabungan g
  JOIN (SELECT a.account_id, kso_jenis_kanonik(a.type_alat) AS jenis,
               COALESCE(sum(m.jumlah_tes),0) AS tes
        FROM kso_asset a LEFT JOIN kso_asset_test_monthly m ON m.asset_id = a.id
        WHERE a.account_id IS NOT NULL
        GROUP BY 1,2) t ON t.jenis = g.jenis_anggota
)
-- baris biasa
SELECT a.customer_id AS account_id, a.periode, a.jenis, a.kategori, a.rev AS revenue_netto
FROM alokasi a
WHERE a.jenis NOT IN (SELECT jenis_gabungan FROM kso_jenis_gabungan)
UNION ALL
-- baris gabungan yang BISA dipecah di customer itu
SELECT a.customer_id, a.periode, p.jenis_anggota, a.kategori, a.rev * p.porsi
FROM alokasi a
JOIN porsi p ON p.jenis_gabungan = a.jenis AND p.account_id = a.customer_id AND p.porsi IS NOT NULL
UNION ALL
-- baris gabungan yang TIDAK bisa dipecah (customer tak punya alat anggotanya / nol tes):
-- labelnya DIPERTAHANKAN, tidak dilempar ke salah satu anggota. Melemparkannya akan
-- menaikkan Rp/tes jenis itu dgn revenue yang belum tentu miliknya.
SELECT a.customer_id, a.periode, a.jenis, a.kategori, a.rev
FROM alokasi a
WHERE a.jenis IN (SELECT jenis_gabungan FROM kso_jenis_gabungan)
  AND NOT EXISTS (SELECT 1 FROM porsi p
                  WHERE p.jenis_gabungan = a.jenis AND p.account_id = a.customer_id
                    AND p.porsi IS NOT NULL);

COMMENT ON VIEW kso_revenue_jenis_v IS
  'Revenue netto (tanpa PPN) per customer Accurate x bulan x JENIS ALAT x kategori pengadaan, teralokasi proporsional per baris faktur sehingga Σ = total netto faktur. Jenis dari kso_item_jenis_v. Label gabungan dipecah menurut porsi tes di customer ybs; yang tak bisa dipecah tetap berlabel gabungan (bukan dilempar ke salah satu). jenis UMUM/MANUAL/TAK TERPETAKAN = bukan revenue alat.';

-- ── 6) Ringkasan per jenis alat + PAGAR CAKUPAN LAPORAN ────────────────────────────
-- KOLOM CAKUPAN LAPORAN ITU WAJIB, BUKAN PELENGKAP. Rp/tes per jenis paling gampang
-- salah dibaca lewat PENYEBUTNYA, dan pada data prod 2026-08-19 itu sudah terjadi:
--
--     LED          Rp 354.710/tes   <- 11 dari 23 alat melapor, 705 tes utk 8 bulan
--     POCT Clover  Rp 155.949/tes   <- 45 dari 92 alat melapor
--     Hemodialisa  tak terhitung    <- 0 dari 38 alat melapor, revenue Rp 530 jt
--
-- Angka-angka itu BUKAN temuan produktivitas, melainkan laporan tes yang bolong. Tanpa
-- kolom cakupan, ketiganya akan terbaca sebagai jenis alat paling menguntungkan — dan
-- tidak ada total yang gagal rekonsiliasi untuk menandainya. Ini keluarga yang sama
-- dengan basis_tes_memadai (100), tapi berbeda lapisan: pagar 100 menjaga penyebut PER
-- ASET, pagar ini menjaga penyebut PER JENIS. Hemodialisa lolos pagar 100 tanpa masalah
-- dan tetap menghasilkan Rp/tes yang tak bermakna.
--
-- Flag di-COALESCE supaya TIDAK PERNAH NULL: flag NULL lolos dari `WHERE flag` maupun
-- `WHERE NOT flag`, jadi barisnya hilang diam-diam dari dua-duanya (pelajaran migrasi 105).
CREATE OR REPLACE VIEW kso_jenis_ringkas_v AS
WITH jendela AS (  -- irisan periode kedua sumber, digeser 1 bln (faktur bln M = tes bln M-1)
  SELECT (date_trunc('month', min(tanggal)) - interval '1 month')::date AS dari,
         (date_trunc('month', max(tanggal)) - interval '1 month')::date AS sampai
  FROM accurate_invoice WHERE tanggal IS NOT NULL
),
populasi AS (
  SELECT kso_jenis_kanonik(a.type_alat) AS jenis,
         count(*)::int AS aset_total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM kso_asset_test_monthly m CROSS JOIN jendela j
           WHERE m.asset_id = a.id AND m.periode BETWEEN j.dari AND j.sampai))::int AS aset_melapor,
         count(DISTINCT a.account_id)::int AS customer
  FROM kso_asset a WHERE a.account_id IS NOT NULL
  GROUP BY 1
),
tes AS (
  SELECT kso_jenis_kanonik(a.type_alat) AS jenis, sum(m.jumlah_tes)::bigint AS tes
  FROM kso_asset a JOIN kso_asset_test_monthly m ON m.asset_id = a.id
  CROSS JOIN jendela j
  WHERE a.account_id IS NOT NULL AND m.periode BETWEEN j.dari AND j.sampai
  GROUP BY 1
),
rev AS (
  SELECT r.jenis, sum(r.revenue_netto) AS revenue_netto
  FROM kso_revenue_jenis_v r
  JOIN (SELECT DISTINCT account_id FROM kso_asset WHERE account_id IS NOT NULL) k
    ON k.account_id = r.account_id
  CROSS JOIN jendela j
  WHERE r.kategori IN (SELECT kategori FROM kso_kategori_skema)
    AND (r.periode - interval '1 month')::date BETWEEN j.dari AND j.sampai
  GROUP BY 1
)
SELECT COALESCE(p.jenis, rev.jenis) AS jenis,
       p.aset_total, p.aset_melapor,
       CASE WHEN p.aset_total > 0
            THEN round(p.aset_melapor::numeric / p.aset_total, 3) END AS rasio_lapor,
       p.customer, t.tes, rev.revenue_netto,
       CASE WHEN t.tes > 0 AND rev.revenue_netto IS NOT NULL
            THEN round(rev.revenue_netto / t.tes, 2) END AS rupiah_per_tes,
       -- PAGAR: false = penyebutnya bolong, JANGAN pakai rupiah_per_tes untuk memeringkat.
       COALESCE(p.aset_total > 0 AND p.aset_melapor::numeric / p.aset_total >= 0.8, false)
         AS cakupan_lapor_memadai,
       -- false = baris ini bukan jenis alat (habis pakai, manual, belum terpetakan).
       -- Tetap ditampilkan supaya jumlahnya rekonsiliasi, bukan dibuang diam-diam.
       COALESCE(p.jenis IS NOT NULL, false) AS jenis_alat_nyata,
       (SELECT dari FROM jendela) AS periode_dari,
       (SELECT sampai FROM jendela) AS periode_sampai
FROM populasi p
FULL JOIN rev ON rev.jenis = p.jenis
LEFT JOIN tes t ON t.jenis = p.jenis;

COMMENT ON VIEW kso_jenis_ringkas_v IS
  'Ringkasan KSO per jenis alat: populasi, cakupan laporan tes, jumlah tes, revenue netto, dan Rp/tes — dibatasi irisan periode kedua sumber dgn jeda tagih 1 bulan. JANGAN memeringkat dengan rupiah_per_tes tanpa memfilter cakupan_lapor_memadai = true: pada data 2026-08-19, LED (11/23 alat melapor) dan POCT Clover (45/92) menghasilkan Rp/tes tertinggi semata karena penyebutnya bolong, dan Hemodialisa 0/38 punya revenue Rp 530 jt tanpa satu pun laporan tes. jenis_alat_nyata = false berarti baris itu belanja non-alat (UMUM/MANUAL) atau item yang belum terpetakan.';
