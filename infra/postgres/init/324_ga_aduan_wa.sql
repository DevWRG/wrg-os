-- 324 — Aduan GA dari WhatsApp → Helpdesk GA (F139). Permintaan user 16 Nov 2026:
-- semua aduan & permintaan di grup WA "Aduan GA" dicatat sebagai tiket Helpdesk;
-- balasan staf GA dicatat sebagai progres atau selesai.
--
-- Isi:
--   1. ga_tickets.source_wa_message_id — pesan WA asal tiket, UNIQUE supaya
--      pemindaian ulang / backfill tak menggandakan tiket.
--   2. ga_aduan_wa_config — satu baris: nama WA staf GA (diisi lewat UI
--      Helpdesk tab "Aduan WA", bukan di kode). Pemindai tak jalan selama kosong.
--   3. ga_aduan_wa_seen — tiap pesan grup yang sudah diputus (aduan baru,
--      progres, selesai, komentar, abaikan), pola leave_scan_seen (029).
--   4. Kategori 'PERMINTAAN' — grup ini juga dipakai minta tolong (antar
--      dokumen ke bank, dsb.), bukan cuma laporan kerusakan.
--
-- Tanpa BEGIN/COMMIT sendiri — runner yang mengatur transaksi.

ALTER TABLE ga_tickets
  ADD COLUMN IF NOT EXISTS source_wa_message_id text UNIQUE;

COMMENT ON COLUMN ga_tickets.source_wa_message_id IS
  '324 — message_id wa_message asal tiket (grup Aduan GA). NULL = tiket dibuat manual / #HELPDESK.';

CREATE TABLE IF NOT EXISTS ga_aduan_wa_config (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  staf_ga_names   text[] NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

INSERT INTO ga_aduan_wa_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE ga_aduan_wa_config IS
  '324 — pengaturan pemindai grup WA Aduan GA. staf_ga_names = nama tampilan WA staf GA (pembeda balasan GA vs pelapor).';

CREATE TABLE IF NOT EXISTS ga_aduan_wa_seen (
  message_id   text PRIMARY KEY,
  status       text NOT NULL,
  ticket_id    uuid REFERENCES ga_tickets (id) ON DELETE SET NULL,
  catatan      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_aduan_wa_seen_ticket_idx ON ga_aduan_wa_seen (ticket_id);

COMMENT ON TABLE ga_aduan_wa_seen IS
  '324 — pesan grup Aduan GA yang sudah diputus pemindai (status: aduan-baru/progres/selesai/komentar/abaikan/tak-tertaut).';

INSERT INTO ga_ticket_categories (code, nama, icon, default_sla_hours, default_priority)
VALUES ('PERMINTAAN', 'Permintaan / Tugas', '📋', 24, 'medium')
ON CONFLICT (code) DO NOTHING;
