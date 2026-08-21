-- 123 — item PEMERIKSAAN ikut dipetakan ke jenis alat.
--
-- CACAT DI 113, terlihat dari layar: baris "PEMERIKSAAN HEMATOLOGY 5DIFF ZYBIO Z52"
-- (HMG.0198) tampil "jenis alat belum terpetakan" di dialog detail — padahal jenisnya
-- tertulis di namanya, dan `kso_item_pemeriksaan_v` sudah mengenalinya sebagai
-- 'Hematology 5Diff'.
--
-- SEBABNYA, dan logikanya bisa dimengerti: kedua cabang bukti di 113 mengecualikan item
-- PEMERIKSAAN —
--     WHERE ii.item_id NOT IN (SELECT item_id FROM kso_item_pemeriksaan_v)
-- karena item itu dipakai sebagai JANGKAR yang menetapkan konteks mesin sebuah faktur.
-- Menebak jenisnya dari konteks yang ia tetapkan sendiri memang sirkular.
--
-- Tapi pengecualian itu kebablasan: item jangkar jadi tidak punya baris SAMA SEKALI di
-- peta, padahal jenisnya tidak perlu ditebak. Yang benar bukan mengeluarkannya dari
-- co-occurrence, melainkan memberinya jalur sendiri: nama item = bukti LANGSUNG.
--
-- KENAPA INI BUKAN SOAL LABEL KOSONG DI SATU KOLOM: item PEMERIKSAAN adalah pencatat
-- PENAGIHAN TES — di skema PER_TEST justru sumber pendapatan utamanya, dan nilainya
-- besar. Selama tak terpetakan, seluruh nilainya jatuh ke 'TAK TERPETAKAN' di
-- kso_revenue_jenis_v; angka revenue per jenis alat kekurangan tepat pada bagian yang
-- paling pasti asalnya.
--
-- DITURUNKAN MEKANIS DARI 113, bukan ditulis ulang: blok CREATE VIEW disalin apa adanya,
-- lalu tiga sisipan — cabang prio 0, mutu 'A' untuk prio 0, dan label sumbernya. Urutan
-- kemenangan lain (override > aturan nama > bukti otomatis) dan seluruh kolom diagnostik
-- tetap utuh.
--
-- Verifikasi setelah apply:
--   SELECT count(*) FROM kso_item_jenis_v m JOIN kso_item_pemeriksaan_v p USING (item_id);
--     -- naik dari 0
--   SELECT round(sum(revenue_netto)) FROM kso_revenue_jenis_v WHERE jenis='TAK TERPETAKAN';
--     -- turun
--   SELECT count(*) FROM kso_faskes_reagen_v WHERE jenis_alat IS NULL;   -- turun

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
  -- prio 0 (migrasi 123): item PEMERIKSAAN, jenis dari NAMANYA SENDIRI — bukti langsung,
  -- bukan co-occurrence, jadi tidak sirkular. TIDAK lewat accurate_invoice_item supaya
  -- item yang belum pernah difakturkan pun tetap terpetakan.
  SELECT p.item_id, p.jenis, NULL::bigint AS customer_id, 0 AS prio
  FROM kso_item_pemeriksaan_v p
  WHERE p.jenis IS NOT NULL
  UNION ALL
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
              -- prio 0 = nama item menyebut jenisnya: mutu tertinggi, tanpa syarat
              -- dominasi (tidak ada kandidat lain untuk dibandingkan). customer_bukti
              -- akan 0 di baris ini — memang, buktinya bukan dari customer mana pun.
              WHEN prio = 0 THEN 'A'
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
            WHEN o.prio = 0 THEN 'nama PEMERIKSAAN'
            WHEN o.prio = 1 THEN 'bukti faktur' ELSE 'bukti customer' END AS sumber,
       o.mutu AS mutu_bukti, o.jenis AS jenis_bukti, o.cust AS customer_bukti,
       o.n_jenis AS jenis_terlihat, o.persen_dominan
FROM otomatis o
LEFT JOIN kso_item_jenis_override ov ON ov.item_id = o.item_id
LEFT JOIN kso_item_aturan_nama_v  an ON an.item_id = o.item_id;

