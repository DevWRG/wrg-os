-- 248 — F138 Dana Operasional jadi konsumen pertama mesin approval F11 (#1863).
--
-- Sebelumnya fund_request punya jalur approval sendiri (fund_request_approval:
-- HoD pilihan pengaju → Direktur, dashboard saja, tanpa WA/SLA). Mulai
-- migrasi ini keputusan dana ops lewat approval_request alur 'dana-ops':
--   tahap 1 = HoD pengaju (hod_approver_key yang dipilih saat mengajukan)
--   tahap 2 = Direktur
-- Notifikasi WA per tahap, #APPROVE/#REJECT, SLA, larangan memutus pengajuan
-- sendiri — semuanya dari engine.
--
-- fund_request_approval TIDAK dihapus: baris yang sudah final tetap jadi
-- jejak audit. Status pengajuan dibaca dari approval_step bila
-- approval_request_id terisi, dari fund_request_approval bila tidak.
--
-- Pengajuan yang MASIH MENUNGGU saat migrasi ini jalan DIPINDAH ke engine
-- (keputusan pemilik 26 Okt 2026): dibuatkan approval_request dengan posisi
-- tahap yang sama (HoD sudah setuju → mulai di tahap Direktur). Notifikasinya
-- belum terkirim (notified_at NULL) — kirim dari halaman detail approval
-- atau POST /approval-requests/:id/notify. Hitungan SLA mulai saat itu.
--
-- Idempoten: backfill hanya menyentuh fund_request tanpa approval_request_id.
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, catatan) VALUES
  ('dana-ops', 'Dana Operasional', 48, true,
   'F138 — pengajuan dana operasional karyawan. HoD dipilih pengaju saat mengajukan, lalu Direktur.')
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, catatan) VALUES
  ('dana-ops', 1, 'HoD', 'hod_pengaju', 'HoD yang dipilih pengaju di form Dana Operasional.'),
  ('dana-ops', 2, 'Direktur', 'direktur', 'Keputusan final.')
ON CONFLICT (jenis, urutan) DO NOTHING;

ALTER TABLE fund_request ADD COLUMN IF NOT EXISTS approval_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_request_approval_request_id_fkey') THEN
    ALTER TABLE fund_request
      ADD CONSTRAINT fund_request_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_request (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS fund_request_approval_request_id_uq
  ON fund_request (approval_request_id) WHERE approval_request_id IS NOT NULL;

-- ── Pindahkan pengajuan yang masih menunggu ───────────────────────
DO $$
DECLARE
  fr        record;
  hod       record;
  n         bigint;
  req_id    uuid;
  pengaju   record;
BEGIN
  FOR fr IN
    SELECT f.*
    FROM fund_request f
    WHERE f.approval_request_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM fund_request_approval a WHERE a.fund_request_id = f.id AND a.status = 'rejected')
      AND NOT EXISTS (SELECT 1 FROM fund_request_approval a WHERE a.fund_request_id = f.id AND a.approver_role = 'direktur' AND a.status = 'approved')
    ORDER BY f.created_at
  LOOP
    SELECT status, decided_by, decided_at, note INTO hod
      FROM fund_request_approval WHERE fund_request_id = fr.id AND approver_role = 'hod';
    SELECT id, wa_number INTO pengaju
      FROM app_user WHERE lower(email) = lower(fr.requester_email) ORDER BY created_at LIMIT 1;

    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, description, nominal, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, hod_pengaju, ref_tabel, ref_id, created_at)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'dana-ops',
       left('Dana operasional: ' || fr.purpose, 200),
       concat_ws(E'\n', CASE WHEN fr.cabang IS NOT NULL THEN 'Cabang: ' || fr.cabang END, fr.notes),
       fr.amount_requested, fr.requester_name, NULLIF(pengaju.wa_number, ''), pengaju.id,
       CASE WHEN hod.status = 'approved' THEN 2 ELSE 1 END,
       fr.hod_approver_key, 'fund_request', fr.id::text, fr.created_at)
    RETURNING id INTO req_id;

    INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key, status, decided_by, decided_at, decision_note, decided_via)
    VALUES
      (req_id, 1, 'HoD', 'hod_pengaju', fr.hod_approver_key,
       CASE WHEN hod.status = 'approved' THEN 'approved' ELSE 'pending' END,
       CASE WHEN hod.status = 'approved' THEN hod.decided_by END,
       CASE WHEN hod.status = 'approved' THEN hod.decided_at END,
       CASE WHEN hod.status = 'approved' THEN hod.note END,
       CASE WHEN hod.status = 'approved' THEN 'dashboard' END),
      (req_id, 2, 'Direktur', 'direktur', NULL, 'pending', NULL, NULL, NULL, NULL);

    UPDATE fund_request SET approval_request_id = req_id, updated_at = now() WHERE id = fr.id;
  END LOOP;
END $$;

COMMENT ON COLUMN fund_request.approval_request_id IS
  'F11 kanonik (migrasi 248) — approval pengajuan ini. NULL = pengajuan lama yang sudah final di fund_request_approval.';
