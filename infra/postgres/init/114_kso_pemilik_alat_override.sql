-- 114 — koreksi manual `pemilik_alat` yang TAHAN terhadap impor ulang.
--
-- MASALAH YANG DIPECAHKAN, dan ini cacat pada skrip yang saya tulis sendiri
-- (scripts/ops/kso-pemilik-alat-apply.mjs):
--
-- Aturannya "alat yang ada di laporan penyedia = PRINCIPAL, selebihnya = WRG", jadi
-- skrip itu menjalankan `UPDATE kso_asset SET pemilik_alat='WRG'` untuk SEMUA aset di
-- luar file. Pada 2026-08-19 tiga SN di file ternyata salah ketik — mesinnya ada di
-- master dengan nomor yang beda 1-3 karakter, di faskes yang sama, dan di faskes itu
-- cuma ada satu mesin sejenis:
--
--     file BGA102241220079  ->  master BGA1022412200799   (SOERATNO GEMOLONG)
--     file FS1132112212252  ->  master FS1132112212257    (PERTAMEDIKA SINABUNG)
--     file FS2052504200438  ->  master FS2052504200446    (NUSANTARA GATOEL)
--
-- Ketiganya sudah dikoreksi manual jadi PRINCIPAL di prod. Tapi koreksi itu RAPUH:
-- sekali importer dijalankan lagi, ketiganya kembali jadi WRG — tanpa error, tanpa
-- jejak, dan tanpa siapa pun tahu angkanya berubah.
--
-- ARAHNYA TIDAK NETRAL, dan itu yang membuatnya layak dibereskan di skema alih-alih
-- diingat-ingat: karena "selebihnya = WRG", setiap alat penyedia yang gagal dicocokkan
-- MELEBIHKAN basis modal WRG. Kalau angka ini kelak dipakai menghitung investasi atau
-- ROI alat, kesalahannya selalu ke arah yang menguntungkan diri sendiri.
--
-- KENAPA TABEL OVERRIDE, BUKAN KOLOM "dikonfirmasi" DI kso_asset:
--   1. Sejalan dengan `kso_item_jenis_override` (113) dan `kso_customer_map.dikonfirmasi`
--      — repo ini sudah memilih pola "koreksi manual hidup di tempatnya sendiri".
--   2. Koreksinya bisa dibaca sebagai daftar: satu SELECT menjawab "apa saja yang kita
--      betulkan dengan tangan, dan kenapa". Kolom boolean di tabel 562 baris tidak.
--   3. Aset yang SN-nya belum ada di master (mis. NAMIRA RSI Lombok Timur, faskesnya
--      nol aset) tetap bisa dicatat di sini sebagai utang yang terlihat, alih-alih
--      hilang begitu saja.
--
-- SENGAJA DIBIARKAN KOSONG. Isinya nama faskes + SN alat, dan repo ini PUBLIK — sama
-- alasannya dengan kso_item_jenis_override (113) dan penolakan kso-sheet-to-json.py
-- menulis JSON ke dalam working tree. Isi lewat SQL di prod.

CREATE TABLE IF NOT EXISTS kso_pemilik_alat_override (
  sn_key       text        PRIMARY KEY,
  pemilik_alat text        NOT NULL CHECK (pemilik_alat IN ('WRG','PRINCIPAL','CUSTOMER')),
  -- WAJIB, bukan opsional: override tanpa alasan adalah angka yang tidak bisa
  -- ditinjau ulang, dan enam bulan lagi tidak akan ada yang berani mencabutnya.
  alasan       text        NOT NULL,
  dibuat       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE kso_pemilik_alat_override IS
  'Koreksi manual pemilik_alat yang MENANG atas hasil kso-pemilik-alat-apply.mjs. Dipakai saat laporan penyedia salah ketik SN sehingga alat penyedia tercatat WRG. Sengaja kosong di repo (publik) — isi lewat SQL di prod.';
COMMENT ON COLUMN kso_pemilik_alat_override.sn_key IS
  'SN dinormalisasi seperti kso_asset.sn_key. TIDAK ber-FK ke kso_asset: aset yang belum masuk master pun boleh dicatat di sini sebagai utang yang terlihat.';

-- Sengaja TIDAK di-FK ke kso_asset (lihat komentar kolom), jadi indeksnya dibuat
-- terpisah supaya penerapan override tetap murah.
CREATE INDEX IF NOT EXISTS kso_pemilik_alat_override_pemilik_idx
  ON kso_pemilik_alat_override (pemilik_alat);
