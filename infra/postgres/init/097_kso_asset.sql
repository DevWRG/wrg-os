-- 097 — Master aset KSO + realisasi tes bulanan (+ per-parameter kimia klinik).
--
-- SUMBER: spreadsheet "Hasil Perhitungan KSO Per Tes" (Drive, owner support@), sheet
-- `Populasi KSO` (master alat), `2026 KSO Tes` / `2026 KSO Reagent` (realisasi 2026),
-- `2025 KSO Tes` / `2025 KSO Reagent` (baseline 2025), `rekap perparameterkimia 2026`.
--
-- KENAPA TABEL BARU, BUKAN NUMPANG accurate_*: alat KSO adalah ASET MILIK WRG yang
-- dititipkan di faskes, bukan entitas Accurate. Accurate cuma tahu invoice reagennya.
-- Produktivitas aset = (jumlah tes yang jalan di alat) dibandingkan (target kontrak)
-- dan (revenue reagen yang tertagih) — tiga sumber berbeda yang baru ketemu di sini.
--
-- KUNCI IDENTITAS = `sn_key`, yaitu SN yang dinormalisasi. Di spreadsheet SN ditulis
-- tiga gaya untuk unit yang sama: `00829` (teks), `829`, dan `5360.0` (angka float yang
-- ter-render dengan ekor desimal). Tanpa normalisasi, satu alat fisik terpecah jadi tiga
-- baris. Normalisasi: trim → uppercase → buang ekor `.0` → buang leading zero.
-- Unit tanpa SN dapat kunci sintetis `NOSN:<slug customer>|<slug nama alat>` supaya tetap
-- bisa di-upsert idempoten, dan gampang dicari saat SN aslinya ketemu nanti.
--
-- REKONSILIASI YANG SUDAH DIKETAHUI (hasil audit 2026-08-17, dipakai importer):
--   • `Populasi KSO` 471 SN unik, TAPI 75 alat yang aktif di sheet 2026 tidak ada di sana
--     (26 dari KSO Tes, 49 dari KSO Reagent) — Populasi belum di-update. Keputusan user:
--     tetap di-import, ditandai `in_populasi=false` supaya admin bisa menyisirnya.
--   • 90 alat ada di Populasi tapi absen dari sheet 2026 (didominasi Hemodialisa, 27 unit)
--     → `in_populasi=true` tanpa baris di kso_asset_test_monthly. Itu WAJAR untuk alat
--     yang memang tidak dihitung per-tes; jangan diperlakukan sebagai data hilang.
--   • 5 SN muncul di sheet Tes DAN Reagent sekaligus, 8 SN skemanya bentrok dengan STATUS
--     di Populasi → importer memenangkan sheet 2026 (lebih baru) dan menulis alasannya ke
--     `catatan_sync`. Kolom itu ada supaya konflik tidak hilang diam-diam.
--
-- KOLOM BULANAN DI `Populasi KSO` SENGAJA TIDAK DI-IMPORT. Tahunnya ambigu: untuk SN 4001
-- angka bulanannya beda dengan `2026 KSO Tes` padahal `Rata Rata 2026`-nya sama, dan 147
-- dari 381 SN yang cocok punya `Rata Rata 2026` kosong di Populasi tapi terisi di sheet
-- 2026. Populasi basi untuk angka; ia hanya dipercaya untuk METADATA kontrak (MOU, target,
-- paket, ritme). Angka bulanan hanya diambil dari sheet yang tahunnya eksplisit.

