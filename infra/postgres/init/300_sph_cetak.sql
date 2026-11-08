-- 300 — F15 SPH: dokumen cetak resmi (nomor surat, syarat per SPH, penanda
-- tangan) + pengaturan penomoran. Lanjutan 152_sph_generator.sql.
--
-- Nomor surat: <urut 5 digit>/<kode tengah>/<bulan Romawi>/<tahun>, mis.
-- 00042/WRG.PN-PNA/VII/2026. Diberikan SEKALI, saat SPH difinalisasi
-- (tahap 2 approve) — draft belum bernomor. Bulan/tahun = tanggal approve WIB.
-- Pemberian nomor mengunci baris sph_pengaturan (SELECT … FOR UPDATE) di
-- transaksi yang sama dengan UPDATE status, jadi dua approve serentak tak
-- bisa mendapat nomor sama; indeks unik di bawah jaring pengaman kedua
-- (mis. admin menurunkan "nomor berikutnya" ke angka yang sudah terpakai).
--
-- Kebijakan reset: BELUM diputuskan → default urut terus (reset_tahunan =
-- false). Bila nanti diputuskan reset tiap Januari, cukup nyalakan
-- reset_tahunan dari halaman Pengaturan SPH: nomor pertama di tahun baru = 1
-- (tahun_berjalan mencatat tahun nomor terakhir diberikan).
--
-- nomor_berikutnya default 1; admin mengisinya dari UI agar melanjutkan
-- urutan manual yang sedang dipakai (angka nyata tidak ditulis di repo).
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS nomor_dokumen text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS syarat jsonb;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS penanda_tangan_nama text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS penanda_tangan_jabatan text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS penanda_tangan_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sales_doc_nomor_dokumen_uq
  ON sales_doc (nomor_dokumen) WHERE nomor_dokumen IS NOT NULL;

COMMENT ON COLUMN sales_doc.nomor_dokumen IS
  'F15 — nomor surat resmi SPH, diberikan saat finalisasi (tahap 2). NULL = draft / dokumen lama sebelum penomoran otomatis.';
COMMENT ON COLUMN sales_doc.syarat IS
  'F15 — syarat & ketentuan SPH {pembayaran, pengiriman, masaBerlaku, harga}. Bisa diubah selama draft/hod_review, terkunci setelah approved.';
COMMENT ON COLUMN sales_doc.penanda_tangan_nama IS
  'F15 — nama penanda tangan SPH (dipilih approver tahap 2 dari daftar pengguna aktif ber-akses Sales Docs).';

-- Satuan/kemasan saat quote dibuat (snapshot, sama prinsip harga di 152).
ALTER TABLE sph_line_item ADD COLUMN IF NOT EXISTS kemasan_snapshot text;

CREATE TABLE IF NOT EXISTS sph_pengaturan (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  kode_tengah      text    NOT NULL DEFAULT 'WRG.PN-PNA',
  nomor_berikutnya integer NOT NULL DEFAULT 1 CHECK (nomor_berikutnya BETWEEN 1 AND 9999999),
  reset_tahunan    boolean NOT NULL DEFAULT false,
  tahun_berjalan   integer,
  syarat_default   jsonb   NOT NULL DEFAULT jsonb_build_object(
    'pembayaran',  '30 hari setelah faktur diterima',
    'pengiriman',  'Franco gudang customer',
    'masaBerlaku', '14 hari sejak tanggal penawaran',
    'harga',       'Harga satuan belum termasuk PPN; PPN 11% dicantumkan terpisah pada total'
  ),
  updated_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sph_pengaturan (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE sph_pengaturan IS
  'F15 — satu baris: penomoran SPH (kode tengah, nomor berikutnya, reset tahunan) + syarat default. Diubah admin/superuser lewat /sph/pengaturan.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sph_pengaturan TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON sph_pengaturan TO wrg_readonly;
  END IF;
END $$;
