-- 070 (lineage F22→F24→F8) — Teknisi Readiness Board (F8, AFTERSALES).
-- CATATAN NUMBERING: branch F26 (lineage terpisah dari `dev`) JUGA pakai 070
-- utk migrasinya sendiri (070_service_ticket_triage.sql) — bukan conflict
-- (branch independen), tapi WAJIB direnumber oleh siapa pun yg merge
-- BELAKANGAN ke `dev` (jadi 071) supaya urutan tetap sekuensial.
--
-- teknisi_capacity: roster + kapasitas kerja, SELF-CONTAINED (nama dummy,
-- BUKAN master_user/HR, BUKAN teknisi_roster F26 — beda lineage branch).
-- install_schedule: FK ke installation_unit (F22) — penjadwalan install alat.
-- teknisi_report: laporan lapangan (#install/#servis/#training/#kalibrasi),
-- via WA (parsing) ATAU manual/testing; wa_message_id UNIQUE utk idempotensi.

CREATE TABLE IF NOT EXISTS teknisi_capacity (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama                text NOT NULL UNIQUE,
  wa_number           text,
  max_concurrent_jobs int NOT NULL DEFAULT 3 CHECK (max_concurrent_jobs > 0),
  aktif               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS install_schedule (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_unit_id  uuid NOT NULL REFERENCES installation_unit(id) ON DELETE CASCADE,
  teknisi_id            uuid REFERENCES teknisi_capacity(id),
  scheduled_date        date NOT NULL,
  status                text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','done','cancelled')),
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teknisi_report (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teknisi_id            uuid REFERENCES teknisi_capacity(id),
  report_type           text NOT NULL CHECK (report_type IN ('install','servis','training','kalibrasi')),
  body                  text NOT NULL,
  source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','wa')),
  group_jid             text,
  wa_message_id         text UNIQUE,
  installation_unit_id  uuid REFERENCES installation_unit(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS install_schedule_teknisi_idx ON install_schedule (teknisi_id, status);
CREATE INDEX IF NOT EXISTS teknisi_report_created_idx ON teknisi_report (created_at DESC);

COMMENT ON TABLE teknisi_capacity IS 'F8 — roster + kapasitas kerja teknisi (self-contained, nama dummy).';
COMMENT ON TABLE install_schedule IS 'F8 — jadwal install per alat (FK installation_unit dari F22) x teknisi.';
COMMENT ON TABLE teknisi_report IS 'F8 — laporan lapangan teknisi (#install/#servis/#training/#kalibrasi via WA atau manual).';
