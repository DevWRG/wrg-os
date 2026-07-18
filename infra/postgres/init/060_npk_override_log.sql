-- 060 — F66 NPK Engine: audit trail override skor (HoD ajukan → Direktur approve,
-- SK Pasal 3 override authority). Tabel dibuat sekarang; UI override menyusul
-- (out-of-scope batch menu view ini). Additive, idempoten.

CREATE TABLE IF NOT EXISTS npk_override_log (
  id         serial       PRIMARY KEY,
  hod_key    text         NOT NULL,
  year       int          NOT NULL,
  period     text         NOT NULL,
  aspect     text,                       -- null = override skor NPK final (bukan per-aspek)
  old_value  numeric,
  new_value  numeric,
  reason     text,
  changed_by text,                        -- app_user.id
  changed_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_npk_override_key ON npk_override_log(hod_key, year, period);
