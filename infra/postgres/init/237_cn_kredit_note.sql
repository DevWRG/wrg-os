-- 237 — F151 CN (Kredit Note) Lifecycle. Additive, idempoten.
--
-- Keputusan user (2026-10-16, diskusi direktur Bagian 1.1):
--   • CN = rebate ke customer berdasarkan kontrak, DIINPUT lewat form (bukan ditarik dari
--     credit memo Accurate).
--   • Dasar hitung = FAKTUR (DPP accurate_invoice), bukan pembayaran masuk.
--   • Alur: Sales mengajukan ke HoD Sales ATAU HoD Business → (bila lewat HoD Business, ia
--     meninjau dulu) → HoD Sales approve → Finance validasi → GA realisasi bank (+bukti).
--   • Isi kontrak: customer, jenis (persen/nominal), periode, dasar hitung, syarat, file.
--
--   cn_kontrak          — kontrak CN per customer (tarif, periode, syarat). Aktif oleh Direktur.
--   cn_pengajuan        — satu pengajuan CN; nilai per faktur ada di cn_pengajuan_item.
--   cn_pengajuan_item   — faktur yang dicakup. DPP/nilai di-SNAPSHOT dari mirror Accurate saat diajukan
--                         (invoice berubah kemudian tak menggeser angka). invoice_id tanpa FK: mirror
--                         di-upsert berkala. Satu faktur hanya boleh dicakup SATU pengajuan aktif.
--   cn_event            — jejak perpindahan status. Hanya INSERT.

CREATE SEQUENCE IF NOT EXISTS cn_kontrak_kode_seq START 1;
CREATE SEQUENCE IF NOT EXISTS cn_kode_seq START 1;

CREATE TABLE IF NOT EXISTS cn_kontrak (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode          text NOT NULL UNIQUE DEFAULT ('KCN-' || lpad(nextval('cn_kontrak_kode_seq')::text, 4, '0')),
  customer_id   bigint NOT NULL,                  -- accurate_customer.id
  customer_name text NOT NULL,                    -- snapshot
  jenis         text NOT NULL CHECK (jenis IN ('persen', 'nominal')),
  tarif         numeric NOT NULL CHECK (tarif > 0),  -- persen (0–100) atau Rupiah total per pengajuan
  periode_mulai date NOT NULL,
  periode_selesai date NOT NULL,
  syarat        text,                             -- mis. batas umur bayar / minimal omzet (teks bebas)
  file_url      text,                             -- tautan https ke berkas kontrak
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'aktif', 'dibatalkan')),
  created_by    text,
  approved_by   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (periode_selesai >= periode_mulai),
  CHECK (jenis <> 'persen' OR tarif <= 100)
);
CREATE INDEX IF NOT EXISTS cn_kontrak_customer_idx ON cn_kontrak (customer_id, status);

CREATE TABLE IF NOT EXISTS cn_pengajuan (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode             text NOT NULL UNIQUE DEFAULT ('CN-' || lpad(nextval('cn_kode_seq')::text, 5, '0')),
  kontrak_id       bigint NOT NULL REFERENCES cn_kontrak(id),
  customer_id      bigint NOT NULL,
  customer_name    text NOT NULL,
  jenis            text NOT NULL CHECK (jenis IN ('persen', 'nominal')),   -- snapshot dari kontrak
  tarif            numeric NOT NULL CHECK (tarif > 0),                     -- snapshot dari kontrak
  total_dpp        numeric NOT NULL DEFAULT 0,
  total_cn         numeric NOT NULL DEFAULT 0,
  hod_sales_key    text NOT NULL,                 -- master_hod.hod_key: rocky (East) / yogi (West) — approver akhir
  hod_business_key text,                          -- mufid / arman; terisi = diajukan LEWAT HoD Business (ia meninjau dulu)
  status           text NOT NULL DEFAULT 'diajukan'
                   CHECK (status IN ('diajukan', 'ditinjau', 'disetujui', 'divalidasi', 'terealisasi', 'ditolak', 'dibatalkan')),
  bukti_url        text,                          -- bukti transfer; wajib saat terealisasi (diisi GA)
  tanggal_realisasi date,
  catatan          text,
  requested_by     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (hod_business_key IS NULL OR hod_business_key <> hod_sales_key)
);
CREATE INDEX IF NOT EXISTS cn_pengajuan_status_idx ON cn_pengajuan (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cn_pengajuan_customer_idx ON cn_pengajuan (customer_id);

CREATE TABLE IF NOT EXISTS cn_pengajuan_item (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pengajuan_id    bigint NOT NULL REFERENCES cn_pengajuan(id) ON DELETE CASCADE,
  invoice_id      bigint NOT NULL,                -- accurate_invoice.id
  invoice_number  text   NOT NULL,
  tanggal_invoice date   NOT NULL,
  salesman_name   text,                           -- snapshot, dasar laporan pembagian per sales
  dpp             numeric NOT NULL CHECK (dpp > 0),
  nilai_cn        numeric NOT NULL CHECK (nilai_cn >= 0),
  aktif           boolean NOT NULL DEFAULT true   -- false saat pengajuan ditolak/dibatalkan → faktur bebas diajukan lagi
);
-- Satu faktur = satu pengajuan aktif.
CREATE UNIQUE INDEX IF NOT EXISTS cn_item_invoice_aktif_uq ON cn_pengajuan_item (invoice_id) WHERE aktif;
CREATE INDEX IF NOT EXISTS cn_item_pengajuan_idx ON cn_pengajuan_item (pengajuan_id);

CREATE TABLE IF NOT EXISTS cn_event (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pengajuan_id bigint NOT NULL REFERENCES cn_pengajuan(id) ON DELETE CASCADE,
  dari         text,                              -- NULL = baris awal (pengajuan)
  ke           text   NOT NULL,
  oleh         text,
  catatan      text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cn_event_pengajuan_idx ON cn_event (pengajuan_id, id);

COMMENT ON TABLE cn_pengajuan IS
  'F151 — pengajuan CN (rebate kontrak, dasar faktur): diajukan → [ditinjau HoD Business] → disetujui HoD Sales → divalidasi Finance → terealisasi (GA, bukti).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON cn_kontrak, cn_pengajuan, cn_pengajuan_item, cn_event TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE cn_kontrak_kode_seq, cn_kode_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON cn_kontrak, cn_pengajuan, cn_pengajuan_item, cn_event TO wrg_readonly;
  END IF;
END $$;
