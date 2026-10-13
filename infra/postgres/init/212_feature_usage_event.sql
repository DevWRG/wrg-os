-- 212 — F58 AI Champion / Training Adoption Tracker. Additive, idempoten.
--
-- Satu baris = satu pemakaian fitur oleh satu user:
--   kind='view'   → membuka halaman fitur (di-throttle di API, 1 per user+fitur per 30 mnt)
--   kind='action' → aksi tulis yang BERHASIL (POST/PUT/PATCH/DELETE → 2xx)
-- Champion/laggard dinilai dari 'action' saja; 'view' hanya konteks.
--
-- Hanya (user, fitur, jenis, waktu) — TIDAK menyimpan isi data/payload.
-- Mulai dari nol saat F58 aktif (tanpa backfill, keputusan Direktur 2026-10-13).
-- feature_key sengaja tanpa FK: fitur yang dinonaktifkan dari katalog tak boleh
-- menghapus riwayat pemakaiannya; validasi keberadaan dilakukan di API saat INSERT.

CREATE TABLE IF NOT EXISTS feature_usage_event (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  feature_key text        NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('view','action')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_usage_event_feature_idx ON feature_usage_event (feature_key, occurred_at);
CREATE INDEX IF NOT EXISTS feature_usage_event_user_idx    ON feature_usage_event (user_id, feature_key, kind, occurred_at DESC);

COMMENT ON TABLE feature_usage_event IS 'F58 — jejak pemakaian fitur per user (view/action) utk adopsi & training. Bukan KPI.';

-- Fitur menu "Adopsi Fitur" (key = featureKey("/adoption")) disemai TERTUTUP: tak ada
-- baris access_permission → tak seorang pun (kecuali admin/superuser) melihatnya
-- sampai admin mencentang di matriks Akses Grup. Sync Fitur melengkapi katalognya.
