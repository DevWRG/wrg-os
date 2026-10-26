-- 255 — F60 Audit Findings: approval penutupan temuan pindah ke mesin F11 (#1863).
--
-- F60 (191) membangun SALINAN mesin approval sendiri: audit_finding_approval_
-- chain_config (5 layer, tiap layer = access_group + enabled), _request,
-- _step, plus job pengingat harian. Mulai migrasi ini penutupan temuan lewat
-- approval_request alur 'audit-finding'; tahapnya = approval_chain_config
-- jenis 'audit-finding' (target 'grup'), yang tetap diatur dari panel
-- /audit-findings/config (panel itu kini membaca/menulis config engine).
--
-- Aturan F60 yang dibawa ke engine:
--   • pengaju tak boleh memutus (sudah aturan umum engine);
--   • satu orang hanya boleh memutus SATU tahap per pengajuan →
--     approval_alur.satu_orang_satu_tahap (baru, default false; true di sini);
--   • penjaga klik basi (expectedUrutan) → opsi decideFromDashboard.
-- Pengingat harian F60 digantikan SLA engine (APPROVAL_SLA_ENABLED):
-- sla_jam 72 = ambang lama AUDIT_FINDING_REMINDER_DAYS (3 hari).
--
-- Tabel F60 lama TIDAK dihapus — jadi riwayat. Pengajuan yang MASIH pending
-- dipindah ke engine (posisi tahap & keputusan yang sudah ada ikut), lalu baris
-- lamanya ditandai canceled + dipindah_ke supaya tak ada dua pengajuan aktif.
--
-- Idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE approval_alur ADD COLUMN IF NOT EXISTS satu_orang_satu_tahap boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN approval_alur.satu_orang_satu_tahap IS
  'true = satu akun hanya boleh memutus satu tahap per request (anggota dua grup approver tak bisa meloloskan dua tahap sendirian).';

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, satu_orang_satu_tahap, catatan) VALUES
  ('audit-finding', 'Penutupan Temuan Audit', 72, true, true,
   'F60 — penutupan temuan Komite Audit. Tahap & grup diatur di /audit-findings/config (min. 2 tahap aktif).')
ON CONFLICT (jenis) DO NOTHING;

-- Salin config F60 (urutan, label, grup, enabled) ke config engine.
INSERT INTO approval_chain_config (jenis, urutan, label, target_type, group_key, aktif, catatan)
SELECT 'audit-finding', c.urutan, c.label, 'grup', g.key, c.enabled, 'Disalin dari config F60 (migrasi 255).'
FROM audit_finding_approval_chain_config c
LEFT JOIN access_group g ON g.id = c.access_group_id
ON CONFLICT (jenis, urutan) DO NOTHING;

ALTER TABLE audit_finding ADD COLUMN IF NOT EXISTS approval_request_id uuid;
ALTER TABLE audit_finding_approval_request ADD COLUMN IF NOT EXISTS dipindah_ke uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_finding_approval_request_id_fkey') THEN
    ALTER TABLE audit_finding
      ADD CONSTRAINT audit_finding_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_request (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Pindahkan pengajuan penutupan yang masih berjalan ─────────────
DO $$
DECLARE
  lr       record;
  n        bigint;
  req_id   uuid;
BEGIN
  FOR lr IN
    SELECT r.*, f.kode AS f_kode, f.title AS f_title, u.name AS pengaju_nama, u.wa_number AS pengaju_wa
    FROM audit_finding_approval_request r
    JOIN audit_finding f ON f.id = r.finding_id
    LEFT JOIN app_user u ON u.id = r.requested_by
    WHERE r.status = 'pending' AND r.dipindah_ke IS NULL
    ORDER BY r.requested_at
  LOOP
    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, ref_tabel, ref_id, created_at)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'audit-finding', left('Penutupan temuan ' || lr.f_kode || ': ' || lr.f_title, 200),
       COALESCE(lr.pengaju_nama, 'PIC temuan'), NULLIF(lr.pengaju_wa, ''), lr.requested_by,
       lr.current_urutan, 'audit_finding', lr.finding_id::text, lr.requested_at)
    RETURNING id INTO req_id;

    -- Urutan langkah lama (1..N tahap aktif saat diajukan) dipertahankan apa
    -- adanya — current_urutan request lama menunjuk ke urutan yang sama.
    INSERT INTO approval_step
      (request_id, urutan, label, target_type, group_key, status, notified_at, reminded_at,
       decided_by, decided_by_user_id, decided_at, decision_note, decided_via)
    SELECT req_id, s.urutan, s.label, 'grup', g.key, s.status, s.notified_at, s.reminded_at,
           du.name, s.decided_by, s.decided_at, s.decision_note,
           CASE WHEN s.decided_at IS NOT NULL THEN 'dashboard' END
    FROM audit_finding_approval_step s
    LEFT JOIN access_group g ON g.id = s.access_group_id
    LEFT JOIN app_user du ON du.id = s.decided_by
    WHERE s.request_id = lr.id;

    UPDATE audit_finding_approval_request SET status = 'canceled', dipindah_ke = req_id, decided_at = now() WHERE id = lr.id;
    UPDATE audit_finding SET approval_request_id = req_id WHERE id = lr.finding_id;
  END LOOP;
END $$;

COMMENT ON COLUMN audit_finding.approval_request_id IS
  'F11 kanonik (migrasi 255) — pengajuan penutupan TERAKHIR di engine. Riwayat pra-255 ada di audit_finding_approval_request.';
COMMENT ON COLUMN audit_finding_approval_request.dipindah_ke IS
  'Pengajuan yang masih berjalan saat migrasi 255 dipindah ke approval_request ini (baris lama ditandai canceled).';
