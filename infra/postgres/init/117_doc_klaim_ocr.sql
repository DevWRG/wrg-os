-- 096 — DOC #KLAIM Invoice Claim OCR (FR-DOC-01). Klaim reimburse dana
-- karyawan: beli kebutuhan kantor/perjalanan dinas pakai uang sendiri dulu,
-- lalu ajukan klaim via WA #KLAIM + foto nota, diekstrak Gemini Vision
-- (services/ai). Ingestion HANYA via WA (reuse wa_message.media_path, TIDAK
-- ada mekanisme upload baru).
--
-- Tak ada rule resmi soal approver/ambang nominal dari Direktur (Owner
-- blueprint kosong, DEFER-Y2/COULD) — approval didesain generik: siapa pun
-- user login boleh approve/reject, tercatat decided_by_user_id. Bukan role-
-- gate baru yang direka-reka.

CREATE TABLE IF NOT EXISTS doc_klaim (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id      uuid REFERENCES wa_message(id) ON DELETE SET NULL,
  sender_name        text,                     -- WA push name, fallback tampilan kalau employee_id NULL
  employee_id        text REFERENCES employee(id) ON DELETE SET NULL,  -- resolve dari nomor WA (employee.whatsapp), NULL = tak ke-resolve (tetap tercatat, TIDAK di-reject)
  media_path         text,                     -- salinan wa_message.media_path (histori independen)
  caption            text,                     -- body pesan WA setelah #KLAIM

  raw_text           text,                     -- teks penuh yg dibaca Gemini Vision dari foto
  nomor_dokumen      text,
  tanggal_dokumen    text,
  nominal            text,                     -- teks apa adanya (nominal DIKLAIM, dari nota), JANGAN paksa ::numeric (format uang di foto beragam)
  pihak              text,                     -- nama toko/institusi yg tercetak di dokumen
  model_used         text,
  ocr_dry_run        boolean NOT NULL DEFAULT false,

  -- kebutuhan_kantor/perjalanan_dinas/lainnya — NULL = belum ditriage. LLM
  -- TIDAK diminta menebak ini (mis. struk taksi ambigu kantor/dinas tanpa
  -- konteks), staf pilih manual.
  kategori           text CHECK (kategori IS NULL OR kategori IN ('kebutuhan_kantor', 'perjalanan_dinas', 'lainnya')),

  -- Forward-only: baru -> disetujui|ditolak -> dibayar (hanya dari disetujui).
  status             text NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'disetujui', 'ditolak', 'dibayar')),
  decided_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  nominal_disetujui  numeric,                  -- NULL = sesuai nominal diklaim; diisi kalau finance adjust saat approve
  dibayar_at         timestamptz,

  catatan            text,                     -- alasan tolak / catatan approval, bebas isi

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS doc_klaim_status_idx ON doc_klaim (status);
CREATE INDEX IF NOT EXISTS doc_klaim_employee_idx ON doc_klaim (employee_id);

COMMENT ON TABLE doc_klaim IS 'DOC #KLAIM — klaim reimburse dana karyawan (kebutuhan kantor/perjalanan dinas), ingestion via WA #KLAIM+foto, ekstraksi Gemini Vision, approval generik (siapa pun user login).';
