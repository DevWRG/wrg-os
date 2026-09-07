-- 169 — F-CASHIN Mitigasi Uang Masuk Harian. Ingest rekening koran harian
-- (WA #KORAN + lampiran, atau upload di menu web), pisahkan dana puteran WRG
-- (transfer antar rekening milik sendiri) dari uang masuk riil, lalu resume
-- harian dikirim DM ke Direktur.
--
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.
--
-- PRD: Drive 02-PRDs "PRD F-CASHIN — Mitigasi Uang Masuk Harian".
--
-- Keputusan desain yang penting dan mudah dilanggar kalau tak ditulis:
--
--  1. nominal disimpan numeric, BUKAN teks apa adanya seperti doc_klaim.nominal.
--     Beda kasus: klaim = foto nota bebas format, di sini = statement bank yang
--     formatnya terstandar per bank DAN nominalnya harus dijumlahkan +
--     dicocokkan antar rekening. Parser/OCR yang gagal menormalkan angka harus
--     menggagalkan checksum, bukan menyelundupkan teks ke kolom angka.
--
--  2. Rekening Bank Index itu fasilitas PRK (pinjaman, plafon Rp 13 M, saldo
--     negatif ~ -12,98 M). Kredit masuk ke sana = pelunasan/penarikan plafon,
--     BUKAN uang masuk. Karena itu ada bank_account.jenis; semua baris di
--     rekening jenis 'prk_pinjaman' dikecualikan dari total uang masuk.
--
--  3. Deteksi puteran TIDAK boleh bergantung pada nama sendiri di deskripsi.
--     Bukti: BJTM 31 Agu 2026 punya KREDIT 9.758.840 berdeskripsi
--     '0321018688WAHANARIZKYGUMILANGP' (nomor DAN nama rekening sendiri) tanpa
--     debit pasangan mana pun hari itu — itu uang masuk riil. Karena itu
--     puteran ditandai lewat pasangan_line_id (debit<->kredit nominal identik,
--     hari sama, dua rekening milik_wrg), nama cuma sinyal penguat.
--
--  4. tanggal statement diambil dari ISI dokumen, bukan nama file. Di folder
--     sumber ada 'BNI 310823.pdf' (seharusnya 310826) dan 'BJTM 030926 pdf'
--     (ekstensi rusak) — nama file tidak bisa dipercaya.
--
--  5. UNIQUE (bank_account_id, tanggal): satu rekening satu hari satu baris.
--     Upload ulang = ganti (parser bisa diperbaiki lalu di-reingest), bukan
--     menambah baris kedua yang membuat total dobel.

-- ─────────────────────────────────────────────────────────────────────────────
-- Master rekening
-- ─────────────────────────────────────────────────────────────────────────────
-- label_file = kode yang dipakai admin di nama file ('MDR 038', 'INDEX 881').
-- Itu satu-satunya identitas yang PASTI ada untuk semua rekening: 5 dari 10
-- rekening belum ketahuan nomornya karena statement-nya PDF vector (harus
-- di-OCR dulu). Jadi label_file yang UNIQUE, bukan no_rekening.
CREATE TABLE IF NOT EXISTS bank_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_file    text NOT NULL UNIQUE,
  bank_kode     text NOT NULL,                    -- BJTM|MDR|NIAGA|INDEX|HANA|BNI
  nama_bank     text NOT NULL,
  no_rekening   text,                             -- NULL = belum terbaca (butuh OCR / diisi admin)
  nama_pemilik  text,
  cabang        text,
  swift_kode    text,                             -- PDJTIDJ1|BMRIIDJA|BIDXIDJA|HNBNIDJA|... dipakai deteksi puteran
  jenis         text NOT NULL DEFAULT 'kas' CHECK (jenis IN ('kas', 'prk_pinjaman', 'deposito', 'escrow')),
  milik_wrg     boolean NOT NULL DEFAULT true,    -- false hanya kalau nanti ada rekening titipan/pihak lain
  wajib_harian  boolean NOT NULL DEFAULT true,    -- ikut dihitung di alarm kelengkapan
  aktif         boolean NOT NULL DEFAULT true,
  catatan       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_account_aktif_idx ON bank_account (aktif, wajib_harian);
COMMENT ON TABLE bank_account IS 'F-CASHIN — master rekening bank WRG. label_file = kode di nama file rekening koran (identitas yang selalu ada; no_rekening bisa NULL untuk statement yang belum di-OCR).';
COMMENT ON COLUMN bank_account.jenis IS 'kas = rekening operasional; prk_pinjaman = fasilitas kredit (mutasinya DIKECUALIKAN dari total uang masuk); escrow = giro escrow; deposito = penempatan. Jenis diambil dari label yang DICETAK bank di statement, bukan ditebak dari saldo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Statement (satu file = satu rekening = satu hari)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_statement (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id        uuid NOT NULL REFERENCES bank_account(id) ON DELETE RESTRICT,
  tanggal                date NOT NULL,                  -- dari ISI dokumen (Period/Periode), bukan nama file

  saldo_awal             numeric(18,2),
  saldo_akhir            numeric(18,2),
  total_debit_tercetak   numeric(18,2),                  -- angka total yang DICETAK bank, untuk checksum
  total_kredit_tercetak  numeric(18,2),
  jumlah_debit           integer,                        -- No. of Debit tercetak (NULL kalau bank tak mencetaknya)
  jumlah_kredit          integer,
  dicetak_at             timestamptz,                    -- jam cetak dari header PDF; dipakai mendeteksi statement mid-day

  sumber                 text NOT NULL CHECK (sumber IN ('wa', 'web')),
  wa_message_id          uuid REFERENCES wa_message(id) ON DELETE SET NULL,
  file_path              text,
  file_nama              text,                           -- nama file asli (jejak; JANGAN dipakai sebagai sumber tanggal)
  metode                 text NOT NULL CHECK (metode IN ('parser', 'ocr', 'manual')),
  model_used             text,                           -- hanya untuk metode='ocr'
  ocr_dry_run            boolean NOT NULL DEFAULT false,

  -- Dua penjaga akurasi. checksum_ok = Σ baris cocok dengan total tercetak.
  -- saldo_bersambung_ok = saldo_akhir hari-N cocok saldo_awal hari-N+1 di
  -- rekening yang sama (NULL = hari berikutnya belum masuk, belum bisa dinilai).
  -- Terbukti perlu: Mandiri 1420075012038 2 Sep dicetak 17:55:50 lalu saldo
  -- akhirnya 309.212.500,41 sementara saldo awal 3 Sep 470.560.990,41 —
  -- 161,3 jt transaksi tidak terekam sama sekali.
  checksum_ok            boolean,
  saldo_bersambung_ok    boolean,
  status                 text NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'terverifikasi', 'perlu_review')),
  parse_error            text,
  raw_text               text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, tanggal)
);
CREATE INDEX IF NOT EXISTS bank_statement_tanggal_idx ON bank_statement (tanggal DESC);
CREATE INDEX IF NOT EXISTS bank_statement_status_idx ON bank_statement (status);
COMMENT ON TABLE bank_statement IS 'F-CASHIN — satu baris per file rekening koran. Hanya status=terverifikasi yang boleh masuk resume Direktur.';
COMMENT ON COLUMN bank_statement.status IS 'terverifikasi = checksum lolos (boleh masuk resume); perlu_review = checksum/saldo tidak cocok atau parse gagal (TIDAK masuk resume, disebut sebagai peringatan).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Baris mutasi
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_statement_line (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id     uuid NOT NULL REFERENCES bank_statement(id) ON DELETE CASCADE,
  urut             integer NOT NULL,
  waktu            timestamptz,                    -- jam transaksi kalau dicetak bank
  deskripsi        text NOT NULL DEFAULT '',
  debit            numeric(18,2) NOT NULL DEFAULT 0,
  kredit           numeric(18,2) NOT NULL DEFAULT 0,
  saldo            numeric(18,2),
  referensi        text,

  -- 'pengeluaran' ada supaya baris DEBIT biasa (bayar vendor, gaji, principal —
  -- s/d 50 baris per hari di Mandiri) punya tempat sendiri. Tanpa itu semuanya
  -- menumpuk di 'belum_ditriage' dan daftar triage jadi tak terpakai: yang
  -- benar-benar perlu diputuskan manusia tenggelam di antara ratusan baris
  -- pengeluaran rutin.
  kategori         text NOT NULL DEFAULT 'belum_ditriage' CHECK (kategori IN (
                     'uang_masuk_riil', 'afiliasi_grup', 'puteran_internal',
                     'bunga', 'deposito', 'refund', 'biaya_pajak',
                     'pengeluaran', 'belum_ditriage'
                   )),
  kategori_oleh    text NOT NULL DEFAULT 'aturan' CHECK (kategori_oleh IN ('aturan', 'llm', 'manual')),
  -- Pasangan puteran: debit di rekening A menunjuk kredit di rekening B dan
  -- sebaliknya. ON DELETE SET NULL supaya menghapus salah satu statement tidak
  -- menghapus baris pasangannya.
  pasangan_line_id uuid REFERENCES bank_statement_line(id) ON DELETE SET NULL,
  catatan          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_id, urut)
);
CREATE INDEX IF NOT EXISTS bank_statement_line_stmt_idx ON bank_statement_line (statement_id);
CREATE INDEX IF NOT EXISTS bank_statement_line_kategori_idx ON bank_statement_line (kategori);
-- Index pencocokan pasangan puteran: cari kredit/debit bernominal sama di hari
-- yang sama. Partial (hanya baris yang belum berpasangan) — itu yang dicari.
CREATE INDEX IF NOT EXISTS bank_statement_line_match_idx
  ON bank_statement_line (kredit, debit) WHERE pasangan_line_id IS NULL;
