-- 074 — Master data Simulator KSO (running cost alat lab).
--
-- Sumber: aplikasi terpisah `github.com/info-WL707/runningcost-zybio` (Next.js
-- pages-router, seluruh master-nya hardcode di `lib/data.js`). Aplikasi itu
-- digabung jadi satu menu di WRG-OS (/kso-simulator); tabel di sini menggantikan
-- file JS tersebut sebagai sumber data.
--
-- YANG MASUK KE SINI vs YANG TETAP DI KODE — batasnya sengaja tajam:
--
--   DB (tabel ini)  = data KOMERSIAL & katalog: daftar analyzer, harga alat,
--     default kontrak (bulan KSO, markup, target test), daftar reagen/consumable
--     beserta kemasan & harga, dan daftar parameter (Kimia Klinik, Snibe, Wondfo).
--     Semuanya bisa berubah tiap negosiasi/periode harga → tidak layak di kode.
--
--   Kode (apps/web/src/lib/kso/formula.ts) = KOEFISIEN TEKNIS dari spec sheet
--     pabrikan: mL per test, volume startup/shutdown, siklus cuci, faktor waste.
--     Itu perilaku mesin, bukan data yang di-maintain orang non-teknis, dan tiap
--     analyzer rumusnya beda bentuk (bukan sekadar angka) — memaksanya masuk DB
--     berarti menyimpan rumus sebagai data, dan itu tidak akan pernah tervalidasi.
--
-- Data TIDAK ikut di repo — repo ini PUBLIC, harga alat & reagen bukan data
-- publik. Isi lewat importer: scripts/db/import_kso_master.py.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- ── Analyzer ────────────────────────────────────────────────────────────────
-- Satu baris = satu alat yang bisa disimulasikan. `kategori` = tab di layar.

CREATE TABLE IF NOT EXISTS kso_analyzer (
  id       serial PRIMARY KEY,
  kategori text NOT NULL,
  -- Kunci teknis yang MENGIKAT ke rumus di formula.ts (mis. 'Z3', 'EXZ8000',
  -- 'EXC200', 'LIBO'). Ganti kode = rumusnya tak ketemu → jangan di-rename lewat
  -- importer, tambah baris baru.
  kode     text NOT NULL,
  label    text NOT NULL,
  brand    text,

  -- Nilai AWAL form. User boleh menimpanya di layar (simulasi = coret-coretan
  -- penawaran); yang disimpan di sini cuma titik berangkatnya.
  default_capex     numeric(16,2) NOT NULL DEFAULT 0,  -- harga alat
  default_capex_pl  numeric(16,2),                      -- harga price-list alat (acuan diskon)
  default_disc      numeric(6,3)  NOT NULL DEFAULT 0,   -- diskon alat, %
  default_kso_bulan int           NOT NULL DEFAULT 0,   -- durasi kontrak KSO, bulan
  default_markup    numeric(6,3)  NOT NULL DEFAULT 0,   -- markup harga jual per test, %
  default_tests     int           NOT NULL DEFAULT 0,   -- target test/bulan

  -- Preset tombol "test/bulan" di layar, mis. [250,500,750,1000,1500,2000].
  presets jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Sisa atribut yang bentuknya beda-beda per kategori, sengaja tidak dijadikan
  -- kolom (5 dari 7 kategori tidak memakainya):
  --   diff                  hematologi — 3-Diff / 5-Diff / 6-Diff
  --   ctrlPl / calPl        harga price-list control & calibrator
  --   xnCtrlPl / xrCtrlPl   EXZ8000 — control XN vs XR
  --   testModes             EXZ8000 — CBC+DIFF+RET / +XN Ctrl+Cal / +XR Ctrl+Cal
  --   methods               crossmatch — Mayor / Mayor+Minor / +AC (kolom & mL LISS)
  --   modes                 elektrolit — cartridge vs bottle (volume Cal A & harga)
  --   stability / dMaint    blood gas — masa pakai cartridge (hari) & biaya maintenance
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  aktif      boolean NOT NULL DEFAULT true,
  urutan     int     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kso_analyzer_kategori_ck CHECK (
    kategori IN ('HEMATO', 'CC', 'XM', 'CLIA', 'HPLC', 'ELEKTRO', 'BG')),
  CONSTRAINT kso_analyzer_kode_uq UNIQUE (kategori, kode)
);

-- ── Reagen / consumable ─────────────────────────────────────────────────────
-- Barang habis pakai yang harganya ikut dihitung per test.

