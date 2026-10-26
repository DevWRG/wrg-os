-- 254_tua_item.sql — QW2: pelacakan umur item TUA lintas hari.
-- Resume eksekutif hanya mencakup 7 jam terakhir, jadi umur >2 hari (eskalasi
-- komunikasi Harga ke Direktur) tak bisa dibaca dari teksnya. Tabel ini mencatat
-- kapan sebuah topik OUTSTANDING pertama kali terlihat. Additive & idempoten.
-- Nomor 252 (F96) & 253 (F155) dipakai branch lain yang belum merge.
CREATE TABLE IF NOT EXISTS tua_item (
  topik_key   text PRIMARY KEY,
  topik       text NOT NULL,
  kategori    text NOT NULL DEFAULT 'umum' CHECK (kategori IN ('harga', 'umum')),
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  eskalasi_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON tua_item TO wrg_app;
GRANT SELECT ON tua_item TO wrg_readonly;
