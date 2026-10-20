-- 243 — Arsip faktur yang sudah HILANG dari Accurate (#1840). Additive, idempoten.
--
-- Mirror accurate_invoice tak pernah membuang faktur yang dihapus di Accurate. Faktur yang
-- dihapus lalu diinput ulang mendapat id baru → id lama (hantu) tetap OPEN selamanya dan
-- terhitung DUA KALI di piutang & pendapatan. Prod 21 Okt: PJK/1459-2606-JBR tercatat di
-- id 59152 dan 60407 (sama-sama OPEN Rp 5,76 jt); detail.do id lama menjawab
-- "Faktur Penjualan tidak tepat".
--
-- refreshOpenInvoices (repo/accurateSync.ts) memindahkan baris semacam itu ke sini —
-- baris faktur + item-itemnya utuh sebagai jsonb — lalu menghapusnya dari mirror, supaya
-- semua pembaca (piutang, pendapatan, analitik item, insentif) kembali sama dengan Accurate
-- tanpa mengubah query mereka. Tak ada FK ke accurate_invoice (dicek di prod 21 Okt).

CREATE TABLE IF NOT EXISTS accurate_invoice_hilang (
  id              BIGINT PRIMARY KEY,          -- id faktur Accurate yang sudah tak ada
  number          TEXT,
  customer_id     BIGINT,
  tanggal         DATE,
  total           NUMERIC,
  outstanding     NUMERIC,
  status          TEXT,
  ada_kembaran    BOOLEAN NOT NULL,            -- nomor sama masih ada dengan id lain (input ulang)
  pesan_accurate  TEXT,
  baris           JSONB NOT NULL,              -- to_jsonb(accurate_invoice) saat dihapus
  items           JSONB NOT NULL DEFAULT '[]', -- to_jsonb(accurate_invoice_item) per baris
  dihapus_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accurate_invoice_hilang_number_idx ON accurate_invoice_hilang (number);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT ON accurate_invoice_hilang TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON accurate_invoice_hilang TO wrg_readonly;
  END IF;
END $$;
