-- 270 — Insentif bulanan AM (F67) jadi konsumen mesin approval F11 (#1863).
--
-- Sebelumnya rantai persetujuan insentif punya mesin sendiri (migrasi 183):
-- tabel insentif_approval_step + insentif_approval_log, tanpa WA, tanpa SLA,
-- dan grup administrator boleh mewakili langkah mana pun. Mulai migrasi ini
-- langkah PERSETUJUAN-nya lewat approval_request alur 'insentif':
--
--   urutan 2 = HoD Sales wilayah AM (hod_pengaju: cabang AM → hod_territory)
--   urutan 3 = Verifikasi Finance  (grup, dari insentif_approval_step step 3)
--   urutan 4 = Kompilasi Corsec    (grup, step 4)
--   urutan 5 = Persetujuan Direktur (step 5; grup 'direktur' → target direktur)
--
-- Nomor urutan SENGAJA sama dengan nomor step insentif (1 = Ajukan oleh AM,
-- 6 = Bayar oleh HRD) supaya current_urutan langsung terbaca sebagai step.
-- Ajukan (1) = membuat request; Bayar (6) tetap tindakan modul di luar mesin
-- (keputusan pemilik 3 Nov 2026, pola doc-klaim "tandai dibayar").
--
-- insentif_bulanan.status TETAP bergerak per tahap (submitted → hod_review →
-- finance_verify → corsec_compile → direktur_approve) lewat kait setiapTahap
-- di penangan konsumen — kunci lead/effort/compute membaca status itu.
-- insentif_approval_log juga tetap ditulis (jejak + pagar unik satu akun satu
-- langkah per siklus tetap berlaku sampai langkah Bayar).
--
-- Bypass superuser hilang untuk langkah persetujuan (sama dengan konsumen
-- lain). Nominal TIDAK dimasukkan ke approval_request: WA tahap grup terkirim
-- ke semua anggota grup, dan insentif itu data gaji.
--
-- Rekap yang sedang di tengah rantai (submitted..corsec_compile) dipindah ke
-- engine; tahap yang sudah lewat ditandai approved dengan pemutus dari log
-- (decided_by_user_id ikut, jadi aturan satu orang satu tahap tetap jalan).
-- notified_at dibiarkan NULL: mesin lama tak pernah mengirim WA, kirim dari
-- halaman detail approval bila perlu. Rekap yang HoD wilayahnya tak terpetakan
-- jatuh ke grup sales-hod (perilaku lama) supaya tidak macet.
--
-- Idempoten: backfill hanya menyentuh baris tanpa approval_request_id.
-- Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, satu_orang_satu_tahap, catatan) VALUES
  ('insentif', 'Insentif bulanan AM', 72, true, true,
   'F67 — rekap insentif bulanan per AM. Ajukan = AM; Bayar (HRD) di luar mesin, di menu Insentif.')
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, catatan) VALUES
  ('insentif', 2, 'Review HOD Sales', 'hod_pengaju', 'HoD wilayah AM (cabang master_user → hod_territory).')
ON CONFLICT (jenis, urutan) DO NOTHING;

INSERT INTO approval_chain_config (jenis, urutan, label, target_type, group_key, catatan)
SELECT 'insentif', s.step, s.label,
       CASE WHEN s.group_key = 'direktur' THEN 'direktur' ELSE 'grup' END,
       CASE WHEN s.group_key = 'direktur' THEN NULL ELSE s.group_key END,
       'Disalin dari insentif_approval_step (migrasi 183) oleh migrasi 270.'
FROM insentif_approval_step s
WHERE s.step BETWEEN 3 AND 5 AND s.group_key IS NOT NULL
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

-- ── Pindahkan rekap yang sedang menunggu persetujuan ───────────────
DO $$
DECLARE
  b        record;
  c        record;
  v_cur      int;
  v_nama     text;
  v_cabang   text;
  v_hod      text;
  v_n_hod    int;
  p_id     uuid;
  p_wa     text;
  diajukan timestamptz;
  n        bigint;
  req_id   uuid;
  l_user   text;
  l_nama   text;
  l_at     timestamptz;
  l_cat    text;
