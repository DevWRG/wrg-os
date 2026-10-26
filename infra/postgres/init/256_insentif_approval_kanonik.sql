-- 256 — F67 Insentif: rantai persetujuan pindah ke mesin approval F11 (#1863).
--
-- Rantai 183: draft → submitted (AM) → hod_review → finance_verify →
-- corsec_compile → direktur_approve → paid, tiap langkah milik grup akses
-- (insentif_approval_step), satu akun satu langkah per siklus.
--
-- Mulai migrasi ini: "Ajukan" oleh AM tetap aksi insentif (status submitted +
-- jejak), lalu membuka approval_request alur 'insentif' berisi 5 tahap grup:
--   1 Review HOD Sales (sales-hod)     → status hod_review
--   2 Verifikasi Finance (finance-hod) → finance_verify
--   3 Kompilasi Corsec (komite)        → corsec_compile
--   4 Persetujuan Direktur (direktur)  → direktur_approve
--   5 Bayar (hrd)                      → paid
-- Grup awal disalin dari insentif_approval_step (pemetaan yang berlaku saat
-- ini); sesudahnya wewenang diatur di Config Approval engine. Status insentif
-- & insentif_approval_log tetap ditulis per tahap (penangan konsumen) supaya
-- UI, Direktur Inbox, dan pagar unik 183 tetap berlaku.
-- satu_orang_satu_tahap = true (aturan 183), pengaju (AM) tak bisa memutus.
--
-- Rekap yang sedang di tengah rantai dipindah ke engine dengan posisi tahap
-- sama; tahap yang sudah lewat diisi dari jejak siklus berjalan.
--
-- Idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, satu_orang_satu_tahap, catatan) VALUES
  ('insentif', 'Insentif AM', 48, true, true,
   'F67 — rekap insentif bulanan AM. Ajukan oleh AM; 5 tahap grup sampai dibayar HRD. Satu akun satu tahap per putaran.')
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, group_key, catatan)
SELECT 'insentif', s.step - 1, s.label, 'grup', s.group_key, s.keterangan
FROM insentif_approval_step s
WHERE s.step BETWEEN 2 AND 6
ON CONFLICT (jenis, urutan) DO NOTHING;

ALTER TABLE insentif_bulanan ADD COLUMN IF NOT EXISTS approval_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insentif_bulanan_approval_request_id_fkey') THEN
    ALTER TABLE insentif_bulanan
      ADD CONSTRAINT insentif_bulanan_approval_request_id_fkey
      FOREIGN KEY (approval_request_id) REFERENCES approval_request (id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Pindahkan rekap yang sedang di tengah rantai ───────────────────
DO $$
DECLARE
  b        record;
  n        bigint;
  req_id   uuid;
  cur      int;
  p_id     uuid;
  p_wa     text;
  p_nama   text;
BEGIN
  FOR b IN
    SELECT * FROM insentif_bulanan
    WHERE status IN ('submitted', 'hod_review', 'finance_verify', 'corsec_compile', 'direktur_approve')
      AND approval_request_id IS NULL
    ORDER BY periode, am_id
  LOOP
    cur := CASE b.status
      WHEN 'submitted' THEN 1 WHEN 'hod_review' THEN 2 WHEN 'finance_verify' THEN 3
      WHEN 'corsec_compile' THEN 4 WHEN 'direktur_approve' THEN 5 END;
    p_id := NULL; p_wa := NULL; p_nama := NULL;
    SELECT u.id, u.wa_number INTO p_id, p_wa FROM app_user u WHERE u.am_id = b.am_id AND u.active ORDER BY u.created_at LIMIT 1;
    SELECT m.nama INTO p_nama FROM master_user m WHERE m.am_id = b.am_id;

    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, nominal, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, ref_tabel, ref_id)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'insentif', left('Insentif ' || COALESCE(p_nama, b.am_id) || ' — ' || b.periode, 200),
       b.total_insentif_am, COALESCE(p_nama, b.am_id), NULLIF(p_wa, ''), p_id,
       cur, 'insentif_bulanan', b.id::text)
    RETURNING id INTO req_id;

    -- Langkah engine k = langkah insentif k+1. Tahap < cur sudah dilewati:
    -- pemutusnya diambil dari jejak siklus berjalan.
    INSERT INTO approval_step
      (request_id, urutan, label, target_type, group_key, status, notified_at,
       decided_by, decided_by_user_id, decided_at, decision_note, decided_via)
    SELECT req_id, c.urutan, c.label, 'grup', c.group_key,
           CASE WHEN c.urutan < cur THEN 'approved' ELSE 'pending' END,
           NULL,
           CASE WHEN c.urutan < cur THEN u.name END,
           CASE WHEN c.urutan < cur THEN u.id END,
           CASE WHEN c.urutan < cur THEN l.acted_at END,
           CASE WHEN c.urutan < cur THEN l.catatan END,
           CASE WHEN c.urutan < cur THEN 'dashboard' END
    FROM approval_chain_config c
    LEFT JOIN LATERAL (
      SELECT actor_user_id, acted_at, catatan FROM insentif_approval_log
      WHERE bulanan_id = b.id AND siklus = b.siklus AND step = c.urutan + 1 AND status_to <> 'draft'
      ORDER BY acted_at DESC LIMIT 1
    ) l ON true
    -- actor_user_id di jejak 183 bertipe text; dicocokkan sebagai teks supaya
    -- nilai yang bukan uuid tak menggagalkan migrasi (pemutusnya jadi kosong).
    LEFT JOIN app_user u ON u.id::text = l.actor_user_id
    WHERE c.jenis = 'insentif' AND c.aktif;

    UPDATE insentif_bulanan SET approval_request_id = req_id WHERE id = b.id;
  END LOOP;
END $$;

COMMENT ON COLUMN insentif_bulanan.approval_request_id IS
  'F11 kanonik (migrasi 256) — approval putaran BERJALAN. Ditolak + dibuka kembali → ajukan ulang membuat approval baru.';
