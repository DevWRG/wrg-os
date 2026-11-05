-- F156 Arsip Dokumen Digital Terpusat (issue #2027).
--
-- Usulan bedah SOP 4 Sep 2026 — klaster suara karyawan tertinggi (BP #4
-- e-Dokumen, 16 suara). SOP Accounting "Dokumentasi Softfile": tiap bukti
-- transaksi di-scan lalu diberi nomor BUKU/TAHUN/BULAN/URUT; SOP pengarsipan
-- Finance: dokumen apa pun ketemu ≤ 15 menit.
--
-- Keputusan user 5 Nov 2026:
--   • berkas disimpan di Google Drive (akun OAuth yang sama dgn brosur F130),
--     folder GDRIVE_ARSIP_FOLDER_ID, PRIVAT — diunduh lewat API yang dijaga izin,
--     tidak pernah dibuka "siapa pun dengan tautan";
--   • tahap 1 = arsip umum + telusur, tanpa menyedot dokumen modul lain;
--   • nomor ikut format SOP Accounting; kode buku diatur admin lewat layar.
--
-- Nomor TIDAK PERNAH dipakai ulang: hapus = soft delete (dihapus_at), dan urut
-- berikutnya dihitung dari semua baris termasuk yang terhapus.

CREATE TABLE IF NOT EXISTS arsip_buku (
  kode        TEXT PRIMARY KEY CHECK (kode ~ '^[A-Z][A-Z0-9]{1,9}$'),
  nama        TEXT NOT NULL CHECK (btrim(nama) <> ''),
  keterangan  TEXT,
  aktif       BOOLEAN NOT NULL DEFAULT true,
  dibuat_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh TEXT,
  diubah_at   TIMESTAMPTZ
);

-- Isian awal — jenis dokumen yang disebut SOP; admin bisa menambah,
-- mengganti nama, atau menonaktifkan dari layar. Kode tidak bisa diganti
-- setelah dipakai (melekat di nomor dokumen).
INSERT INTO arsip_buku (kode, nama, keterangan) VALUES
  ('BKK', 'Bukti Kas Keluar',        'Accounting — bukti transaksi kas keluar'),
  ('BKM', 'Bukti Kas Masuk',         'Accounting — bukti transaksi kas masuk'),
  ('BBK', 'Bukti Bank Keluar',       'Accounting — bukti transaksi bank keluar'),
  ('BBM', 'Bukti Bank Masuk',        'Accounting — bukti transaksi bank masuk'),
  ('JU',  'Jurnal Umum / Memorial',  'Accounting — accrual, penyesuaian, mutasi bank'),
  ('SJ',  'Surat Jalan',             'SJ masuk & keluar (Admin Teknisi / Distribution)'),
  ('BA',  'Berita Acara',            'BA bertanda tangan (opname, serah terima, instalasi)'),
  ('TT',  'Tanda Terima',            'Tanda terima dokumen / barang'),
  ('FB',  'Faktur Pembelian',        'Faktur / invoice dari supplier'),
  ('SRT', 'Surat',                   'Surat konfirmasi hutang/piutang, surat keluar'),
  ('SRF', 'Sertifikat',              'Sertifikat kalibrasi / training'),
  ('PJK', 'Dokumen Perpajakan',      'BPE, salinan SPT, bukti potong'),
  ('LN',  'Lainnya',                 'Dokumen lain yang belum punya buku sendiri')
ON CONFLICT (kode) DO NOTHING;

CREATE TABLE IF NOT EXISTS arsip_dokumen (
  id              BIGSERIAL PRIMARY KEY,
  nomor           TEXT NOT NULL UNIQUE,
  buku_kode       TEXT NOT NULL REFERENCES arsip_buku(kode),
  tahun           SMALLINT NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
  bulan           SMALLINT NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  urut            INT NOT NULL CHECK (urut > 0),
  tanggal_dokumen DATE NOT NULL,
  judul           TEXT NOT NULL CHECK (btrim(judul) <> ''),
  akun            TEXT,          -- akun perkiraan / bank (SOP: simpan per bank)
  lokasi_fisik    TEXT,          -- odner / kardus tempat hardfile-nya
  ref_faktur      TEXT,          -- nomor faktur penjualan / pembelian
  ref_sj          TEXT,          -- nomor SJ / DO
  ref_po          TEXT,          -- nomor PO / penerimaan
  ref_sn          TEXT,          -- serial number alat
  keterangan      TEXT,
  drive_file_id   TEXT NOT NULL,
  nama_asli       TEXT NOT NULL,
  mime            TEXT NOT NULL,
  ukuran          INT  NOT NULL CHECK (ukuran > 0),
  diunggah_oleh   TEXT,
  diunggah_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_oleh     TEXT,
  diubah_at       TIMESTAMPTZ,
  dihapus_oleh    TEXT,
  dihapus_at      TIMESTAMPTZ,
  UNIQUE (buku_kode, tahun, bulan, urut)
);

CREATE INDEX IF NOT EXISTS arsip_dokumen_periode_idx ON arsip_dokumen (tahun, bulan, buku_kode) WHERE dihapus_at IS NULL;
CREATE INDEX IF NOT EXISTS arsip_dokumen_tanggal_idx ON arsip_dokumen (tanggal_dokumen DESC, id DESC) WHERE dihapus_at IS NULL;
-- Telusur cepat by nomor rujukan (faktur / SJ / PO / SN) — dicocokkan tanpa beda huruf besar-kecil.
CREATE INDEX IF NOT EXISTS arsip_dokumen_ref_faktur_idx ON arsip_dokumen (upper(ref_faktur)) WHERE ref_faktur IS NOT NULL;
CREATE INDEX IF NOT EXISTS arsip_dokumen_ref_sj_idx     ON arsip_dokumen (upper(ref_sj))     WHERE ref_sj IS NOT NULL;
CREATE INDEX IF NOT EXISTS arsip_dokumen_ref_po_idx     ON arsip_dokumen (upper(ref_po))     WHERE ref_po IS NOT NULL;
CREATE INDEX IF NOT EXISTS arsip_dokumen_ref_sn_idx     ON arsip_dokumen (upper(ref_sn))     WHERE ref_sn IS NOT NULL;
