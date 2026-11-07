-- 251 — #OVERTIME (lembur) jadi konsumen mesin approval F11 (#1863).
--
-- Sebelumnya overtime_request punya keputusan sendiri (satu tahap: HoD divisi
-- pengaju, atau admin/Direktur mewakili), lewat #APPROVE OT-xxxx / dashboard,
-- tanpa SLA. Mulai migrasi ini keputusannya lewat approval_request alur
-- 'lembur':
--   tahap 1 = HoD pengaju (overtime_request.hod_key)
-- Kode OT-xxxx TETAP dipakai pengaju & grup — #APPROVE OT-xxxx diteruskan ke
-- approval-nya. Hasil keputusan tetap diumumkan ke grup asal pengajuan.
--
-- Pengajuan yang HoD-nya belum diketahui TIDAK dibuatkan approval sampai
-- admin menetapkan HoD (perilaku lama: tertahan menunggu admin).
--
-- Pengajuan 'pending' ber-HoD saat migrasi ini jalan dipindah ke engine
-- (notified_at diisi dari notify_status='terkirim' supaya SLA langsung jalan
-- untuk yang HoD-nya sudah menerima WA lama).
--
-- Idempoten: backfill hanya menyentuh baris tanpa approval_request_id.
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, catatan) VALUES
  ('lembur', 'Lembur', 24, true,
   '#OVERTIME — pengajuan lembur SEBELUM dikerjakan; SLA lebih pendek karena lembur biasanya hari yang sama.')
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, catatan) VALUES
  ('lembur', 1, 'HoD divisi', 'hod_pengaju', 'HoD divisi pengaju; admin bisa menetapkan/mengganti di menu Lembur.')
ON CONFLICT (jenis, urutan) DO NOTHING;

ALTER TABLE overtime_request ADD COLUMN IF NOT EXISTS approval_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'overtime_request_approval_request_id_fkey') THEN
    ALTER TABLE overtime_request
      ADD CONSTRAINT overtime_request_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_request (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Pindahkan pengajuan pending yang HoD-nya sudah diketahui ───────
DO $$
DECLARE
  o       record;
  n       bigint;
  req_id  uuid;
  p_id    uuid;
  p_wa    text;
BEGIN
  FOR o IN
    SELECT * FROM overtime_request
    WHERE status = 'pending' AND hod_key IS NOT NULL AND approval_request_id IS NULL
    ORDER BY created_at
  LOOP
    p_id := NULL;
    p_wa := NULL;
    SELECT id, wa_number INTO p_id, p_wa FROM app_user WHERE am_id = o.am_id AND active ORDER BY created_at LIMIT 1;

    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, description, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, hod_pengaju, ref_tabel, ref_id, created_at)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'lembur',
       left('Lembur ' || o.kode || ': ' || o.nama, 200),
       'Tanggal: ' || o.tanggal_lembur || E'\nEstimasi: ' || o.estimasi_menit || E' menit\nPekerjaan: ' || o.uraian,
       o.nama, NULLIF(p_wa, ''), p_id, 1, o.hod_key, 'overtime_request', o.id::text, o.created_at)
    RETURNING id INTO req_id;

    INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key, notified_at)
    VALUES (req_id, 1, 'HoD divisi', 'hod_pengaju', o.hod_key,
            CASE WHEN o.notify_status = 'terkirim' THEN o.created_at END);

    UPDATE overtime_request SET approval_request_id = req_id WHERE id = o.id;
  END LOOP;
END $$;

COMMENT ON COLUMN overtime_request.approval_request_id IS
  'F11 kanonik (migrasi 251) — approval pengajuan lembur. NULL = sudah diputus sebelum 251, atau HoD belum ditetapkan.';