BEGIN
  FOR b IN
    SELECT * FROM insentif_bulanan
    WHERE status IN ('submitted', 'hod_review', 'finance_verify', 'corsec_compile')
      AND approval_request_id IS NULL
    ORDER BY id
  LOOP
    SELECT step INTO v_cur FROM insentif_approval_step WHERE status_dari = b.status;
    IF v_cur IS NULL OR v_cur NOT BETWEEN 2 AND 5 THEN
      RAISE NOTICE '270: rekap % (%) status % tak punya tahap 2-5 — dilewati', b.id, b.am_id, b.status;
      CONTINUE;
    END IF;

    v_nama := NULL; v_cabang := NULL;
    SELECT m.nama, NULLIF(btrim(m.cabang), '') INTO v_nama, v_cabang FROM master_user m WHERE m.am_id = b.am_id LIMIT 1;
    v_hod := NULL; v_n_hod := 0;
    IF v_cabang IS NOT NULL THEN
      SELECT count(DISTINCT h.hod_key), min(h.hod_key) INTO v_n_hod, v_hod
      FROM hod_territory h WHERE upper(btrim(h.cabang)) = upper(v_cabang);
      IF v_n_hod <> 1 THEN v_hod := NULL; END IF;
    END IF;

    p_id := NULL; p_wa := NULL;
    SELECT id, wa_number INTO p_id, p_wa FROM app_user WHERE am_id = b.am_id AND active ORDER BY created_at LIMIT 1;

    diajukan := NULL;
    SELECT max(acted_at) INTO diajukan FROM insentif_approval_log
    WHERE bulanan_id = b.id AND siklus = b.siklus AND step = 1 AND status_to = 'submitted';

    n := nextval('approval_request_kode_seq');
    INSERT INTO approval_request
      (kode, jenis, title, requested_by, requested_by_wa, requested_by_user_id,
       current_urutan, hod_pengaju, ref_tabel, ref_id, created_at)
    VALUES
      ('APR-' || CASE WHEN length(n::text) >= 4 THEN n::text ELSE lpad(n::text, 4, '0') END,
       'insentif',
       left('Insentif ' || b.periode || ' — ' || COALESCE(v_nama, b.am_id), 200),
       COALESCE(v_nama, b.am_id), NULLIF(p_wa, ''), p_id,
       v_cur, v_hod, 'insentif_bulanan', b.id::text, COALESCE(diajukan, now()))
    RETURNING id INTO req_id;

    FOR c IN
      SELECT * FROM approval_chain_config WHERE jenis = 'insentif' AND aktif ORDER BY urutan
    LOOP
      l_user := NULL; l_nama := NULL; l_at := NULL; l_cat := NULL;
      IF c.urutan < v_cur THEN
        SELECT l.actor_user_id, u.name, l.acted_at, l.catatan INTO l_user, l_nama, l_at, l_cat
        FROM insentif_approval_log l
        LEFT JOIN app_user u ON u.id::text = l.actor_user_id
        WHERE l.bulanan_id = b.id AND l.siklus = b.siklus AND l.step = c.urutan AND l.status_to <> 'draft'
        ORDER BY l.acted_at DESC LIMIT 1;
      END IF;

      INSERT INTO approval_step
        (request_id, urutan, label, target_type, hod_key, group_key, status,
         decided_by, decided_by_user_id, decided_via, decided_at, decision_note)
      VALUES
        (req_id, c.urutan,
         CASE WHEN c.target_type = 'hod_pengaju' AND v_hod IS NULL
              THEN c.label || ' (HoD wilayah tak terpetakan — grup sales-hod)' ELSE c.label END,
         CASE WHEN c.target_type = 'hod_pengaju' AND v_hod IS NULL THEN 'grup' ELSE c.target_type END,
         CASE WHEN c.target_type = 'hod_pengaju' THEN v_hod ELSE c.hod_key END,
         CASE WHEN c.target_type = 'hod_pengaju' AND v_hod IS NULL THEN 'sales-hod' ELSE c.group_key END,
         CASE WHEN c.urutan < v_cur THEN 'approved' ELSE 'pending' END,
         CASE WHEN c.urutan < v_cur THEN COALESCE(l_nama, l_user, '(mesin lama)') END,
         CASE WHEN c.urutan < v_cur AND l_user ~ '^[0-9a-fA-F-]{36}$' THEN l_user::uuid END,
         CASE WHEN c.urutan < v_cur THEN 'dashboard' END,
         CASE WHEN c.urutan < v_cur THEN COALESCE(l_at, now()) END,
         l_cat);
    END LOOP;

    UPDATE insentif_bulanan SET approval_request_id = req_id WHERE id = b.id;
  END LOOP;
END $$;

COMMENT ON COLUMN insentif_bulanan.approval_request_id IS
  'F11 kanonik (migrasi 270) — approval putaran (siklus) terakhir. NULL = belum pernah diajukan sejak 270, atau sudah lewat sebelum 270.';
