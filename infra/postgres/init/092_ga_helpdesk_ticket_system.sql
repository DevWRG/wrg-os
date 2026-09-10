-- 092 — F139 GA Helpdesk Ticket System (Ticketing Kendala Operasional).
-- Standalone dari `dev` (bukan lineage F132/F133/F137) — state machine
-- disederhanakan dari source `gais/tickets.js` atas pilihan user (ikut brief,
-- bukan source asli yang py 7 status + waiting_vendor), jadi tak butuh FK ke
-- ga_vendor (F137). Assignee/reporter reuse app_user langsung (picker generik
-- /app-users), TIDAK bikin roster khusus baru spt teknisi_capacity (F8).
--
-- ga_ticket_status_log (bukan cuma kolom timestamp per-stage tetap) — respon
-- arahan Direktur soal "wajib bisa lihat tracking progres": mencatat SETIAP
-- transition termasuk siklus berulang waiting<->in_progress, sumber timeline UI.

CREATE TABLE IF NOT EXISTS ga_ticket_categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  nama               text NOT NULL,
  icon               text,                              -- emoji, kosmetik (opsional)
  default_sla_hours  int NOT NULL DEFAULT 24 CHECK (default_sla_hours > 0),
  default_priority   text NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low','medium','high','critical')),
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ga_tickets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto-gen 'TKT-<tahun input>-NNNNN' (lihat generateTicketNo() di
  -- repo/ga-helpdesk.ts) — basis tahun dari NOW(), pola sama ga_assets.asset_code.
  ticket_no             text NOT NULL UNIQUE,
  title                 text NOT NULL,
  description           text,
  category_id           uuid NOT NULL REFERENCES ga_ticket_categories(id) ON DELETE RESTRICT,
  priority              text NOT NULL CHECK (priority IN ('low','medium','high','critical')),

  -- Hybrid reporter/assignee (pola PIC F132) — picker generik /app-users,
  -- BUKAN roster khusus baru. Salah satu boleh diisi via nama bebas (mis. hasil
  -- resolve fuzzy dari WA #HELPDESK yang gagal match app_user).
  reporter_user_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reporter_name_override text,
  assignee_user_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  assignee_name_override text,

  location              text,

  sla_hours_override    int CHECK (sla_hours_override IS NULL OR sla_hours_override > 0),
  sla_due_at             timestamptz NOT NULL,

  status                text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','in_progress','waiting','completed','closed','cancelled')),

  opened_at              timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  completed_at           timestamptz,
  closed_at              timestamptz,

  rating                 int CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  rating_comment         text,

  -- Anti-broadcast (pola F52 it_ticket.sla_alert_sent_at) — hanya ditulis kalau
  -- WA BENAR-BENAR terkirim (sent && !stub && !dryRun), lihat runGaHelpdeskOverdueAlert.
  sla_alert_sent_at      timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ga_ticket_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          uuid NOT NULL REFERENCES ga_tickets(id) ON DELETE CASCADE,
  comment            text NOT NULL,
  is_internal        boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Timeline progres (lihat header) — 1 baris per transition sukses, TERMASUK
-- siklus berulang (waiting->in_progress bisa terjadi >1x per tiket).
CREATE TABLE IF NOT EXISTS ga_ticket_status_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id          uuid NOT NULL REFERENCES ga_tickets(id) ON DELETE CASCADE,
  from_status        text NOT NULL,
  to_status          text NOT NULL,
  changed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_tickets_category_idx    ON ga_tickets (category_id);
CREATE INDEX IF NOT EXISTS ga_tickets_status_idx      ON ga_tickets (status);
CREATE INDEX IF NOT EXISTS ga_tickets_assignee_idx    ON ga_tickets (assignee_user_id);
CREATE INDEX IF NOT EXISTS ga_tickets_sla_overdue_idx ON ga_tickets (sla_due_at) WHERE status NOT IN ('completed','closed','cancelled');
CREATE INDEX IF NOT EXISTS ga_ticket_comments_ticket_idx    ON ga_ticket_comments (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS ga_ticket_status_log_ticket_idx  ON ga_ticket_status_log (ticket_id, created_at);

COMMENT ON TABLE ga_ticket_categories  IS 'F139 — kategori tiket kendala operasional (icon+SLA+priority default), pola ga_asset_categories F132.';
COMMENT ON TABLE ga_tickets            IS 'F139 — tiket kendala operasional. ticket_no auto-gen TKT-YYYY-NNNNN. Hybrid reporter/assignee via app_user.';
COMMENT ON TABLE ga_ticket_comments    IS 'F139 — komentar tiket, is_internal membedakan catatan internal vs balasan ke reporter.';
COMMENT ON TABLE ga_ticket_status_log  IS 'F139 — riwayat SETIAP transition status (termasuk siklus berulang) — sumber timeline progres di UI.';

-- Kategori default fallback (wajib ada minimal 1 — dipakai #HELPDESK WA yang
-- belum sempat pilih kategori spesifik).
INSERT INTO ga_ticket_categories (code, nama, icon, default_sla_hours, default_priority)
VALUES ('UMUM', 'Umum', '🛠️', 24, 'medium')
ON CONFLICT (code) DO NOTHING;

-- BSC feed (pola F137 090_seed_ga_maintenance_kpi.sql) — KPI baru 'SLA
-- compliance %' utk Dito (Accountable di RACI brief F139), perspective 'proc'
-- (Internal Process, sesuai brief). Formula achievement: lihat
-- runGaHelpdeskBscFeed (repo/ga-helpdesk.ts) — ASUMSI teknis, brief cuma
-- sebut nama KPI bukan rumus, gampang diganti tanpa ubah skema.
INSERT INTO kpi (employee_id, name, target, frequency, perspective, lower_better, seq)
SELECT 'dito', 'SLA compliance % (Helpdesk Tiket)', '100% tepat waktu', 'Bulanan', 'proc', false, 11
WHERE EXISTS (SELECT 1 FROM employee WHERE id = 'dito')
  AND NOT EXISTS (
    SELECT 1 FROM kpi WHERE employee_id = 'dito' AND name = 'SLA compliance % (Helpdesk Tiket)'
  );
