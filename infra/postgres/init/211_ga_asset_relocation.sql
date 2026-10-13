-- 211 — Relokasi Aset GA (General Affairs) + berita acara bertanda tangan.
--
-- Keputusan user 13 Okt 2026: relokasi inventaris berada di bawah GA, barangnya
-- = aset di daftar Aset GA (ga_assets, migrasi 086), dan SETIAP relokasi wajib
-- disertai unggahan berita acara yang sudah ditandatangani. Alur SATU langkah:
-- relokasi baru tersimpan bersama berita acaranya (tak ada status "menunggu BA").
-- PIC boleh tetap — relokasi = pindah LOKASI; ganti PIC opsional.
--
-- Menggantikan F40 Inventory Relocation Request (migrasi 142, batch magang):
-- teks bebas tanpa sambungan ke master aset, tak pernah sampai main.
--
-- Tabel sendiri, bukan kolom di ga_asset_transfers (088): transfer mewajibkan
-- to_user_id (PIC baru user terdaftar), sementara relokasi boleh tanpa ganti
-- PIC atau ke PIC nama bebas. Kalau PIC ikut ganti, baris transfer/assignment
-- tetap ditulis oleh logika transfer yang ada; baris di sini = catatan lokasi +
-- berita acara. PIC disimpan sebagai NAMA snapshot (tampilan), bukan FK.
--
-- File berita acara di GA_UPLOAD_ROOT (sama dengan foto/dokumen aset F132),
-- disajikan lewat /media yang sudah meng-allow-list root itu.

CREATE TABLE IF NOT EXISTS ga_asset_relocation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL REFERENCES ga_assets(id) ON DELETE CASCADE,
  from_location    text,
  to_location      text NOT NULL,
  from_pic         text,
  to_pic           text,
  pic_berubah      boolean NOT NULL DEFAULT false,
  relocation_date  date NOT NULL DEFAULT CURRENT_DATE,
  reason           text,
  ba_path          text NOT NULL,
  ba_file_name     text,
  ba_mime          text,
  ba_size          integer,
  created_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_asset_relocation_asset_idx ON ga_asset_relocation (asset_id);
CREATE INDEX IF NOT EXISTS ga_asset_relocation_date_idx  ON ga_asset_relocation (relocation_date DESC);

COMMENT ON TABLE ga_asset_relocation IS
  'Relokasi aset GA (pindah lokasi, PIC opsional) — wajib berita acara bertanda tangan (ba_path). Keputusan user 13 Okt 2026, menggantikan F40 inventory_relocation_request.';
