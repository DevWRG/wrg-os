-- 028_notif_state.sql — state idempoten untuk notifikasi terjadwal (anti-spam).
-- Dipakai notif_tua (port wrg-monitor/notif_tua.sh): simpan signature set item
-- TUA terakhir yang dikirim, supaya tidak spam saat set item tidak berubah.
CREATE TABLE IF NOT EXISTS notif_state (
  key        TEXT PRIMARY KEY,
  signature  TEXT NOT NULL DEFAULT '',
  count      INTEGER NOT NULL DEFAULT 0,
  sent_at    TIMESTAMPTZ
);
