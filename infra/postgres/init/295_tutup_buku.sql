-- F61 Tutup Buku Bulanan Countdown (issue #1774).
--
-- Keputusan user 8 Nov 2026: yang dikejar menjelang tutup buku = PENJUALAN BELUM
-- DIFAKTUR per AM (SO "Menunggu diproses" + DO terkirim belum difaktur, F149);
-- tanggal tutup buku bawaan = hari kerja terakhir bulan (Kalender Libur F14), bisa
-- digeser per bulan dari layar; pengingat H-7/H-3/H-1 hari kerja ke grup sales per
-- region (env), H-1 juga eskalasi ke grup HoD. Tabel ini hanya menyimpan GESERAN —
-- bulan tanpa baris = hari kerja terakhir bulan. Additive + idempoten.

CREATE TABLE IF NOT EXISTS tutup_buku_bulan (
  bulan       TEXT PRIMARY KEY CHECK (bulan ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tanggal     DATE NOT NULL,
  catatan     TEXT,
  diubah_oleh TEXT,
  diubah_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_char(tanggal, 'YYYY-MM') = bulan)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON tutup_buku_bulan TO wrg_app;
  END IF;
END $$;
