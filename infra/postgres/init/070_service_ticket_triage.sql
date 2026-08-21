-- 070 — Service Ticket Triage (F26, AFTERSALES). LLM classify komplain
-- customer → severity tag → auto-assign teknisi (by area) + ETA.
--
-- Self-contained: teknisi_roster BUKAN master_user/app_user (HR-forbidden).
-- area = text[] (1 teknisi bisa cover >1 cabang/kota).

CREATE TABLE IF NOT EXISTS teknisi_roster (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        text NOT NULL UNIQUE,
  wa_number   text,
  area        text[] NOT NULL DEFAULT '{}',
  aktif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- source='wa' → wa_message_id UNIQUE (idempotensi: 1 pesan WA = maksimal 1 ticket,
-- aman kalau webhook ke-deliver dobel). source='manual' → wa_message_id NULL.
CREATE TABLE IF NOT EXISTS service_ticket (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','wa')),
  customer_name         text,
  group_jid             text,
  wa_message_id         text UNIQUE,
  complaint_text        text NOT NULL,
  area                  text,
  severity              text NOT NULL DEFAULT 'sedang' CHECK (severity IN ('rendah','sedang','tinggi','kritis')),
  eta_at                timestamptz,
  assigned_teknisi_id   uuid REFERENCES teknisi_roster(id),
  assigned_teknisi_name text,
  needs_review          boolean NOT NULL DEFAULT false,
  model_used            text,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at           timestamptz,
  resolved_note         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_ticket_status_idx  ON service_ticket (status);
CREATE INDEX IF NOT EXISTS service_ticket_created_idx ON service_ticket (created_at DESC);

COMMENT ON TABLE teknisi_roster IS 'F26 — roster teknisi lapangan + area cover (self-contained, bukan master_user).';
COMMENT ON TABLE service_ticket IS 'F26 — Service Ticket Triage: komplain di-klasifikasi LLM (severity+area) → auto-assign teknisi + ETA. needs_review=true kalau LLM gagal/no-match teknisi.';
