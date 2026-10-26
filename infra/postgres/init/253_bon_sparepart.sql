-- 253 — F155 Bon Sparepart Teknisi (#BON) & #OPNAME.
--
-- Teknisi membawa sparepart urgent saat kantor tutup (bypass alur PO customer → SJ). Admin Gudang
-- mencatat bon di dashboard; teknisi melapor lewat WA `#BON`; `#OPNAME` menampilkan bon yang sudah
-- dilaporkan vs belum dan rekonsiliasi bon yang sudah jadi SJ (surat jalan). Hanya baca dari mirror
-- Accurate (accurate_delivery_order[_item]) — tak ada tulis ke Accurate.
--
-- status: dibuat (bon gudang, belum dilaporkan teknisi) → dilaporkan (teknisi #BON) → selesai (SJ tertaut)
--         / batal. asal='teknisi' = lahir dari #BON tanpa bon gudang (ditandai di #OPNAME).

CREATE TABLE IF NOT EXISTS bon_sparepart (
  id              bigserial PRIMARY KEY,
  teknisi_id      uuid NOT NULL REFERENCES teknisi_capacity(id),
  teknisi_nama    text NOT NULL,                  -- snapshot (roster bisa berganti nama)
  asal            text NOT NULL DEFAULT 'gudang' CHECK (asal IN ('gudang', 'teknisi')),
  status          text NOT NULL DEFAULT 'dibuat'
                  CHECK (status IN ('dibuat', 'dilaporkan', 'selesai', 'batal')),
  customer_nama   text,                           -- opsional: tujuan pemakaian (membantu cocok ke SJ)
  customer_id     bigint,                         -- accurate_customer.id bila dipilih/dicocokkan
  catatan         text,
  dibuat_oleh     text NOT NULL,
  dibuat_at       timestamptz NOT NULL DEFAULT now(),
  dilaporkan_at   timestamptz,
  wa_message_id   text,
  sj_number       text,
  sj_id           bigint,                         -- accurate_delivery_order.id
  sj_sumber       text CHECK (sj_sumber IN ('otomatis', 'manual')),
  sj_at           timestamptz,
  sj_oleh         text,
  batal_alasan    text,
  batal_oleh      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bon_sparepart_status ON bon_sparepart (status, dibuat_at);
CREATE INDEX IF NOT EXISTS bon_sparepart_teknisi ON bon_sparepart (teknisi_id, status);
-- satu SJ hanya dipakai satu bon
CREATE UNIQUE INDEX IF NOT EXISTS bon_sparepart_sj_uniq ON bon_sparepart (sj_id) WHERE sj_id IS NOT NULL AND status <> 'batal';

CREATE TABLE IF NOT EXISTS bon_sparepart_item (
  bon_id     bigint NOT NULL REFERENCES bon_sparepart(id) ON DELETE CASCADE,
  urut       smallint NOT NULL,
  item_id    bigint,                              -- accurate_item.id
  item_no    text,                                -- accurate_item.no (kunci join ke item SJ)
  item_nama  text NOT NULL,                       -- snapshot nama
  qty        numeric NOT NULL CHECK (qty > 0),
  satuan     text,
  dilaporkan_qty numeric NOT NULL DEFAULT 0 CHECK (dilaporkan_qty >= 0),  -- sudah dilaporkan teknisi via #BON; bon → 'dilaporkan' bila semua baris penuh
  PRIMARY KEY (bon_id, urut)
);
CREATE INDEX IF NOT EXISTS bon_sparepart_item_no ON bon_sparepart_item (item_no);

COMMENT ON TABLE bon_sparepart IS
  'F155: bon sparepart teknisi. dibuat (gudang, dashboard) → dilaporkan (#BON teknisi) → selesai (SJ Accurate tertaut, otomatis/manual) / batal.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bon_sparepart, bon_sparepart_item TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE bon_sparepart_id_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON bon_sparepart, bon_sparepart_item TO wrg_readonly;
  END IF;
END $$;
