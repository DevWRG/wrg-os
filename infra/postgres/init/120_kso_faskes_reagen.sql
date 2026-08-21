-- 120 — reagen yang sudah keluar per faskes: item, qty, dan nilai netto teralokasi.
--
-- Untuk bagian "Reagen keluar" di dialog detail /kso-produktivitas. Sampai sekarang
-- dialog itu hanya bisa menjawab "berapa rupiah masuk"; ini menjawab "rupiah itu untuk
-- reagen apa saja".
--
-- ── KENAPA VIEW, BUKAN QUERY DI TypeScript ────────────────────────────────────────
-- Nilainya WAJIB memakai alokasi proporsional yang sama dengan kso_customer_revenue_v
-- (098) dan kso_revenue_jenis_v (113): netto faktur dibagi ke tiap baris menurut porsi
-- nilai barisnya. Kalau di TS dipakai `sum(ii.total)` yang lebih gampang, angkanya akan
-- BERBEDA dari revenue yang tampil di kartu di atasnya pada dialog yang sama — dan
-- selisih itu tidak akan gagal di mana pun, cuma membuat pembaca meragukan dua-duanya.
-- Aturan alokasi tinggal di SQL, satu tempat, seperti pelajaran 106/107/111.
--
-- KENAPA `ii.total` TIDAK DIPAKAI LANGSUNG SEBAGAI NILAI: itu nilai baris BRUTO sebelum
-- pajak & pembulatan faktur. Menjumlahkannya lintas item tidak sama dengan netto faktur,
-- jadi kolomnya di sini bernama `nilai_netto` dan memang hasil alokasi — bukan nilai
-- baris apa adanya. `ii.total` hanya dipakai sebagai BOBOT pembagian.
--
-- KATEGORI TIDAK DIFILTER DI SINI. View ini sengaja mengeluarkan seluruh kategori
-- pengadaan (charField1) dan membiarkan pemanggilnya menyaring lewat kso_kategori_skema.
-- Alasannya: "reagen apa saja yang keluar" kadang perlu dibaca TERMASUK yang di luar
-- skema — item REGULAR yang muncul di faskes PER_TEST justru temuan, bukan derau.
--
-- ── DUA SUMBER BARIS FAKTUR YANG HARUS TETAP SEPADAN ─────────────────────────────
-- View ini membaca `accurate_invoice_item` (punya item_id/unit/qty terstruktur), sama
-- seperti kso_revenue_jenis_v (113). Tapi kso_customer_revenue_v (098) — yang mengisi
-- kartu "Revenue netto" di dialog yang SAMA — membaca `accurate_invoice.raw->detailItem`.
-- Dua jalur berbeda untuk hal yang sama.
--
-- Sepadan HANYA SELAMA setiap faktur punya baris di accurate_invoice_item. Terbukti
-- begitu di prod saat 113 dibuat (Σ = netto faktur, persis). Kalau kelak ada faktur yang
-- ter-mirror tanpa barisnya, reagennya hilang dari view ini TANPA error, dan totalnya
-- akan lebih kecil dari kartu revenue di atasnya. Deteksi:
--
--   SELECT count(*) FROM accurate_invoice i
--   WHERE i.tanggal IS NOT NULL AND NOT EXISTS (
--     SELECT 1 FROM accurate_invoice_item ii WHERE ii.invoice_id = i.id);
--   -- harus 0; kalau tidak, selisihnya sebesar netto faktur-faktur itu
--
-- SATUAN (`unit`) diambil dari baris faktur, bukan dari master item: satu item bisa
-- ditagih dalam satuan berbeda antar faktur (BOX vs PCS), dan menjumlahkan qty lintas
-- satuan menghasilkan angka yang tidak berarti. Karena itu `unit` masuk ke kunci
-- pengelompokan — lebih baik dua baris jujur daripada satu baris yang salah.

CREATE OR REPLACE VIEW kso_faskes_reagen_v AS
WITH inv AS (
  SELECT i.id, i.customer_id, date_trunc('month', i.tanggal)::date AS periode,
         (i.total - COALESCE(i.tax_amount, 0))::numeric AS netto
  FROM accurate_invoice i
  WHERE i.customer_id IS NOT NULL AND i.tanggal IS NOT NULL
),
lin AS (
  SELECT inv.id, inv.customer_id, inv.periode, inv.netto,
         ii.item_id,
         COALESCE(NULLIF(ii.raw->>'charField1', ''), 'Tanpa kategori') AS kategori,
         COALESCE(NULLIF(ii.unit, ''), '-')                            AS unit,
         COALESCE(ii.qty, 0)                                           AS qty,
         GREATEST(COALESCE(ii.total, 0), 0)                            AS w
  FROM inv
  JOIN accurate_invoice_item ii ON ii.invoice_id = inv.id
),
share AS (
  SELECT lin.*,
         sum(w)   OVER (PARTITION BY id) AS wsum,
         count(*) OVER (PARTITION BY id) AS cnt
  FROM lin
)
SELECT s.customer_id            AS account_id,
       s.periode,
       s.item_id,
       it.no                    AS item_no,
       it.name                  AS item_nama,
       -- Jenis alat yang reagen ini layani (peta diturunkan, migrasi 113). NULL =
       -- item belum terpetakan; JANGAN diperlakukan sebagai "bukan reagen alat".
       m.jenis                  AS jenis_alat,
       s.kategori,
       s.unit,
       sum(s.qty)                                                          AS qty,
       sum(CASE WHEN s.wsum > 0 THEN s.netto * s.w / s.wsum
                ELSE s.netto / s.cnt END)                                  AS nilai_netto,
       count(DISTINCT s.id)::int                                           AS jumlah_faktur
FROM share s
LEFT JOIN accurate_item it ON it.id = s.item_id
LEFT JOIN kso_item_jenis_v m ON m.item_id = s.item_id
GROUP BY s.customer_id, s.periode, s.item_id, it.no, it.name, m.jenis, s.kategori, s.unit;

COMMENT ON VIEW kso_faskes_reagen_v IS
  'Reagen/barang yang difakturkan per faskes x bulan x item x kategori x satuan. nilai_netto = netto faktur TERALOKASI menurut porsi nilai baris (mekanisme sama dgn kso_customer_revenue_v & kso_revenue_jenis_v), BUKAN penjumlahan ii.total. Seluruh kategori pengadaan dikeluarkan — penyaringan per skema dilakukan pemanggil lewat kso_kategori_skema. unit ikut jadi kunci karena satu item bisa ditagih dalam satuan berbeda antar faktur.';
