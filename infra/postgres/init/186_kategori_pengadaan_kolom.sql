-- 186 — `charField1` (kategori pengadaan) jadi KOLOM, berhenti di-detoast.
--
-- MASALAH. Sesudah snapshot KSO (migrasi 185), /kso/produktivitas turun dari
-- >100 dtk ke ~2 dtk — tapi ekornya masih membaca `raw`: tiga view yang dipakai
-- halaman itu (kso_tren_bulanan_v, kso_faskes_tren_v, kso_faskes_reagen_skema_v)
-- semuanya bergantung pada kso_faskes_reagen_v, yang mengambil SATU field jsonb
-- lewat `ii.raw ->> 'charField1'` untuk SETIAP baris item. `accurate_invoice_item`
-- punya TOAST 141 MB di atas heap 3,9 MB, jadi satu field itu memaksa membaca
-- ratusan ribu chunk TOAST. Terukur: menyaring lewat kolom 0,7 ms vs lewat `raw`
-- 70 ms — dan itu pun saat cache hangat; dingin, kso_faskes_reagen_v 20 dtk.
--
-- KENAPA KOLOM GENERATED, BUKAN SNAPSHOT LAGI. Kolom ini TIDAK punya kebasian:
-- Postgres menghitungnya saat baris ditulis, jadi ia selalu sinkron dengan `raw`
-- tanpa job refresh. Nilainya juga tak mungkin menyimpang — ekspresinya PERSIS
-- sama dengan yang dipakai view selama ini, cuma dipindah dari waktu-baca ke
-- waktu-tulis. Diuji di dev: 0 baris berbeda terhadap ekspresi lama.
--
-- AMAN UNTUK SINKRON. accurateSync.ts menulis dengan daftar kolom eksplisit
-- (invoice_id, item_id, line_no, qty, unit, unit_price, discount_amount, total,
-- raw) — tidak menyebut kolom ini, dan memang tak boleh: kolom generated menolak
-- nilai eksplisit. Tidak ada perubahan kode sinkron yang diperlukan.
--
-- BIAYA SEKALI. ADD COLUMN ... STORED menulis ulang tabel dan mengunci
-- (ACCESS EXCLUSIVE) selama itu; 31.940 baris, sekali seumur hidup.

ALTER TABLE accurate_invoice_item
  ADD COLUMN IF NOT EXISTS kategori_pengadaan text
  GENERATED ALWAYS AS (raw ->> 'charField1') STORED;

-- View dialihkan ke kolom. Daftar & tipe kolom keluaran TIDAK berubah, jadi
-- CREATE OR REPLACE cukup dan view turunannya tak perlu dibuat ulang.
-- Diverifikasi di dev: isi view sebelum vs sesudah identik (EXCEPT dua arah 0/0,
-- 9.732 baris), dan snapshot 185 tetap konsisten + masih bisa REFRESH CONCURRENTLY.
CREATE OR REPLACE VIEW kso_faskes_reagen_v AS
WITH inv AS (
         SELECT i.id,
            i.customer_id,
            date_trunc('month'::text, i.tanggal::timestamp with time zone)::date AS periode,
            i.total - COALESCE(i.tax_amount, 0::numeric) AS netto
           FROM accurate_invoice i
          WHERE i.customer_id IS NOT NULL AND i.tanggal IS NOT NULL
        ), lin AS (
         SELECT inv.id,
            inv.customer_id,
            inv.periode,
            inv.netto,
            ii.item_id,
            COALESCE(NULLIF(ii.kategori_pengadaan, ''::text), 'Tanpa kategori'::text) AS kategori,
            COALESCE(NULLIF(ii.unit, ''::text), '-'::text) AS unit,
            COALESCE(ii.qty, 0::numeric) AS qty,
            GREATEST(COALESCE(ii.total, 0::numeric), 0::numeric) AS w
           FROM inv
             JOIN accurate_invoice_item ii ON ii.invoice_id = inv.id
        ), share AS (
         SELECT lin.id,
            lin.customer_id,
            lin.periode,
            lin.netto,
            lin.item_id,
            lin.kategori,
            lin.unit,
            lin.qty,
            lin.w,
            sum(lin.w) OVER (PARTITION BY lin.id) AS wsum,
            count(*) OVER (PARTITION BY lin.id) AS cnt
           FROM lin
        )
 SELECT s.customer_id AS account_id,
    s.periode,
    s.item_id,
    it.no AS item_no,
    it.name AS item_nama,
    m.jenis AS jenis_alat,
    s.kategori,
    s.unit,
    sum(s.qty) AS qty,
    sum(
        CASE
            WHEN s.wsum > 0::numeric THEN s.netto * s.w / s.wsum
            ELSE s.netto / s.cnt::numeric
        END) AS nilai_netto,
    count(DISTINCT s.id)::integer AS jumlah_faktur
   FROM share s
     LEFT JOIN accurate_item it ON it.id = s.item_id
     LEFT JOIN kso_item_jenis_v m ON m.item_id = s.item_id
  GROUP BY s.customer_id, s.periode, s.item_id, it.no, it.name, m.jenis, s.kategori, s.unit;
