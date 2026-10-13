-- 219 — F27 Faktur Pajak / CoreTax Workflow (Finance). Additive, idempoten.
--
-- Tracker Faktur Pajak (FP) per invoice penjualan: request → input CoreTax → approve → bukti.
-- Pembuatan FP-nya sendiri tetap di CoreTax (DJP); tabel ini hanya melacak langkahnya.
--
--   faktur_pajak        — satu baris per FP. DPP/PPN/NPWP/customer di-SNAPSHOT dari mirror Accurate
--                         saat diminta (invoice berubah kemudian tak menggeser angka yang sudah
--                         diajukan ke CoreTax). invoice_id tanpa FK: mirror di-upsert berkala.
--   faktur_pajak_event  — jejak perpindahan status (siapa, kapan, catatan). Hanya INSERT.
--
-- Nomor 219: 212–218 sudah dipakai (F58, F56, F74, F131, F130, F169, F73). Awalnya 215 — diganti
-- karena 215 terpakai F131 di main (13 Okt 2026).

CREATE TABLE IF NOT EXISTS faktur_pajak (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id      bigint NOT NULL,                 -- accurate_invoice.id
  invoice_number  text   NOT NULL,
  customer_id     bigint,
  customer_name   text,
  customer_npwp   text,                            -- boleh kosong; diisi/dikoreksi Finance sebelum input CoreTax
  tanggal_invoice date   NOT NULL,
  dpp             numeric NOT NULL,                -- accurate_invoice.taxable_amount (apa adanya)
  ppn             numeric NOT NULL,                -- accurate_invoice.tax_amount (apa adanya, tak dihitung ulang)
  masa_pajak      text   NOT NULL CHECK (masa_pajak ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  batas_terbit    date   NOT NULL,                 -- tgl 15 bulan berikutnya masa pajak (diturunkan di aplikasi)
  status          text   NOT NULL DEFAULT 'diminta'
                  CHECK (status IN ('diminta','diinput_coretax','disetujui','selesai','dibatalkan')),
  nomor_fp        text,                            -- diisi saat disetujui (hasil CoreTax)
  bukti_url       text,                            -- tautan bukti (PDF FP / screenshot) di Drive; diisi saat selesai
  catatan         text,
  requested_by    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Satu invoice hanya boleh punya SATU FP aktif (dibatalkan dilepas supaya bisa diminta ulang).
CREATE UNIQUE INDEX IF NOT EXISTS faktur_pajak_invoice_aktif_uq ON faktur_pajak (invoice_id) WHERE status <> 'dibatalkan';
-- Nomor FP unik di antara FP aktif.
CREATE UNIQUE INDEX IF NOT EXISTS faktur_pajak_nomor_aktif_uq ON faktur_pajak (nomor_fp) WHERE nomor_fp IS NOT NULL AND status <> 'dibatalkan';
CREATE INDEX IF NOT EXISTS faktur_pajak_status_idx ON faktur_pajak (status, batas_terbit);
CREATE INDEX IF NOT EXISTS faktur_pajak_masa_idx ON faktur_pajak (masa_pajak);

CREATE TABLE IF NOT EXISTS faktur_pajak_event (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fp_id    bigint NOT NULL REFERENCES faktur_pajak(id) ON DELETE CASCADE,
  dari     text,                                   -- NULL = baris awal (request)
  ke       text   NOT NULL,
  oleh     text,
  catatan  text,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS faktur_pajak_event_fp_idx ON faktur_pajak_event (fp_id, id);

COMMENT ON TABLE faktur_pajak IS
  'F27 — tracker Faktur Pajak per invoice: diminta → diinput_coretax → disetujui → selesai (bukti). Pembuatan FP tetap di CoreTax.';
