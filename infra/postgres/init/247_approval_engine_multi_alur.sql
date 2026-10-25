-- 247 — F11 jadi mesin approval KANONIK: banyak alur, bukan satu chain global.
--
-- Sebelumnya approval_chain_config = SATU chain 5 tahap (HoD Sales → HoD
-- Bisnis → HoD After Sales → HoD Supply Chain → Direktur) untuk semua
-- request. Itu bentuk alur PENGADAAN; modul lain (dana ops F138, maintenance
-- GA, doc-klaim, lembur, audit finding) punya alur yang sama sekali lain dan
-- selama ini membangun tabel approval sendiri-sendiri. Migrasi ini membuat
-- engine bisa menampung alur-alur itu tanpa mengubah perilaku alur lama:
--
--   approval_alur            — 1 baris per jenis alur + SLA-nya.
--   approval_chain_config    — tahap per (jenis, urutan). Baris lama = jenis
--                              'pengadaan', isinya tak disentuh.
--   target_type baru         — 'hod_pengaju' (HoD yang dibawa request, mis.
--                              HoD divisi pengaju) dan 'grup' (anggota
--                              access_group, mis. finance-hod).
--   aktif                    — tahap boleh dimatikan tanpa dihapus; request
--                              baru tak membuat langkah untuk tahap mati.
--   approval_request.ref_*   — tautan ke baris modul induk (konsumen); satu
--                              baris induk maksimal punya SATU request pending.
--   requested_by_user_id     — dasar larangan memutuskan permintaan sendiri.
--   approval_step.reminded_at/escalated_at — jejak SLA (pengingat & eskalasi).
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS approval_alur (
  jenis       text PRIMARY KEY CHECK (jenis ~ '^[a-z][a-z0-9_-]{1,39}$'),
  label       text NOT NULL,
  -- Batas waktu per tahap, dihitung dari notifikasi tahap itu terkirim.
  -- Lewat sla_jam → pengingat ke approver; lewat 2× sla_jam → eskalasi.
  -- NULL = alur ini tanpa SLA.
  sla_jam     int CHECK (sla_jam IS NULL OR sla_jam BETWEEN 1 AND 720),
  -- false = cukup pengingat, tanpa eskalasi ke Direktur.
  eskalasi    boolean NOT NULL DEFAULT true,
  catatan     text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO approval_alur (jenis, label, sla_jam, eskalasi, catatan) VALUES
  ('pengadaan', 'Pengadaan', 48, true,
   'Alur asli F11 (migrasi 153/190): usulan forecast & permintaan approval manual.')
ON CONFLICT (jenis) DO NOTHING;

-- ── approval_chain_config: tahap per alur ──────────────────────────
ALTER TABLE approval_chain_config ADD COLUMN IF NOT EXISTS jenis text NOT NULL DEFAULT 'pengadaan';
ALTER TABLE approval_chain_config ADD COLUMN IF NOT EXISTS group_key text;
ALTER TABLE approval_chain_config ADD COLUMN IF NOT EXISTS aktif boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_chain_config_jenis_fkey') THEN
    ALTER TABLE approval_chain_config
      ADD CONSTRAINT approval_chain_config_jenis_fkey FOREIGN KEY (jenis) REFERENCES approval_alur (jenis);
  END IF;

  -- PK lama (urutan) → (jenis, urutan): urutan 1 boleh ada di tiap alur.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'approval_chain_config_pkey'
      AND array_length(c.conkey, 1) = 1
  ) THEN
    ALTER TABLE approval_chain_config DROP CONSTRAINT approval_chain_config_pkey;
    ALTER TABLE approval_chain_config ADD CONSTRAINT approval_chain_config_pkey PRIMARY KEY (jenis, urutan);
  END IF;

  ALTER TABLE approval_chain_config DROP CONSTRAINT IF EXISTS approval_chain_config_target_type_check;
  ALTER TABLE approval_chain_config
    ADD CONSTRAINT approval_chain_config_target_type_check
    CHECK (target_type IN ('hod', 'direktur', 'hod_pengaju', 'grup'));
END $$;

-- ── approval_request: alur + tautan induk + pengaju ────────────────
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS jenis text NOT NULL DEFAULT 'pengadaan';
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS ref_tabel text;
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS ref_id text;
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS hod_pengaju text;
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS requested_by_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_jenis_fkey') THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_jenis_fkey FOREIGN KEY (jenis) REFERENCES approval_alur (jenis);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_requested_by_user_id_fkey') THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_requested_by_user_id_fkey
      FOREIGN KEY (requested_by_user_id) REFERENCES app_user (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_ref_lengkap_check') THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_ref_lengkap_check CHECK ((ref_tabel IS NULL) = (ref_id IS NULL));
  END IF;
END $$;

-- Satu baris induk = maksimal satu approval yang masih berjalan. Klik ganda /
-- submit paralel dari modul konsumen tak bisa melahirkan request kembar
-- (kelas bug #1582 forecast).
CREATE UNIQUE INDEX IF NOT EXISTS approval_request_ref_pending_uq
  ON approval_request (ref_tabel, ref_id) WHERE status = 'pending' AND ref_tabel IS NOT NULL;
CREATE INDEX IF NOT EXISTS approval_request_jenis_status_idx ON approval_request (jenis, status);

-- ── approval_step: target grup + jejak SLA + kanal keputusan ───────
ALTER TABLE approval_step ADD COLUMN IF NOT EXISTS group_key text;
ALTER TABLE approval_step ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE approval_step ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
ALTER TABLE approval_step ADD COLUMN IF NOT EXISTS decided_by_user_id uuid;
ALTER TABLE approval_step ADD COLUMN IF NOT EXISTS decided_via text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_step_decided_via_check') THEN
    ALTER TABLE approval_step
      ADD CONSTRAINT approval_step_decided_via_check CHECK (decided_via IS NULL OR decided_via IN ('wa', 'dashboard'));
  END IF;
END $$;

COMMENT ON TABLE approval_alur IS
  'F11 kanonik — 1 baris per jenis alur approval. sla_jam per tahap (pengingat), 2× sla_jam = eskalasi ke Direktur bila eskalasi=true.';
COMMENT ON COLUMN approval_chain_config.target_type IS
  'hod = hod_key slot/peta · direktur = app_user.role direktur · hod_pengaju = hod_key yang dibawa request · grup = anggota access_group.key = group_key';
COMMENT ON COLUMN approval_request.ref_tabel IS
  'Tabel modul induk (konsumen) — mis. fund_request. Engine memanggil penangan konsumen terdaftar untuk ref_tabel ini saat request selesai.';

-- Default privileges 039 sudah memberi DML ke wrg_app; ditulis eksplisit supaya DB baru sama.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON public.approval_alur TO wrg_app;
  END IF;
END $$;
