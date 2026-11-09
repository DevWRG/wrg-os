-- 098 — F15 SPH Generator + Pricing Library (app layer di atas F142 Price
-- Book, tabel product_pricelist migrasi 071).
--
-- Alur: AM pilih item KATALOG (product_pricelist.id, bukan ketik nama bebas)
-- + qty + diskon yang diminta → sph_line_item menyimpan SNAPSHOT harga saat
-- quote dibuat (price book bisa di-reimport/berubah nanti, quote lama harus
-- tetap tercermin harga saat itu). Diskon WAJIB divalidasi ≤ diskon_maks per
-- SKU di layer aplikasi (repo/sph.ts) — enforcement DB lewat trigger dianggap
-- berlebihan utk 1 aturan sederhana, cukup dijaga di satu titik insert.
--
-- Karena AM memilih baris katalog PERSIS (bukan cocokkan nama), masalah 22
-- nama produk duplikat (HANDOVER §6) tidak butuh RESOLUSI nama sama sekali
-- di jalur AM. TAPI HANDOVER §6 minta lebih dari itu: baris ber-nama-kembar
-- WAJIB dikonfirmasi eksplisit oleh Admin Penawaran sebelum finalize (kolom
-- `variant_confirmed` di bawah) — pengaman kedua di luar pilihan AM, bukan
-- gantinya. AM yang sudah tepat pilih pun tetap kena gate ini kalau SKU-nya
-- termasuk nama-kembar (lihat repo/sph.ts createSphDraft & approveSalesDoc).
--
-- Approval 2 tahap (arahan Direktur 2026-08-12, respons pertanyaan gabungan
-- QW1/F15/F19): draft (AM) → hod_review (HOD Business) → approved (Admin
-- Penawaran finalize) → sent. `sales_doc.status` tanpa CHECK constraint
-- (lihat 003_sales_crm.sql) jadi nilai baru 'hod_review' otomatis valid,
-- tak perlu ALTER — cuma kolom pencatat siapa/kapan yang ditambah di sini.
--
-- deal.stage TETAP MANUAL (dikonfirmasi Direktur) — SPH TIDAK memanggil
-- transitionStage() di deal.ts, tidak menyentuh file itu sama sekali.
--
-- Harga Nett floor & Diskon Maks tier: TIDAK dibangun approval terpisah
-- (Direktur: "abaikan" utk pertanyaan skema approval floor-breach) — cukup
-- ditolak keras di titik insert kalau diskon > diskon_maks (lihat repo/sph.ts).
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS hod_reviewed_by text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS hod_reviewed_at timestamptz;

COMMENT ON COLUMN sales_doc.hod_reviewed_by IS
  'F15 — nama HOD Business yang review (tahap 1 dari 2, khusus doc_type=sph). NULL utk doc_type lain (tetap single-approval).';

CREATE TABLE IF NOT EXISTS sph_line_item (
  id                  bigserial PRIMARY KEY,
  sales_doc_id        uuid NOT NULL REFERENCES sales_doc (id) ON DELETE CASCADE,
  pricelist_item_id   bigint NOT NULL REFERENCES product_pricelist (id),

  qty                 numeric(12,2) NOT NULL CHECK (qty > 0),
  diskon_requested     numeric(6,4)  NOT NULL CHECK (diskon_requested >= 0),

  -- Snapshot dari product_pricelist SAAT quote dibuat (bukan live-join) —
  -- price book bisa berubah/di-reimport, SPH yang sudah dibuat harus tetap
  -- menampilkan harga waktu itu.
  nama_snapshot       text NOT NULL,
  price_list          numeric(16,2) NOT NULL,
  diskon_maks_snapshot numeric(6,4) NOT NULL,

  -- Hasil hitung: nett = ROUND(price_list * (1-diskon_requested)),
  -- ppn = ROUND(nett * 1.11) — sama rumus dgn pricebook.ts hargaEfektif()
  -- cabang override, dihitung app-layer, disimpan (bukan generated column,
  -- konsisten dgn HANDOVER §9 soal jangan hitung ulang diam-diam di lapisan lain).
  harga_nett          numeric(16,2) NOT NULL,
  nett_ppn            numeric(16,2) NOT NULL,

  -- HANDOVER §6: baris yang nama produknya dipakai >1 SKU (beda varian/harga)
  -- WAJIB dikonfirmasi manual oleh Admin Penawaran sebelum SPH difinalisasi —
  -- default TRUE (aman) utk baris yang namanya tak kembar sama sekali, jadi
  -- gate ini cuma "menyala" utk baris yang benar berisiko, bukan blanket-block.
  variant_confirmed   boolean NOT NULL DEFAULT true,
  variant_confirmed_by text,
  variant_confirmed_at timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sph_line_item_doc_idx ON sph_line_item (sales_doc_id);

COMMENT ON TABLE sph_line_item IS
  'F15 — baris item SPH dgn harga snapshot dari product_pricelist (F142). qty/diskon diminta AM, divalidasi ≤ diskon_maks di apps/api/src/repo/sph.ts sebelum insert.';