CREATE TABLE IF NOT EXISTS kso_reagent (
  id          serial PRIMARY KEY,
  analyzer_id int  NOT NULL REFERENCES kso_analyzer (id) ON DELETE CASCADE,
  -- Sama seperti kso_analyzer.kode: MENGIKAT ke rumus ('lyse', 'dil', 'dn',
  -- 'ld', 'probe', …). formula.ts memanggil harga per-mL lewat kode ini.
  kode        text NOT NULL,
  -- reagent | consumable | cartridge | qc — memisahkan mana yang masuk rumus
  -- siklus (reagent/consumable) vs yang dihitung terpisah (cartridge/qc).
  jenis       text NOT NULL,
  nama        text NOT NULL,
  pack        text,                 -- label kemasan apa adanya, mis. '20.000 mL/jeriken'
  -- Dua satuan hasil yang berbeda, dan cuma salah satu yang terisi:
  --   vol        = isi kemasan dalam mL (reagen cair; harga → per mL)
  --   yield_test = hasil kemasan dalam test (kit/cartridge; harga → per test)
  -- Keduanya boleh kosong HANYA untuk jenis 'qc': larutan QC dibeli per botol
  -- dan biayanya masuk sebagai overhead sejumlah run QC yang diinput user,
  -- bukan dibagi rata per test (mis. QC elektrolit DN-X6).
  vol         numeric(14,3),
  yield_test  int,
  harga_dp    numeric(16,2),        -- harga distributor
  harga_pl    numeric(16,2),        -- harga price-list (NULL = tidak ada acuan PL)
  -- Atribut opsional; sejauh ini cuma { inf: bool } untuk Wondfo (parameter
  -- infeksius memakai intensive wash buffer, bukan wash biasa).
  flags       jsonb NOT NULL DEFAULT '{}'::jsonb,
  urutan      int  NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kso_reagent_jenis_ck CHECK (jenis IN ('reagent', 'consumable', 'cartridge', 'qc')),
  CONSTRAINT kso_reagent_satuan_ck CHECK (
    jenis = 'qc' OR vol IS NOT NULL OR yield_test IS NOT NULL),
  CONSTRAINT kso_reagent_kode_uq UNIQUE (analyzer_id, jenis, kode)
);

CREATE INDEX IF NOT EXISTS kso_reagent_analyzer_idx ON kso_reagent (analyzer_id, urutan);

-- ── Parameter pemeriksaan ───────────────────────────────────────────────────
-- Daftar parameter yang bisa dipilih user (Kimia Klinik 20, Snibe 310,
-- Wondfo 56). Beda dari reagen: parameter dipilih per-menu pemeriksaan dan
-- harganya per KIT, bukan per mL.

CREATE TABLE IF NOT EXISTS kso_parameter (
  id            serial PRIMARY KEY,
  -- CC = Kimia Klinik (EXC200/EXC400), SNIBE / WONDFO = dua platform CLIA.
  -- Bukan analyzer_id: satu daftar parameter dipakai bersama oleh semua
  -- analyzer di platform yang sama.
  grup          text NOT NULL,
  no            int  NOT NULL,       -- nomor urut di daftar sumber (kunci import)
  nama          text NOT NULL,
  panel         text,                -- pengelompokan di layar, mis. 'Hepatic', 'Thyroid'
  pack          text,
  -- Hasil satu kemasan dalam test. Nama parameter TIDAK unik: satu parameter
  -- sering punya dua baris (kit 50T dan 100T) dengan harga berbeda.
  tests_per_kit int,
  harga_dp      numeric(16,2),
  harga_pl      numeric(16,2),
  flags         jsonb NOT NULL DEFAULT '{}'::jsonb,
  aktif         boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kso_parameter_grup_ck CHECK (grup IN ('CC', 'SNIBE', 'WONDFO')),
  CONSTRAINT kso_parameter_no_uq UNIQUE (grup, no)
);

CREATE INDEX IF NOT EXISTS kso_parameter_grup_idx ON kso_parameter (grup, panel, nama);

-- ── Panel ───────────────────────────────────────────────────────────────────
-- Urutan tampil pengelompokan parameter. Dipisah dari kso_parameter karena
-- urutannya keputusan tampilan, bukan turunan data (panel dengan 1 parameter
-- tetap harus tampil di posisi yang benar).

CREATE TABLE IF NOT EXISTS kso_panel (
  grup   text NOT NULL,
  nama   text NOT NULL,
  urutan int  NOT NULL DEFAULT 0,

  PRIMARY KEY (grup, nama),
  CONSTRAINT kso_panel_grup_ck CHECK (grup IN ('CC', 'SNIBE', 'WONDFO'))
);

COMMENT ON TABLE kso_analyzer IS
  'Master alat Simulator KSO (/kso-simulator). Kolom kode MENGIKAT ke rumus di apps/web/src/lib/kso/formula.ts — jangan di-rename.';
COMMENT ON TABLE kso_reagent IS
  'Reagen/consumable/cartridge/QC per analyzer KSO. Harga: dp = distributor, pl = price list.';
COMMENT ON TABLE kso_parameter IS
  'Parameter pemeriksaan Kimia Klinik & CLIA. Nama tidak unik — satu parameter bisa punya baris 50T dan 100T.';
COMMENT ON COLUMN kso_reagent.flags IS
  'Atribut opsional. { inf: true } = parameter infeksius Wondfo (pakai intensive wash buffer).';
