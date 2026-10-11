-- 200 — F85 Senin Morning Brief: satu baris per minggu ISO.
--
-- Brief disusun Senin pagi (setelah watchpoint-snapshot 06:00) dari data minggu
-- ISO yang BARU TUTUP, lalu dikirim WA ke Direktur sebelum rapat HoD. Format =
-- "Direktur Overview Aggregation" di HOD-Prompt-Workflow.md §4 (Drive, 16 Jun
-- 2026): 5 cek per HoD → SIAP / PERLU KLARIFIKASI / TIDAK SIAP + Overall Health.
--
-- Sengaja TABEL SENDIRI, bukan digest_briefing (A10): grain-nya beda (per minggu
-- ISO yang dinilai, bukan week_start saat dibuat), status per HoD wajib bisa
-- dibaca mesin (checks jsonb), dan generate ulang minggu yang sama harus
-- MENIMPA — bukan menumpuk baris seperti A10.
--
-- Kolom:
--   health    RED / RISK / ON-TRACK — dihitung DETERMINISTIK dari checks, bukan
--             dari LLM (LLM hanya menulis narasi).
--   checks    array per HoD: {hod_key, nama, peran, status, checks:[{no, label,
--             hasil OK|WARN|FAIL|NA, detail}], watch_status}
--   content   markdown lengkap (tabel ringkasan + narasi) yang tampil di /briefings
--   narasi_ok false = LLM gagal → content cuma bagian deterministik
--   wa_*      jejak pengiriman ke Direktur (NULL = belum/tidak dikirim)

CREATE TABLE IF NOT EXISTS senin_brief (
  id            bigserial PRIMARY KEY,
  iso_year      int  NOT NULL,
  iso_week      int  NOT NULL,
  periode       text NOT NULL,
  health        text NOT NULL CHECK (health IN ('RED', 'RISK', 'ON-TRACK')),
  checks        jsonb NOT NULL DEFAULT '[]',
  content       text NOT NULL,
  narasi_ok     boolean NOT NULL DEFAULT false,
  model_used    text,
  wa_target     text,
  wa_sent_at    timestamptz,
  wa_error      text,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (iso_year, iso_week)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON senin_brief TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE senin_brief_id_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON senin_brief TO wrg_readonly;
  END IF;
END $$;
