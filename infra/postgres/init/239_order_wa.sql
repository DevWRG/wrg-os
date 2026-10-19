-- 239 — F90 Sales Order Entry via WA #ORDER (antrean pesanan AM → Admin Sales).
--
-- Keputusan user 19 Okt 2026: pesanan masuk ANTREAN di WRG-OS (tanpa akses tulis ke Accurate);
-- Admin Sales menginput SO di Accurate seperti biasa, lalu sistem mencocokkan dengan cermin
-- accurate_sales_order. Harga di bawah lantai price book (harga_nett) DITOLAK. AM wajib
-- konfirmasi "#ORDER ya O12" sebelum masuk antrean. WA ke Admin Sales: saklar default mati.
--
-- Nomor 239: 238 dipakai PR #1821 (bukti pembayaran), 234–237 sudah terpakai.

CREATE TABLE IF NOT EXISTS order_wa (
  id              bigserial PRIMARY KEY,
  am_id           text NOT NULL,                  -- pengirim (resolveSender), bukan dari isi pesan
  account_id      bigint NOT NULL,                -- accurate_customer.id
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'antrean', 'diproses', 'selesai', 'batal')),
  catatan         text,
  teks_asli       text,
  sumber_jid      text,                           -- chat asal (balasan konfirmasi ke sana)
  dibuat_at       timestamptz NOT NULL DEFAULT now(),
  dikonfirmasi_at timestamptz,
  diproses_oleh   text,
  diproses_at     timestamptz,
  so_number       text,                           -- nomor SO Accurate (cocok otomatis / diisi admin)
  so_id           bigint,
  selesai_at      timestamptz,
  selesai_oleh    text,                           -- 'otomatis' bila dicocokkan sistem
  batal_alasan    text,
  batal_oleh      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_wa_status ON order_wa (status, dikonfirmasi_at);
CREATE INDEX IF NOT EXISTS order_wa_am ON order_wa (am_id, dibuat_at);
CREATE INDEX IF NOT EXISTS order_wa_akun ON order_wa (account_id, dikonfirmasi_at);

CREATE TABLE IF NOT EXISTS order_wa_item (
  order_id      bigint NOT NULL REFERENCES order_wa(id) ON DELETE CASCADE,
  urut          smallint NOT NULL,
  teks_asli     text NOT NULL,
  pricebook_id  bigint NOT NULL,                  -- product_pricelist.id (periode berlaku saat pesan)
  kode          text,                             -- kode item Accurate (NULL = item price book tanpa kode)
  item_id       bigint,                           -- accurate_item.id bila kode cocok
  nama          text NOT NULL,                    -- snapshot nama + varian
  qty           numeric NOT NULL CHECK (qty > 0),
  satuan        text,
  harga         numeric NOT NULL CHECK (harga >= 0),  -- per satuan, sebelum PPN
  harga_list    numeric NOT NULL,
  harga_nett    numeric NOT NULL,                  -- lantai saat pesan (snapshot)
  stok          numeric,                           -- stok Accurate saat pesan (NULL = tak diketahui)
  PRIMARY KEY (order_id, urut),
  CHECK (harga >= harga_nett)
);

COMMENT ON TABLE order_wa IS
  'F90: pesanan AM lewat WA #ORDER. draft (menunggu "#ORDER ya O<id>") → antrean → diproses (Admin Sales) → selesai (SO Accurate cocok) / batal.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON order_wa, order_wa_item TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE order_wa_id_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON order_wa, order_wa_item TO wrg_readonly;
  END IF;
END $$;
