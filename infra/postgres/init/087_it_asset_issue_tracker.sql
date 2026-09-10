-- 084 — IT Asset & Issue Tracker (F52, OPS). Ticket per aset IT (PC/laptop)
-- + SLA otomatis (kritis 2 jam, normal 24 jam — configurable via env, lihat
-- apps/api/src/repo/it-ticket.ts).
--
-- F52 DISERAP ke F132 GA Aset Master (arahan Direktur, migrasi 086) — tabel
-- `it_asset` yang awalnya dirancang di sini TIDAK PERNAH dibuat. `asset_id`
-- FK langsung ke `ga_assets` (single source of truth SEMUA aset kantor,
-- bukan cuma IT). `is_critical` (flag SLA 2 jam) dibaca dari
-- `ga_assets.is_critical`, bukan kolom sendiri di sini.
--
-- `it_ticket` = transaksional. `assigned_to`/`reported_by` TEXT bebas,
-- bukan FK ke master_user (sama filosofi teknisi_name F22, sopir_name F50 —
-- pelapor/PIC belum tentu karyawan terdaftar HR). MVP: belum auto-resolve
-- dari PIC aktif F133 (ga_asset_assignments) — enhancement susulan.
--
-- SLA "24/5" (arahan user): dihitung HARI KERJA (Senin-Jumat, bukan
-- master_holiday) sbg 24 jam PENUH per hari, bukan jam kantor 9-5 — akhir
-- pekan/libur nasional dilewati total, bukan cuma jeda jam. Lihat
-- businessHoursFromNow() di it-ticket.ts.

CREATE TABLE IF NOT EXISTS it_ticket (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES ga_assets(id),

  masalah           text NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),

  reported_by       text,
  assigned_to       text,

  sla_due_at        timestamptz NOT NULL,
  sla_alert_sent_at timestamptz,

  resolved_at       timestamptz,
  resolved_note     text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS it_ticket_asset_idx     ON it_ticket (asset_id);
CREATE INDEX IF NOT EXISTS it_ticket_status_idx     ON it_ticket (status);
CREATE INDEX IF NOT EXISTS it_ticket_sla_due_idx    ON it_ticket (sla_due_at) WHERE status <> 'resolved';

COMMENT ON TABLE it_ticket IS
  'F52 — tiket masalah per aset IT. asset_id FK ga_assets (F132, 086) — is_critical (SLA) dibaca dari sana. sla_due_at dihitung saat create dari businessHoursFromNow() (24/5, skip weekend+libur nasional).';