COMMENT ON TABLE bank_statement_line IS 'F-CASHIN — baris mutasi rekening koran. kategori menentukan apakah baris ikut total uang masuk riil.';
COMMENT ON COLUMN bank_statement_line.pasangan_line_id IS 'Baris pasangan puteran internal (debit<->kredit lintas rekening milik WRG). Terisi = bukti puteran; nama sendiri di deskripsi TIDAK cukup jadi bukti.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Whitelist afiliasi grup
-- ─────────────────────────────────────────────────────────────────────────────
-- Nama afiliasi disimpan sebagai DATA, bukan konstanta di kode: menambah
-- afiliasi = INSERT satu baris, tidak perlu rilis. (Pelajaran dari brand_alias:
-- daftar nama yang hidup di kode selalu ketinggalan dari kenyataan.)
CREATE TABLE IF NOT EXISTS bank_afiliasi (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pola       text NOT NULL UNIQUE,          -- dicocokkan case-insensitive ke deskripsi baris
  nama       text NOT NULL,
  catatan    text,
  aktif      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE bank_afiliasi IS 'F-CASHIN — pola nama afiliasi grup (Pratamindo, Insan Wahana Gumilang, ...). Penerimaan dari afiliasi dilaporkan terpisah dari uang masuk pihak ketiga, atas keputusan user 7 Sep 2026: "bisa dua-duanya".';

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed
-- ─────────────────────────────────────────────────────────────────────────────
-- 10 rekening yang terdeteksi dari folder REKENING KORAN (31 Agu – 4 Sep 2026).
-- Keputusan user 7 Sep 2026: pakai yang ada saat ini dulu, dan SEMUA rekening
-- wajib setor harian.
--
-- Nomor rekening + jenis untuk 5 rekening ber-statement PDF vector (Index 131/
-- 336/890, Hana, BNI) diambil dengan me-render halamannya jadi gambar lalu
-- dibaca — bukan ditebak. Dua di antaranya mengubah klasifikasi awal:
--   * HANA saldo -3.955.522.844,40 → fasilitas KREDIT, bukan rekening kas.
--     Jadi "puteran 50 jt Hana → Mandiri" (2 Sep) sebenarnya TARIKAN pinjaman.
--   * INDEX 336 jenisnya tercetak 'GIRO ESCROW', dan INDEX 890 'GIRO PERUSAHAAN'
--     — hanya 131 & 881 yang PRK. Menyamaratakan semua Index sebagai pinjaman
--     akan salah mengecualikan dua rekening kas/escrow dari perhitungan.
--
-- Pemindahbukuan INTERNAL Bank Index juga terbukti berpasangan (2 Sep):
--   INDEX 336 debit 29.905.935 -> INDEX 131 kredit 29.905.935 ('PaymentFromBuffer')
--   INDEX 890 debit  7.865.982 -> INDEX 131 kredit  7.865.982 ('PaymentFromOperational')
-- Jadi aturan pencocokan pasangan bekerja lintas bank MAUPUN dalam satu bank.
--
-- ON CONFLICT DO NOTHING → seed tidak menimpa koreksi manual admin.
INSERT INTO bank_account (label_file, bank_kode, nama_bank, no_rekening, nama_pemilik, cabang, swift_kode, jenis, catatan) VALUES
  ('BJTM',      'BJTM',  'Bank Jatim',  '0321018688',    'WAHANA RIZKY GUMILANG PT', 'Cabang Dr Sutomo',     'PDJTIDJ1', 'kas',          'Rekening penerimaan — hampir semua SP2D/BLUD RSUD masuk di sini'),
  ('MDR 038',   'MDR',   'Bank Mandiri','1420075012038', 'WAHANA RIZKY GUMILAN',     'KCP Sby Gubeng',       'BMRIIDJA', 'kas',          'Rekening operasional utama — s/d 50 debit per hari'),
  ('MDR 734',   'MDR',   'Bank Mandiri','1420019171734', 'WAHANA RIZKY GUMILAN',     'KCP Sby Diponegoro',   'BMRIIDJA', 'kas',          'Dana parkir — 31 Agu hanya bunga/biaya adm/pajak'),
  ('NIAGA',     'NIAGA', 'CIMB Niaga',  '860013719700',  'WAHANA RIZKY GUMILANG',    NULL,                   'BNIAIDJA', 'kas',          'Ada fasilitas deposito (FD); profit payment deposito masuk di sini. Statement-nya dibaca lewat OCR (tata kolom teksnya bocor).'),
  ('INDEX 881', 'INDEX', 'Bank Index',  '7001077881',    'WAHANA RIZKY',             NULL,                   'BIDXIDJA', 'prk_pinjaman', 'PRK PERUSAHAAN plafon Rp 13.000.000.000'),
  ('INDEX 131', 'INDEX', 'Bank Index',  '7001088131',    'WAHANA RIZKY',             NULL,                   'BIDXIDJA', 'prk_pinjaman', 'PRK PERUSAHAAN plafon Rp 2.800.000.000 (fasilitas terpisah dari 881)'),
  ('INDEX 336', 'INDEX', 'Bank Index',  '7001088336',    'WAHANA RIZKY',             NULL,                   'BIDXIDJA', 'escrow',       'GIRO ESCROW — sumber pemindahbukuan "PaymentFromBuffer" ke PRK 131'),
  ('INDEX 890', 'INDEX', 'Bank Index',  '7001077890',    'WAHANA RIZKY',             NULL,                   'BIDXIDJA', 'kas',          'GIRO PERUSAHAAN — sumber pemindahbukuan "PaymentFromOperational" ke PRK 131'),
  ('HANA',      'HANA',  'Bank Hana',   '17777999777',   'WAHANA RIZKY GUMILANG',    NULL,                   'HNBNIDJA', 'prk_pinjaman', 'Saldo negatif ~-3,96 M = fasilitas kredit. Transfer 50 jt ke Mandiri 2 Sep = tarikan pinjaman, bukan pindah kas.'),
  ('BNI',       'BNI',   'Bank BNI',    '1586200460',    'WAHANA RIZKY GUMILANG PT', NULL,                   'BNINIDJA', 'kas',          '31 Agu isinya hanya jasa giro/bunga, PPH, biaya adm rek')
ON CONFLICT (label_file) DO NOTHING;

-- Afiliasi grup yang sudah diketahui muncul di mutasi.
INSERT INTO bank_afiliasi (pola, nama, catatan) VALUES
  ('PRATAMINDO',          'PT Pratamindo Mitra Rizky', 'Terlihat sebagai BIFAST Out di Mandiri 4 Sep 2026 (25 jt)'),
  ('INSAN WAHANA',        'Insan Wahana Gumilang',     'Terlihat sebagai BIFAST Out di Mandiri 4 Sep 2026 (5 jt)')
ON CONFLICT (pola) DO NOTHING;

-- Migrasi 157 mengeraskan hak baca (readonly_hardening) — tabel baru tidak
-- otomatis kebagian GRANT, jadi disamakan dengan tabel sekitarnya.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON bank_account, bank_statement, bank_statement_line, bank_afiliasi
      TO wrg_readonly;
  END IF;
END $$;