CREATE TABLE IF NOT EXISTS kso_asset (
  id                 bigserial PRIMARY KEY,
  sn_key             text        NOT NULL UNIQUE,
  sn_raw             text,
  customer_raw       text        NOT NULL,
  -- Diisi belakangan lewat pencocokan ke Accurate; sengaja NULL saat import pertama.
  -- Nama di sheet berformat "<nama>, <tipe> <KOTA>" (nama + kota digabung) dan tidak
  -- identik dengan accurate_customer.name, jadi pencocokan string runtime tidak dipercaya.
  account_id         bigint      REFERENCES accurate_customer(id) ON DELETE SET NULL,
  kota               text,
  station            text,
  admin              text,
  type_alat          text,
  nama_alat          text,
  -- Skema komersial. PER_TEST = WRG menagih per tes yang jalan (aset investasi kita,
  -- produktivitasnya langsung jadi pendapatan). BELI_REAGEN = faskes beli reagen, alat
  -- dititipkan. UNKNOWN = STATUS kosong di Populasi dan tidak muncul di sheet 2026.
  skema              text        NOT NULL DEFAULT 'UNKNOWN'
                       CHECK (skema IN ('PER_TEST','BELI_REAGEN','UNKNOWN')),
  -- Siapa yang membiayai alatnya. TIDAK ADA sumbernya di spreadsheet — satu-satunya
  -- jejak adalah Paket='ASET PENYEDIA' (cuma 3 baris). Sengaja NULL saat import pertama
  -- dan diisi manual; jangan ditebak dari `skema` (BELI_REAGEN tidak otomatis berarti
  -- alatnya bukan milik WRG).
  pemilik_alat       text        CHECK (pemilik_alat IN ('WRG','PRINCIPAL','CUSTOMER')),
  nomor_mou          text,
  mou_berlaku_sampai date,
  target_jumlah_tes  integer,
  ritme_kunjungan    text,
  paket              text,
  status_sheet       text,       -- STATUS mentah dari Populasi KSO (audit trail)
  keterangan         text,
  tgl_sj             text,       -- campur "01 JULI 2021" dan tanggal betulan → simpan mentah
  alamat             text,
  outlet             text,
  in_populasi        boolean     NOT NULL DEFAULT false,
  sumber_sheet       text[]      NOT NULL DEFAULT '{}',
  catatan_sync       text,
  aktif              boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN kso_asset.sn_key IS
  'SN dinormalisasi (upper, tanpa ekor .0, tanpa leading zero). Kunci upsert. NOSN:<...> = unit tanpa SN di sheet.';
COMMENT ON COLUMN kso_asset.pemilik_alat IS
  'NULL = BELUM DIISI, bukan "tidak diketahui selamanya". Tidak ada di spreadsheet; diisi manual.';
COMMENT ON COLUMN kso_asset.in_populasi IS
  'false = alat aktif di sheet 2026 tapi belum tercatat di sheet Populasi KSO. Antrean sisir admin.';
COMMENT ON COLUMN kso_asset.catatan_sync IS
  'Konflik yang importer temukan (skema bentrok, SN dobel sheet, dst). Kosong = bersih.';

CREATE INDEX IF NOT EXISTS kso_asset_account_idx  ON kso_asset (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kso_asset_skema_idx    ON kso_asset (skema);
CREATE INDEX IF NOT EXISTS kso_asset_populasi_idx ON kso_asset (in_populasi) WHERE in_populasi = false;

-- Realisasi jumlah tes per alat per bulan.
-- `periode` selalu tanggal 1 (bulan sebagai titik, bukan rentang) — konsisten dengan
-- pola periode di tabel NPK/watchpoint.
CREATE TABLE IF NOT EXISTS kso_asset_test_monthly (
  asset_id     bigint      NOT NULL REFERENCES kso_asset(id) ON DELETE CASCADE,
  periode      date        NOT NULL,
  jumlah_tes   numeric,
  sumber_sheet text        NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, periode)
);

COMMENT ON COLUMN kso_asset_test_monthly.jumlah_tes IS
  'NULL = bulan itu tidak dilaporkan (sel kosong). 0 = dilaporkan nol. Bedanya penting untuk rata-rata.';

CREATE INDEX IF NOT EXISTS kso_asset_test_periode_idx ON kso_asset_test_monthly (periode);

-- Rincian per parameter untuk alat kimia klinik.
-- Kolom tes_tertagih vs tes_di_alat DIPISAH dengan sengaja: di sheet `Detail Kimia`
-- bulan Januari saja ada 128 baris yang dua angka ini berbeda. Yang ditagih ke faskes
-- adalah tes_tertagih; counter alat (tes_di_alat) ikut menghitung kontrol/standar/blank
-- yang memakan reagen tapi tidak menghasilkan rupiah. Menghitung produktivitas dari satu
-- angka gabungan akan melebih-lebihkan hasilnya.
CREATE TABLE IF NOT EXISTS kso_asset_param_monthly (
  asset_id      bigint      NOT NULL REFERENCES kso_asset(id) ON DELETE CASCADE,
  periode       date        NOT NULL,
  parameter     text        NOT NULL,
  jumlah_tes    numeric,
  tes_tertagih  numeric,
  tes_di_alat   numeric,
  kontrol       numeric,
  standart      numeric,
  blank         numeric,
  stats         numeric,
  other         numeric,
  total_reagent numeric,
  sumber_sheet  text        NOT NULL,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, periode, parameter)
);

CREATE INDEX IF NOT EXISTS kso_asset_param_periode_idx ON kso_asset_param_monthly (periode);
