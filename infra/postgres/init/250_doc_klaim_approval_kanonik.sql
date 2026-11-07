-- 250 — DOC #KLAIM jadi konsumen mesin approval F11 (#1863).
--
-- Keputusan setujui/tolak klaim (222: HoD pengaju, atau Direktur/admin) kini
-- lewat approval_request alur 'doc-klaim':
--   tahap 1 = HoD pengaju (doc_klaim.hod_key). Klaim yang HoD-nya tak
--             tercatat dialihkan ke Direktur di langkahnya sendiri
--             (jikaHodKosong='direktur'), sama dengan aturan 222.
-- Approver menerima WA + bisa #APPROVE/#REJECT; nominal disetujui yang
-- berbeda dari nota tetap diputus dari halaman /doc-klaim.
--
-- "Tandai dibayar" (Finance) BUKAN approval — tetap aksi di /doc-klaim.
--
-- Klaim berstatus 'baru' saat migrasi ini jalan dipindah ke engine. Belum
-- ada notifikasi untuk klaim pindahan — kirim dari halaman detail approval.
--
-- Idempoten: backfill hanya menyentuh klaim tanpa approval_request_id.
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, catatan) VALUES
  ('doc-klaim', 'Klaim Reimburse', 48, true,
   'DOC #KLAIM — reimburse karyawan. Setujui/tolak oleh HoD pengaju; dibayar ditandai Finance di /doc-klaim.')
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, catatan) VALUES
  ('doc-klaim', 1, 'HoD', 'hod_pengaju',
   'HoD pengaju saat klaim masuk. HoD tak tercatat → dialihkan ke Direktur per klaim.')
ON CONFLICT (jenis, urutan) DO NOTHING;

ALTER TABLE doc_klaim ADD COLUMN IF NOT EXISTS approval_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_klaim_approval_request_id_fkey') THEN
    ALTER TABLE doc_klaim
      ADD CONSTRAINT doc_klaim_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_request (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Pindahkan klaim yang masih 'baru' ─────────────────────────────
DO $$
DECLARE
  k        record;
  n        bigint;
  req_id   uuid;
  p_id     uuid;
  p_wa     text;
BEGIN
  FOR k IN
    SELECT d.*, e.nama AS employee_nama
    FROM doc_klaim d LEFT JOIN employee e ON e.id = d.employee_id
    WHERE d.status = 'baru' AND d.approval_request_id IS NULL
    ORDER BY d.created_at
  LOOP
    -- Skalar, bukan record: record yang tak pernah di-SELECT INTO (klaim
    -- tanpa am_id) tak bisa dibaca field-nya.
    p_id := NULL;
    p_wa := NULL;
    IF k.am_id IS NOT NULL THEN
      SELECT id, wa_number INTO p_id, p_wa FROM app_user WHERE am_id = k.am_id AND active ORDER BY created_at LIMIT 1;
    END IF;

    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, description, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, hod_pengaju, ref_tabel, ref_id, created_at)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'doc-klaim',
       left('Klaim: ' || COALESCE(NULLIF(k.pihak, ''), 'nota') || COALESCE(' — ' || NULLIF(k.nominal, ''), ''), 200),
       concat_ws(E'\n', CASE WHEN k.kategori IS NOT NULL THEN 'Kategori: ' || k.kategori END,
                        CASE WHEN k.nomor_dokumen IS NOT NULL THEN 'No. nota: ' || k.nomor_dokumen END, k.caption),
       COALESCE(k.employee_nama, k.sender_name, 'Karyawan'), NULLIF(p_wa, ''), p_id,
       1, k.hod_key, 'doc_klaim', k.id::text, k.created_at)
    RETURNING id INTO req_id;

    INSERT INTO approval_step (request_id, urutan, label, target_type, hod_key)
    VALUES (req_id, 1,
            CASE WHEN k.hod_key IS NULL THEN 'HoD (dialihkan ke Direktur)' ELSE 'HoD' END,
            CASE WHEN k.hod_key IS NULL THEN 'direktur' ELSE 'hod_pengaju' END,
            k.hod_key);

    UPDATE doc_klaim SET approval_request_id = req_id, updated_at = now() WHERE id = k.id;
  END LOOP;
END $$;

COMMENT ON COLUMN doc_klaim.approval_request_id IS
  'F11 kanonik (migrasi 250) — approval setujui/tolak klaim. NULL = klaim yang sudah diputus sebelum 250.';
