-- 086 — F132 GA Aset Master (General Affairs). Katalog inventaris kantor
-- (laptop, HP, kendaraan, mebel, license software) — root fondasi utk F133
-- (assignment/transfer) dan F137 (maintenance), keduanya FK ke ga_assets.
--
-- Skema diadaptasi LANGSUNG dari repo gais (github.com/ditoanggara919-lang/gais,
-- backend/migrations/003_asset.sql — prototipe Dito Anggara/GA), diterjemahkan
-- ke konvensi wrg-os (uuid, app_user, snake_case existing). Lihat
-- docs/features/F132-ga-aset-master.md utk daftar penuh apa yang dipertahankan
-- vs diubah dari source.
--
-- F52 (IT Asset & Issue Tracker) DISERAP ke sini (arahan Direktur) — tabel
-- `it_asset` yang sempat dirancang di branch F52 TIDAK PERNAH dibuat; begitu
-- F52 di-rebase ke atas branch ini, `it_ticket.asset_id` FK langsung ke
-- ga_assets(id), `is_critical` pindah jadi kolom di sini (lihat bawah).
--
-- Kolom `status` (lifecycle: active/in_maintenance/damaged/lost/disposed)
-- TIDAK disebut di brief F132, tapi ADA di source & jelas dibutuhkan (mis.
-- exclude yang disposed dari listing default) — dipertahankan dari source,
-- terpisah dari `condition` (kondisi fisik: baik/rusak/kurang_layak_pakai).
--
-- Pola hybrid PIC (current_pic_user_id FK + pic_name_override free-text)
-- diadopsi PERSIS dari source — solusi utk staf yg belum punya akun app_user:
-- assign boleh pakai salah satu, kalau pic_name_override diisi itu yang
-- ditampilkan menggantikan nama dari current_pic_user_id. Assignment history
-- (F133, ga_asset_assignments) HANYA tercatat kalau PIC-nya user terdaftar.

CREATE TABLE IF NOT EXISTS ga_asset_categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,   -- mis. 'AST-ELK', dari source
  nama               text NOT NULL,
  depreciation_years int,
  icon               text,                    -- emoji, kosmetik (opsional)
  -- Exception "1 aset = 1 PIC aktif" (F133) — semua aset di kategori ini
  -- boleh punya >1 assignment aktif sekaligus (mis. ATK/perkakas bersama).
  -- TIDAK ada di source, tambahan wrg-os per arahan Direktur.
  is_shared          boolean NOT NULL DEFAULT false,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ga_assets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto-gen 'AST-<tahun input>-NNNN' (lihat generateAssetCode() di
  -- repo/ga-asset.ts) — basis TAHUN dari tanggal input (NOW()), BUKAN
  -- purchase_date (formula eksak diambil dari source routes/assets.js).
  asset_code         text NOT NULL UNIQUE,
  nama               text NOT NULL,
  category_id        uuid NOT NULL REFERENCES ga_asset_categories(id) ON DELETE RESTRICT,

  brand              text,
  model              text,
  serial_number      text,

  purchase_date      date,
  purchase_price     numeric(15,2) NOT NULL DEFAULT 0,
  current_value      numeric(15,2) NOT NULL DEFAULT 0,
  warranty_expiry    date,

  location           text,

  -- Hybrid PIC, lihat komentar header.
  current_pic_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  pic_name_override   text,

  department         text,   -- TEXT bebas; wrg-os tak punya tabel department generik lintas-domain

  condition          text NOT NULL DEFAULT 'baik'
                      CHECK (condition IN ('baik','rusak','kurang_layak_pakai')),
  status             text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','in_maintenance','damaged','lost','disposed')),

  foto_path          text,
  dokumen_path       text,   -- TIDAK ada di source, tambahan wrg-os
  notes              text,

  -- Diserap dari rencana F52 — flag permanen per-aset (SLA tiket 2 jam kalau
  -- kritis), generik utk semua kategori (paling relevan aset IT, tak dibatasi
  -- teknis ke situ).
  is_critical        boolean NOT NULL DEFAULT false,

  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_assets_category_idx ON ga_assets (category_id);
CREATE INDEX IF NOT EXISTS ga_assets_status_idx   ON ga_assets (status);
CREATE INDEX IF NOT EXISTS ga_assets_pic_idx      ON ga_assets (current_pic_user_id);
CREATE INDEX IF NOT EXISTS ga_assets_active_idx   ON ga_assets (active);

COMMENT ON TABLE ga_asset_categories IS
  'F132 — kategori aset GA (laptop/HP/kendaraan/mebel/software). is_shared = exception aturan 1-PIC-aktif di F133.';
COMMENT ON TABLE ga_assets IS
  'F132 — master aset kantor GA, single source of truth (menyerap rencana it_asset F52). asset_code auto-gen AST-YYYY-NNNN, basis tahun input.';
