-- 306 — Helpdesk GA (F139) menyerap Tiket IT (F52). Keputusan user 11 Nov 2026:
-- satu jalur pelaporan saja. Dulu kerusakan laptop/PC bisa dilaporkan di dua
-- tempat (tab "Tiket IT" di /ga-aset dan /ga-helpdesk), laporannya tersebar.
--
-- Isi:
--   1. ga_tickets.asset_id — opsional. Tiket boleh tanpa aset (AC mati, dsb.);
--      kalau ada, tiket menempel ke aset ga_assets (single source of truth aset).
--   2. ga_tickets.legacy_it_ticket_id — penanda asal salinan, UNIQUE, supaya
--      langkah 4 idempoten (deploy ulang tak menggandakan tiket).
--   3. Kategori 'IT' (Perangkat IT) — rumah tiket hasil salinan + pilihan
--      default untuk laporan kerusakan perangkat ke depan.
--   4. Salin semua baris it_ticket → ga_tickets. Pemetaan:
--        masalah            → title (dipotong 120) + description (utuh)
--        resolved_note      → ditempel di description (Helpdesk tak punya kolomnya)
--        is_critical aset   → priority 'critical', selain itu 'medium'
--        open / in_progress → status sama; resolved → 'closed' (terminal di
--                             kedua sistem; completed_at = closed_at = resolved_at)
--        pelapor/PIC        → akun (164) kalau tertaut, kalau tidak nama teks
--      Nomor tiket TKT-<tahun dibuat>-NNNNN melanjutkan nomor terakhir tahun itu.
--      Tiket yang SUDAH lewat SLA & belum dialert diberi sla_alert_sent_at
--      = now(): alert overdue Helpdesk (ke assignee + HoD) tak boleh meledak
--      mengirim WA untuk tiket lama begitu migrasi jalan.
--
-- it_ticket TIDAK di-DROP — dibiarkan sebagai arsip; kode tak membacanya lagi.
-- Tanpa BEGIN/COMMIT sendiri — runner yang mengatur transaksi.

ALTER TABLE ga_tickets
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES ga_assets (id) ON DELETE SET NULL;
ALTER TABLE ga_tickets
  ADD COLUMN IF NOT EXISTS legacy_it_ticket_id uuid UNIQUE;
CREATE INDEX IF NOT EXISTS ga_tickets_asset_idx ON ga_tickets (asset_id);

COMMENT ON COLUMN ga_tickets.asset_id IS
  '306 — aset GA yang bermasalah (opsional). Pengganti it_ticket.asset_id sejak Tiket IT (F52) diserap Helpdesk.';
COMMENT ON COLUMN ga_tickets.legacy_it_ticket_id IS
  '306 — id it_ticket asal kalau tiket ini salinan dari Tiket IT lama. NULL = tiket Helpdesk biasa.';

INSERT INTO ga_ticket_categories (code, nama, icon, default_sla_hours, default_priority)
VALUES ('IT', 'Perangkat IT', '🖥️', 24, 'medium')
ON CONFLICT (code) DO NOTHING;

WITH src AS (
  SELECT t.*, a.is_critical,
         EXTRACT(YEAR FROM t.created_at AT TIME ZONE 'Asia/Jakarta')::int AS thn,
         row_number() OVER (
           PARTITION BY EXTRACT(YEAR FROM t.created_at AT TIME ZONE 'Asia/Jakarta')
           ORDER BY t.created_at, t.id
         ) AS urut
  FROM it_ticket t
  JOIN ga_assets a ON a.id = t.asset_id
  WHERE NOT EXISTS (SELECT 1 FROM ga_tickets g WHERE g.legacy_it_ticket_id = t.id)
),
basis AS (
  SELECT s.thn,
         COALESCE((
           SELECT MAX(SUBSTRING(g.ticket_no FROM 10)::int)
           FROM ga_tickets g
           WHERE g.ticket_no LIKE 'TKT-' || s.thn || '-%'
         ), 0) AS maks
  FROM (SELECT DISTINCT thn FROM src) s
)
INSERT INTO ga_tickets (
  ticket_no, title, description, category_id, priority,
  reporter_user_id, reporter_name_override, assignee_user_id, assignee_name_override,
  sla_due_at, status, opened_at, started_at, completed_at, closed_at,
  sla_alert_sent_at, asset_id, legacy_it_ticket_id, created_at, updated_at
)
SELECT
  'TKT-' || s.thn || '-' || LPAD((b.maks + s.urut)::text, 5, '0'),
  LEFT(s.masalah, 120),
  s.masalah || CASE WHEN NULLIF(BTRIM(s.resolved_note), '') IS NOT NULL
                    THEN E'\n\nCatatan penyelesaian (Tiket IT lama): ' || s.resolved_note
                    ELSE '' END,
  (SELECT id FROM ga_ticket_categories WHERE code = 'IT'),
  CASE WHEN s.is_critical THEN 'critical' ELSE 'medium' END,
  s.reported_by_user_id,
  CASE WHEN s.reported_by_user_id IS NULL THEN s.reported_by END,
  s.assigned_to_user_id,
  CASE WHEN s.assigned_to_user_id IS NULL THEN s.assigned_to END,
  s.sla_due_at,
  CASE s.status WHEN 'resolved' THEN 'closed' ELSE s.status END,
  s.created_at,
  CASE WHEN s.status <> 'open' THEN s.updated_at END,
  CASE WHEN s.status = 'resolved' THEN COALESCE(s.resolved_at, s.updated_at) END,
  CASE WHEN s.status = 'resolved' THEN COALESCE(s.resolved_at, s.updated_at) END,
  CASE WHEN s.sla_alert_sent_at IS NOT NULL THEN s.sla_alert_sent_at
       WHEN s.status <> 'resolved' AND s.sla_due_at < now() THEN now() END,
  s.asset_id,
  s.id,
  s.created_at,
  s.updated_at
FROM src s JOIN basis b ON b.thn = s.thn;
