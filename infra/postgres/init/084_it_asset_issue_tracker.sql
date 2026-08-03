-- 084 — IT Asset & Issue Tracker (F52, OPS). Ticket per aset IT (PC/laptop)
-- + SLA otomatis (kritis 2 jam, normal 24 jam — configurable via env, lihat
-- apps/api/src/repo/it-ticket.ts).
--
-- `it_asset` = master aset IT. BEDA dari pola F50 (7 mobil = seed SQL):
-- jumlah aset IT bisa puluhan & terus bertambah (PC baru dibeli, laptop
-- rusak diganti) — jadi PUNYA CRUD sederhana di web, bukan seed-only.
-- `is_critical` = flag PERMANEN per-aset (bukan per-tiket) — PC Fakturis
-- ditandai kritis sekali di sini, semua tiket dari aset itu otomatis SLA
-- 2 jam tanpa perlu diingat-ingat tiap lapor.
--
-- `it_ticket` = transaksional. `assigned_to`/`reported_by` TEXT bebas,
-- bukan FK ke master_user (sama filosofi teknisi_name F22, sopir_name F50 —
-- pelapor/PIC belum tentu karyawan terdaftar HR).
--
-- SLA "24/5" (arahan user): dihitung HARI KERJA (Senin-Jumat, bukan
-- master_holiday) sbg 24 jam PENUH per hari, bukan jam kantor 9-5 — akhir
-- pekan/libur nasional dilewati total, bukan cuma jeda jam. Lihat
-- businessHoursFromNow() di it-ticket.ts.

CREATE TABLE IF NOT EXISTS it_asset (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  asset_code    text NOT NULL UNIQUE,
  nama          text NOT NULL,
  lokasi        text,
  pic_default   text,
  is_critical   boolean NOT NULL DEFAULT false,

  active        boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS it_ticket (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          uuid NOT NULL REFERENCES it_asset(id),

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

CREATE INDEX IF NOT EXISTS it_asset_active_idx    ON it_asset (active);
CREATE INDEX IF NOT EXISTS it_ticket_asset_idx     ON it_ticket (asset_id);
CREATE INDEX IF NOT EXISTS it_ticket_status_idx     ON it_ticket (status);
CREATE INDEX IF NOT EXISTS it_ticket_sla_due_idx    ON it_ticket (sla_due_at) WHERE status <> 'resolved';

COMMENT ON TABLE it_asset IS
  'F52 — master aset IT (PC/laptop), CRUD via web (bukan seed — beda pola dari F50 krn jumlahnya lebih dinamis). is_critical = flag permanen (SLA 2 jam).';
COMMENT ON TABLE it_ticket IS
  'F52 — tiket masalah per aset IT. sla_due_at dihitung saat create dari businessHoursFromNow() (24/5, skip weekend+libur nasional).';
