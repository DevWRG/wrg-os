-- F67 Sales Incentive Engine — skema inti.
--
-- MODEL: `wrg_incentive_console_v2.jsx` (keputusan pemilik produk 2026-08-09),
-- BUKAN SK/WRG/Sales/001/V/2026 Pasal 4. Spesifikasi: 02-PRDs/PRD-S3-Insentif-Simulator-v2.md
-- v3.0 §A.2. SK masih dokumen yang BERLAKU dan rumusnya berbeda → addendum/revisi SK wajib
-- terbit sebelum pembayaran pertama. Itu urusan dokumen, bukan penghalang skema ini.
--
-- Beda paling mendasar dari semua rancangan sebelumnya: unit hitung = PER TRANSAKSI
-- (satu baris per invoice), bukan agregat bulanan. MR, CF, tipe customer baru, dan tipe
-- lead melekat pada masing-masing invoice; angka bulanan hanyalah penjumlahan.
--
-- Tiga tabel dalam satu berkas mengikuti pola 078_npk_am.sql (satu fitur = satu migrasi).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Konfigurasi per AM: tier UT + batas bulanan.
--
-- SENGAJA menyimpan cap_bulanan (NILAI batas), BUKAN gaji pokok. Model memakai
-- "maks 2× gaji pokok", tapi gaji pokok adalah data HR yang selama ini tidak pernah
-- masuk WRG-OS; menyimpannya memperluas dampak kalau row-level scope bocor. Yang
-- dibutuhkan perhitungan hanyalah angka batasnya.
--
-- tier_ut TIDAK memakai master_user.golongan (migrasi 079). Golongan menyimpan 6 nilai
-- gaya SK (OSP, AM-0..AM-4) untuk NPK; model insentif memakai 8 tier gaya UT
-- (OSP, P0-P3, C1-C3) dan keduanya tidak memetakan 1:1. Dipaksa dipetakan = salah dua-duanya.
CREATE TABLE IF NOT EXISTS insentif_am_config (
  am_id          VARCHAR(50) PRIMARY KEY REFERENCES master_user (am_id) ON DELETE CASCADE,
  tier_ut        VARCHAR(4)  NOT NULL CHECK (tier_ut IN ('OSP','P0','P1','P2','P3','C1','C2','C3')),
  cap_bulanan    NUMERIC(15,0) NOT NULL CHECK (cap_bulanan >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     TEXT
);

COMMENT ON COLUMN insentif_am_config.cap_bulanan IS
  'Batas insentif per bulan (model: 2x gaji pokok). Simpan nilai batasnya saja, jangan gaji pokoknya.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Insentif per transaksi (satu baris per invoice per AM).
--
-- Semua kolom input di-SNAPSHOT saat compute. Jangan dihitung ulang saat baca:
-- harga poin, tier, HPP, dan aging semuanya bisa berubah setelah periode ditutup,
-- dan slip yang sudah disetujui tidak boleh berubah angkanya di belakang layar.
CREATE TABLE IF NOT EXISTS insentif_transaksi (
  id             BIGSERIAL PRIMARY KEY,
  am_id          VARCHAR(50) NOT NULL REFERENCES master_user (am_id),
  periode        CHAR(7)     NOT NULL,   -- 'YYYY-MM', diturunkan dari tanggal invoice
  invoice_no     TEXT        NOT NULL,
  customer_id    TEXT,
  tanggal        DATE        NOT NULL,

  -- Input per transaksi
  revenue        NUMERIC(15,0) NOT NULL CHECK (revenue >= 0),
  is_kso         BOOLEAN NOT NULL DEFAULT FALSE,   -- true -> MR dipaksa 0 (margin sudah tinggi)
  is_ecat_pl     BOOLEAN NOT NULL DEFAULT FALSE,   -- true -> MR dipaksa 0 (harga fixed)
  gp_actual_pct  NUMERIC(6,3),                     -- NULL = HPP SKU belum ada -> MR 0, JANGAN ditebak
  gp_target_pct  NUMERIC(6,3) NOT NULL DEFAULT 30, -- flat 30%, bukan per outlet per semester
  aging_days     INTEGER,
  ncr_type       VARCHAR(12) NOT NULL DEFAULT 'existing'
                 CHECK (ncr_type IN ('existing','newMurni','reaktivasi')),
  lead_type      CHAR(1) NOT NULL DEFAULT 'A' CHECK (lead_type IN ('A','B','C')),
  lead_set_by    TEXT,   -- app_user.id HOD yang menandai B/C; NULL = default A tanpa penandaan

  -- Turunan. BUKAN generated column: semuanya tabel tangga + clamp, jadi hidup di
  -- apps/api/src/lib/insentif-calc.ts supaya ada satu definisi yang bisa di-unit-test.
  pi_points      NUMERIC(14,4) NOT NULL,
  harga_poin     INTEGER       NOT NULL,
  mr_pct         NUMERIC(6,3)  NOT NULL DEFAULT 0,
  ncr_pct        NUMERIC(6,3)  NOT NULL DEFAULT 0,
  cf             NUMERIC(4,2)  NOT NULL DEFAULT 1.00,
  pengali        NUMERIC(8,4)  NOT NULL,
  insentif_raw   NUMERIC(15,0) NOT NULL,
  insentif_am    NUMERIC(15,0) NOT NULL,   -- x bagi hasil lead
  insentif_ho    NUMERIC(15,0) NOT NULL,   -- sisanya -> HO Pool

  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  computed_from  JSONB,                    -- {effort, presales, tier_ut, hpp_source}
  UNIQUE (invoice_no, am_id)
);

CREATE INDEX IF NOT EXISTS idx_ins_trx_am ON insentif_transaksi (am_id, periode DESC);
CREATE INDEX IF NOT EXISTS idx_ins_trx_periode ON insentif_transaksi (periode);
-- Lead non-A itu minoritas & yang perlu di-audit; partial index cukup.
CREATE INDEX IF NOT EXISTS idx_ins_trx_lead ON insentif_transaksi (lead_type) WHERE lead_type <> 'A';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Rekap bulanan per AM + status rantai persetujuan.
CREATE TABLE IF NOT EXISTS insentif_bulanan (
  id                BIGSERIAL PRIMARY KEY,
  am_id             VARCHAR(50) NOT NULL REFERENCES master_user (am_id),
  periode           CHAR(7)     NOT NULL,

  tier_ut           VARCHAR(4)   NOT NULL,
  effort_score      NUMERIC(5,2) NOT NULL CHECK (effort_score BETWEEN 0 AND 100),
  presales_score    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (presales_score BETWEEN 0 AND 100),

  total_insentif_am NUMERIC(15,0) NOT NULL DEFAULT 0,
  total_insentif_ho NUMERIC(15,0) NOT NULL DEFAULT 0,   -- akumulasi HO Pool

  cap_bulanan       NUMERIC(15,0) NOT NULL,
  dibayar           NUMERIC(15,0) NOT NULL DEFAULT 0,   -- min(total_am, cap)
  retention_pool    NUMERIC(15,0) NOT NULL DEFAULT 0,   -- kelebihan; cair akhir tahun bila masih bekerja

  status            VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN
                    ('draft','submitted','hod_review','finance_verify',
                     'corsec_compile','direktur_approve','paid','rejected')),

  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (am_id, periode)
);

