-- 072 — Klasifikasi produk + kode produk (KK.PP.CC.SSS.NNNN).
--
-- Sumber aturan: Google Sheet "3. PL Product Compilation", sheet `DB_Product`
-- (4 kategori · 57 product line · 86 class · 824 sub class) dan penerapannya di
-- sheet `Business Medical` / `Business IVD` / `Kroscek mapping Saldo Awal`.
--
-- Bentuk kode:
--   KK . PP . CC . SSS . NNNN
--   KK   id_kategori     (2 digit)
--   PP   id_product_line (2 digit, bernomor ulang per kategori)
--   CC   id_class        (2 digit, bernomor ulang per kategori)
--   SSS  id_sub_class    (3 digit, bernomor ulang per CLASS — bukan per kategori)
--   NNNN nomor urut produk dalam satu prefix KK.PP.CC.SSS
--
-- Kenapa nomor id-nya berulang, bukan global: itu memang bentuk master-nya.
-- `product_sub_class` id 001 ada di banyak class (di kategori 01 saja, id 001
-- dipakai 6 class berbeda), jadi sub class HANYA bermakna bersama induknya.
-- Karena itu semua tabel di bawah memakai kunci komposit, dan `product_code`
-- menyimpan keempat id — bukan satu id sub class yang dianggap unik.
--
-- Empat cacat generator di spreadsheet yang TIDAK direplikasi di sini
-- (audit 29 Jul 2026, lampiran `Klasifikasi-Produk-Kroscek-2026-07-29.xlsx`):
--   1. VLOOKUP di sheet mencocokkan NAMA saja dan mengabaikan kolom id_kategori /
--      id_class, jadi nama yang kembar (4 Class + 33 Sub Class) mengambil id dari
--      kategori lain — 244 dari 931 produk kena. Di sini resolusi WAJIB hirarkis
--      lewat kunci komposit + FK, jadi bentuk salah itu tidak bisa tersimpan.
--   2. Nomor urut dihitung per-sheet (COUNTIFS), jadi Business Medical & Business
--      IVD punya counter sendiri dan sempat menerbitkan kode kembar
--      (01.24.01.036.0001 dipakai 2 produk). Di sini nomor urut dijamin
--      UNIQUE (kategori,line,class,sub_class,seq) lintas semua sumber.
--   3. Sheet Kroscek memakai sub class 2 digit (RIGHT("00"&R,2)) sedangkan sheet
--      Business 3 digit → dua format kode hidup bersamaan, dan 491 produk dengan
--      id sub class >= 100 kepotong (112 → "12"). Di sini format tunggal,
--      dipaksa CHECK.
--   4. COUNTIFS Kroscek memakai rentang keliru ($R2:$R$3) → 32 kode kembar.
--
-- Kode lama dari spreadsheet TIDAK dibuang: `kode_legacy` (kode 5-bagian hasil
-- generator sheet) dan `kode_2025` (kode Accurate berjalan, mis. IDS.0276) ikut
-- disimpan supaya rekonsiliasi ke Accurate tetap bisa dilakukan.
--
-- Data produk & taxonomy TIDAK ikut di repo — repo ini PUBLIC. Isi lewat
-- importer: scripts/db/import_product_classification.py.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- ── Level 1: Kategori ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_kategori (
  id    text PRIMARY KEY CHECK (id ~ '^[0-9]{2}$'),
  nama  text NOT NULL,
  aktif boolean NOT NULL DEFAULT true,
  UNIQUE (nama)
);

-- ── Level 2: Product Line (bernomor per kategori) ──────────────────────────
CREATE TABLE IF NOT EXISTS product_line (
  kategori_id text NOT NULL REFERENCES product_kategori (id) ON UPDATE CASCADE,
  id          text NOT NULL CHECK (id ~ '^[0-9]{2}$'),
  nama        text NOT NULL,
  aktif       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (kategori_id, id),
  UNIQUE (kategori_id, nama)
);

-- ── Level 3: Class (bernomor per kategori) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS product_class (
  kategori_id text NOT NULL REFERENCES product_kategori (id) ON UPDATE CASCADE,
  id          text NOT NULL CHECK (id ~ '^[0-9]{2}$'),
  nama        text NOT NULL,
  aktif       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (kategori_id, id),
  UNIQUE (kategori_id, nama)
);

-- ── Level 4: Sub Class (bernomor per CLASS) ────────────────────────────────
CREATE TABLE IF NOT EXISTS product_sub_class (
  kategori_id text NOT NULL,
  class_id    text NOT NULL,
  id          text NOT NULL CHECK (id ~ '^[0-9]{3}$'),
  nama        text NOT NULL,
  aktif       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (kategori_id, class_id, id),
  UNIQUE (kategori_id, class_id, nama),
  FOREIGN KEY (kategori_id, class_id)
    REFERENCES product_class (kategori_id, id) ON UPDATE CASCADE
);

