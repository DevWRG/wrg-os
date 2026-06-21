-- 040 — F76 WatchPoint: nilai metric MANUAL per HoD (yang tak bisa dihitung dari
-- Accurate/plan: JV, CLIA, uptime, refinancing, dll). Computed metric (revenue,
-- AR, kunjungan, churn) TIDAK disimpan di sini — dihitung live.
-- Tabel sengaja kosong di awal: metric tanpa baris → tampil N/A (bukan dummy).
-- Diisi via input HoD (kanal input menyusul) atau UPSERT manual.

CREATE TABLE IF NOT EXISTS watchpoint_metric (
  hod_key         text NOT NULL,
  metric_key      text NOT NULL,
  actual          numeric,          -- nilai aktual (NULL utk metric kualitatif)
  status_override text,             -- GREEN|YELLOW|RED|NA utk metric kualitatif (target NULL)
  note            text,             -- konteks 1 kalimat (opsional)
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hod_key, metric_key)
);

COMMENT ON TABLE watchpoint_metric IS 'F76 WatchPoint — nilai metric manual per HoD (computed metric dihitung live, tidak di sini).';
