-- 182 — jejak penandaan tipe lead insentif (F67, lanjutan migrasi 093).
--
-- Menandai satu invoice sebagai lead B atau C memindahkan 70-85% insentifnya dari AM ke
-- HO Pool. Itu keputusan yang mengubah penghasilan orang, jadi harus bisa ditanya
-- "siapa, kapan, dari apa ke apa, alasannya apa" — bukan cuma menyisakan nilai terakhir
-- di `insentif_transaksi.lead_type`.
--
-- `lead_set_by` sudah ada sejak 093 tapi tanpa waktu dan tanpa riwayat: penandaan yang
-- dibatalkan lagi ke 'A' hilang tanpa bekas, dan compute ulang menimpa `computed_from`.
-- Dua hal itu yang ditambal di sini.

ALTER TABLE insentif_transaksi
  ADD COLUMN IF NOT EXISTS lead_set_at TIMESTAMPTZ;

COMMENT ON COLUMN insentif_transaksi.lead_set_at IS
  'Kapan lead_type terakhir ditandai manusia. NULL = masih default A, belum pernah ditandai.';

-- Riwayat lengkap. Append-only: tidak ada UPDATE/DELETE dari aplikasi.
--
-- Sengaja TIDAK pakai FK ke insentif_transaksi(id): baris transaksi bisa ditulis ulang
-- oleh compute (ON CONFLICT ... DO UPDATE mempertahankan id, tapi hapus-tulis periode
-- lama tetap mungkin lewat ops), dan riwayat keputusan manusia tidak boleh ikut hilang
-- saat angka dihitung ulang. Kuncinya (periode, invoice_no, am_id) — sama dengan yang
-- dipakai UNIQUE di 093.
CREATE TABLE IF NOT EXISTS insentif_lead_log (
  id            BIGSERIAL PRIMARY KEY,
  am_id         VARCHAR(50) NOT NULL,
  periode       CHAR(7)     NOT NULL,
  invoice_no    TEXT        NOT NULL,
  lead_dari     CHAR(1)     NOT NULL CHECK (lead_dari IN ('A','B','C')),
  lead_ke       CHAR(1)     NOT NULL CHECK (lead_ke   IN ('A','B','C')),
  actor_user_id TEXT        NOT NULL,   -- app_user.id
  actor_role    TEXT,
  catatan       TEXT,
  acted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ins_lead_log ON insentif_lead_log (periode, am_id, invoice_no);
