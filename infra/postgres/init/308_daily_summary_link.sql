-- 308 — Daily Summary versi ringkas + halaman detail publik bertoken.
--
-- Keputusan product owner (11 Nov 2026): pesan Daily Summary di grup HOD Squad terlalu panjang (3 pesan WA berisi
-- aktivitas per orang). Sejak 308 grup hanya menerima ringkasan (angka, nama belum report/plan, satu highlight) +
-- tautan ke halaman detail PUBLIK (/ds/<token>, tanpa login — dipilih product owner supaya HOD tinggal klik dari HP).
-- Satu baris per tanggal: token acak 128-bit (base64url, 22 huruf), angka & daftar nama (dari DB, bukan LLM), dan
-- ringkasan LLM yang sudah dipaksa (header tanggal, Overview, Perhatian). Tautan berlaku 30 hari (diperiksa API).
-- Arsip lama di monitor_digest kind='daily' tetap diisi seperti sebelumnya.

CREATE TABLE IF NOT EXISTS daily_summary_link (
  tanggal     date PRIMARY KEY,
  token       text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{22}$'),
  hari        text NOT NULL,
  label       text NOT NULL,                       -- "11 November 2026"
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- StatsDaily + matched_pct
  daftar      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- non_reporters / no_plan / on_leave (nama lengkap)
  content     text NOT NULL,                       -- ringkasan lengkap (sama dengan monitor_digest 'daily')
  dibuat_at   timestamptz NOT NULL DEFAULT now(),
  diubah_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE daily_summary_link IS
  '308: Daily Summary per tanggal + token tautan publik /ds/<token> (tanpa login, 30 hari). Diisi job daily-summary.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON daily_summary_link TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON daily_summary_link TO wrg_readonly;
  END IF;
END $$;