CREATE INDEX IF NOT EXISTS idx_ins_bln_status ON insentif_bulanan (status, periode);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Jejak persetujuan 7 langkah.
--
-- INTI PEMISAHAN KEWENANGAN: UNIQUE(bulanan_id, actor_user_id) menegakkan "tiap
-- langkah harus akun berbeda" di level basis data, bukan cuma dicek di aplikasi.
--
-- Konsekuensi yang DISENGAJA: kalau satu orang merangkap dua peran (mis. HOD Sales
-- merangkap Corsec), baris itu MACET dan harus didelegasikan ke orang lain. Itu memang
-- maksud segregation of duties. Kalau di WRG rangkap peran ternyata lumrah dan ini
-- menghambat, jangan hapus constraint-nya diam-diam — bawa ke Direktur dulu (PRD §L Q25).
CREATE TABLE IF NOT EXISTS insentif_approval_log (
  id            BIGSERIAL PRIMARY KEY,
  bulanan_id    BIGINT      NOT NULL REFERENCES insentif_bulanan (id) ON DELETE CASCADE,
  step          SMALLINT    NOT NULL CHECK (step BETWEEN 1 AND 7),
  status_to     VARCHAR(20) NOT NULL,
  actor_user_id TEXT        NOT NULL,   -- app_user.id
  actor_role    TEXT        NOT NULL,
  catatan       TEXT,
  acted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bulanan_id, actor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ins_appr ON insentif_approval_log (bulanan_id, step);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED SENGAJA TIDAK DI SINI. Jalankan `scripts/ops/insentif-seed-tier.mjs`.
--
-- Alasannya penting: sumber tier (AM_META di wrg_incentive_console_v2.jsx) memakai kode
-- tiga huruf — LRI, CHS, ARF, WDA, AUL, GGA, FMA, VIC, YGO, IQB, SID, DOD. Itu kode
-- SALESMAN Accurate, BUKAN master_user.am_id (am_id = user_id legacy, bentuknya angka).
-- Menuliskannya langsung sebagai am_id di migrasi = FK gagal = deploy prod berhenti,
-- karena sejak v1.105.0 migrasi di-apply otomatis saat deploy.
--
-- Skrip ops itu memetakan kode → am_id lewat accurate_salesman.number → master_user_id
-- (jalur yang sama dengan joinAmFromSalesman), menampilkan hasil resolusi dulu, dan baru
-- menulis kalau diberi flag --apply. Kode yang tidak ter-resolve dilaporkan, tidak diam-diam
-- dilewati.
--
-- Sampai skrip itu dijalankan, insentif_am_config kosong → tak ada AM yang punya tier →
-- perhitungan tidak menghasilkan apa-apa. Itu kondisi aman: lebih baik kosong daripada
-- salah orang.
