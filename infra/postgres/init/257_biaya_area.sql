-- 257_biaya_area.sql — F150 tahap 2: baris biaya operasional Accurate yang sudah bertanda AREA.
-- Sumber: other-payment (kas/bank) + purchase-invoice (detailExpense) + journal-voucher
-- (penyusutan/amortisasi 6200-04..07), akun 6100/6200/6300 saja. HPP 5100 TIDAK disimpan
-- di sini (Laba Kotor = revenue netto − HPP dari tabel HPP wrg-os).
-- Aturan penandaan area: apps/api/src/repo/biaya-area-rules.ts. Additive & idempoten.
-- Data nyata TIDAK di repo (diisi puller `biaya-area-sync`).

CREATE TABLE IF NOT EXISTS biaya_area_baris (
  sumber        text    NOT NULL CHECK (sumber IN ('other-payment', 'purchase-invoice', 'journal-voucher')),
  accurate_id   bigint  NOT NULL,
  seq           integer NOT NULL,                 -- urutan baris di dalam dokumen
  tanggal       date    NOT NULL,
  nomor         text,
  akun          text    NOT NULL,
  nama_akun     text,
  kelompok      text    NOT NULL CHECK (kelompok IN ('SDM', 'OPERASIONAL', 'LUAR USAHA')),
  jumlah        numeric(18,2) NOT NULL,
  keterangan    text,
  payee         text,
  departemen    text,                             -- kolom Departemen Accurate (menang atas aturan bila sah)
  area          text    NOT NULL,                 -- area utama; 'MULTI' = dibagi (lihat area_bagi)
  area_bagi     text[],                           -- >1 area, dibagi rata
  dasar         text    NOT NULL,
  tertandai     boolean NOT NULL DEFAULT false,   -- area bukan default Kantor Pusat
  accurate_last_update timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sumber, accurate_id, seq)
);
CREATE INDEX IF NOT EXISTS biaya_area_baris_tanggal_idx ON biaya_area_baris (tanggal);
CREATE INDEX IF NOT EXISTS biaya_area_baris_area_idx ON biaya_area_baris (area, tanggal);

-- Override payee → area (diisi HoD/Accounting; prioritas di atas aturan karyawan/kota).
CREATE TABLE IF NOT EXISTS biaya_kamus_payee (
  payee      text PRIMARY KEY,                    -- UPPERCASE, di-trim
  area       text NOT NULL,
  catatan    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Alias kota tambahan di luar area_kota (194), mis. SBY, TANGSEL, LOMBOK.
CREATE TABLE IF NOT EXISTS biaya_kamus_alias_kota (
  kata_kunci text PRIMARY KEY,                    -- UPPERCASE
  area       text NOT NULL,
  catatan    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON biaya_area_baris, biaya_kamus_payee, biaya_kamus_alias_kota TO wrg_app;
GRANT SELECT ON biaya_area_baris, biaya_kamus_payee, biaya_kamus_alias_kota TO wrg_readonly;
