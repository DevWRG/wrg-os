-- 095 — F20 E-Catalog/LPSE Compliance Tracker. Standalone dari `dev`.
-- Status klik per tender step (pesan masuk -> barang dikirim -> selesai),
-- semua manual lewat web (blueprint: Hashtag "-", tak ada ingestion WA).
-- Pola sama F139 ga_ticket_status_log: 1 baris log per transition sukses
-- (bukan cuma kolom timestamp tetap) supaya progres bisa ditelusuri utuh.
-- PIC resolve ke employee.id (Wildha/Sidqi/Firman sudah ada di roster
-- employee_spine sbg AM regional, BUKAN staf admin tender terpisah).
--
-- ASUMSI (blueprint tak merinci, lihat plan/memory F20): tepat 3 status,
-- tak ada status batal/gagal; reminder default 3 hari macet di satu status
-- (LPSE_TENDER_REMINDER_DAYS, env-overridable).

CREATE TABLE IF NOT EXISTS lpse_tender (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_no          text,                       -- nullable, sering belum ada saat "pesan masuk"
  judul              text NOT NULL,
  instansi           text NOT NULL,
  platform           text NOT NULL DEFAULT 'lpse' CHECK (platform IN ('lpse','e_catalog')),
  pic_employee_id    text REFERENCES employee(id) ON DELETE SET NULL,
  dept               text REFERENCES department(key) ON DELETE SET NULL DEFAULT 'penawaran',

  status             text NOT NULL DEFAULT 'pesan_masuk'
                       CHECK (status IN ('pesan_masuk', 'barang_dikirim', 'selesai')),

  pesan_masuk_at     timestamptz NOT NULL DEFAULT now(),
  barang_dikirim_at  timestamptz,
  selesai_at         timestamptz,

  notes              text,

  -- Anti-broadcast (pola ga_tickets.sla_alert_sent_at) — direset NULL tiap
  -- naik status supaya status berikutnya punya jam macet sendiri.
  reminder_sent_at   timestamptz,

  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Timeline progres — 1 baris per transition sukses, pola ga_ticket_status_log.
CREATE TABLE IF NOT EXISTS lpse_tender_status_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id          uuid NOT NULL REFERENCES lpse_tender(id) ON DELETE CASCADE,
  from_status        text NOT NULL,
  to_status          text NOT NULL,
  changed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lpse_tender_status_idx     ON lpse_tender (status);
CREATE INDEX IF NOT EXISTS lpse_tender_pic_idx        ON lpse_tender (pic_employee_id);
CREATE INDEX IF NOT EXISTS lpse_tender_reminder_idx   ON lpse_tender (status) WHERE status <> 'selesai' AND reminder_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS lpse_tender_status_log_tender_idx ON lpse_tender_status_log (tender_id, created_at);

COMMENT ON TABLE lpse_tender IS 'F20 — E-Catalog/LPSE Compliance Tracker. Status 3-step manual (pesan_masuk -> barang_dikirim -> selesai), tak ada hashtag WA.';
COMMENT ON TABLE lpse_tender_status_log IS 'F20 — riwayat SETIAP transition status lpse_tender, sumber timeline progres di UI.';