-- ── Kode produk ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_code (
  kode text PRIMARY KEY
    CHECK (kode ~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{3}\.[0-9]{4}$'),

  kategori_id  text NOT NULL,
  line_id      text NOT NULL,
  class_id     text NOT NULL,
  sub_class_id text NOT NULL,
  seq          int  NOT NULL CHECK (seq BETWEEN 1 AND 9999),

  -- Kunci idempoten importer & pencegah kode ganda untuk produk yang sama.
  -- Isinya 'K:<kode 2025>' bila produk punya kode Accurate berjalan, kalau tidak
  -- 'N:<NAMA ACCURATE 2026>'. Bentuk kedua sengaja diakui rawan: 22 nama di
  -- price book dipakai beberapa produk berbeda, jadi importer melaporkan berapa
  -- baris yang digabung atas dasar nama supaya bisa diperiksa manusia.
  identitas text NOT NULL UNIQUE,

  nama            text NOT NULL,      -- Nama Accurate 2026
  nama_principal  text,
  kemasan         text,
  satuan          text,
  brand           text,
  penyedia        text,

  kode_2025   text,                   -- kode Accurate berjalan (IDS.0276, AKS.0828, …)
  kode_legacy text,                   -- kode 5-bagian hasil generator spreadsheet
  sumber      text NOT NULL DEFAULT 'manual',  -- nama sheet asal / 'manual'

  -- Pasangan ke mirror Accurate. Sengaja hanya lewat kode (bukan fuzzy nama):
  -- nama produk tidak unik, mencocokkan nama menghasilkan pasangan palsu.
  accurate_item_id bigint REFERENCES accurate_item (id) ON DELETE SET NULL,

  catatan    text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (kategori_id, line_id, class_id, sub_class_id, seq),
  FOREIGN KEY (kategori_id, line_id)
    REFERENCES product_line (kategori_id, id) ON UPDATE CASCADE,
  FOREIGN KEY (kategori_id, class_id, sub_class_id)
    REFERENCES product_sub_class (kategori_id, class_id, id) ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS product_code_nama_idx     ON product_code (lower(nama));
CREATE INDEX IF NOT EXISTS product_code_prefix_idx   ON product_code (kategori_id, line_id, class_id, sub_class_id);
CREATE INDEX IF NOT EXISTS product_code_kode2025_idx ON product_code (kode_2025) WHERE kode_2025 IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_code_legacy_idx   ON product_code (kode_legacy) WHERE kode_legacy IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_code_item_idx     ON product_code (accurate_item_id) WHERE accurate_item_id IS NOT NULL;

-- ── Antrean keputusan HoD Business ─────────────────────────────────────────
-- Baris sumber yang klasifikasinya tidak bisa di-resolve hirarkis: namanya ada
-- di master, tapi kombinasi (kategori → class → sub class)-nya belum terdaftar.
-- 435 baris pada audit 29 Jul 2026 (35 Business + 400 Kroscek), terbanyak
-- Non IVD/Machine: Timbangan, Tensimeter, Thermometer, Cabinet, Mouthpiece.
-- Produk ini TIDAK boleh diberi kode tebakan — kodenya menempel permanen di
-- Accurate. Jadi ditahan di sini sampai master-nya dilengkapi.
CREATE TABLE IF NOT EXISTS product_code_review (
  id     bigserial PRIMARY KEY,
  sumber text NOT NULL,
  sumber_baris int,

  nama           text NOT NULL,
  nama_principal text,
  brand          text,
  penyedia       text,
  kemasan        text,
  satuan         text,
  kode_2025      text,
  kode_legacy    text,

  -- Teks klasifikasi APA ADANYA dari sumber (belum tentu cocok master).
  kategori_nama  text,
  line_nama      text,
  class_nama     text,
  sub_class_nama text,

  masalah text NOT NULL,
  status  text NOT NULL DEFAULT 'terbuka'
    CHECK (status IN ('terbuka', 'beres', 'diabaikan')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sumber, sumber_baris)
);

CREATE INDEX IF NOT EXISTS product_code_review_status_idx ON product_code_review (status);

COMMENT ON TABLE product_kategori  IS 'Klasifikasi produk level 1 — KK pada kode KK.PP.CC.SSS.NNNN.';
COMMENT ON TABLE product_line      IS 'Klasifikasi produk level 2 — PP; bernomor ulang per kategori.';
COMMENT ON TABLE product_class     IS 'Klasifikasi produk level 3 — CC; bernomor ulang per kategori.';
COMMENT ON TABLE product_sub_class IS 'Klasifikasi produk level 4 — SSS; bernomor ulang per CLASS, jadi tidak bermakna tanpa induknya.';
COMMENT ON TABLE product_code      IS 'Kode produk KK.PP.CC.SSS.NNNN + kode lama (kode_2025 / kode_legacy) untuk rekonsiliasi Accurate.';
COMMENT ON TABLE product_code_review IS 'Baris sumber yang belum bisa dapat kode karena kombinasi klasifikasinya belum terdaftar di master — menunggu keputusan HoD Business.';
