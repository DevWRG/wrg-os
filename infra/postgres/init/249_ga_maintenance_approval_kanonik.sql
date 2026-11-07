-- 249 — Maintenance GA (F137) jadi konsumen mesin approval F11 (#1863).
--
-- Sebelumnya: jadwal yang selesai dengan biaya > ambang (GA_MAINTENANCE_
-- FINANCE_THRESHOLD, default Rp5jt) jatuh ke status 'pending_finance' dan
-- menunggu tombol "Approve Finance" di /ga-aset — tanpa WA, tanpa SLA, tanpa
-- jalur tolak. Mulai migrasi ini 'pending_finance' membuka approval_request
-- alur 'ga-maintenance':
--   tahap 1 = anggota grup akses 'finance-hod' (grup yang sama dengan
--             verifikasi insentif & pembayaran doc-klaim; bisa diganti di
--             Config Approval)
-- Disetujui → status 'done' + approved_by/approved_at + jadwal berikutnya.
-- Ditolak  → kembali 'in_progress'; menyelesaikan ulang SELALU butuh approval
--            lagi berapa pun biayanya (tolak tak boleh jadi jalan pintas
--            menurunkan biaya di bawah ambang).
--
-- Jadwal yang MASIH 'pending_finance' saat migrasi ini jalan dipindah ke
-- engine (keputusan pemilik 26 Okt 2026, sama dengan dana ops). Notifikasinya
-- belum terkirim — kirim dari halaman detail approval.
--
-- Idempoten: backfill hanya menyentuh baris tanpa approval_request_id.
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, catatan) VALUES
  ('ga-maintenance', 'Maintenance GA', 48, true,
   'F137 — biaya maintenance di atas ambang Finance (GA_MAINTENANCE_FINANCE_THRESHOLD, default Rp5jt).')
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, group_key, catatan) VALUES
  ('ga-maintenance', 1, 'Finance', 'grup', 'finance-hod',
   'Semua anggota grup dinotif, satu cukup memutus. Grup harus ada di Akses Grup.')
ON CONFLICT (jenis, urutan) DO NOTHING;

ALTER TABLE ga_maintenance_schedules ADD COLUMN IF NOT EXISTS approval_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_maintenance_schedules_approval_request_id_fkey') THEN
    ALTER TABLE ga_maintenance_schedules
      ADD CONSTRAINT ga_maintenance_schedules_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_request (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Pindahkan jadwal yang masih menunggu Finance ───────────────────
DO $$
DECLARE
  m       record;
  n       bigint;
  req_id  uuid;
BEGIN
  FOR m IN
    SELECT s.id, s.cost_actual, s.maint_type, s.notes, s.completed_at, s.created_at, a.asset_code, a.nama
    FROM ga_maintenance_schedules s JOIN ga_assets a ON a.id = s.asset_id
    WHERE s.status = 'pending_finance' AND s.approval_request_id IS NULL
    ORDER BY s.completed_at NULLS LAST, s.created_at
  LOOP
    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, description, nominal, requested_by, current_urutan, ref_tabel, ref_id, created_at)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'ga-maintenance',
       left('Maintenance GA: ' || m.asset_code || ' — ' || m.nama || ' (' || m.maint_type || ')', 200),
       m.notes, m.cost_actual, 'GA (pindahan)', 1, 'ga_maintenance_schedules', m.id::text,
       COALESCE(m.completed_at, m.created_at))
    RETURNING id INTO req_id;

    INSERT INTO approval_step (request_id, urutan, label, target_type, group_key)
    SELECT req_id, 1, c.label, c.target_type, c.group_key
    FROM approval_chain_config c WHERE c.jenis = 'ga-maintenance' AND c.urutan = 1;

    UPDATE ga_maintenance_schedules SET approval_request_id = req_id, updated_at = now() WHERE id = m.id;
  END LOOP;
END $$;

COMMENT ON COLUMN ga_maintenance_schedules.approval_request_id IS
  'F11 kanonik (migrasi 249) — approval Finance TERAKHIR jadwal ini (biaya > ambang). Status approval-nya menentukan transisi pending_finance → done / in_progress.';
