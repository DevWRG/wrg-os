-- WRG Monitor — rekap (ringkasan kolektif 5-jam) & resume (eksekutif harian),
-- hasil summarization AI dari pesan WA. Disimpan sbg teks per (tanggal, waktu).
-- Sumber legacy: data/rekap/<date>/rekap_<HHMM>.txt & data/resume/<date>/resume_*.txt.
CREATE TABLE IF NOT EXISTS monitor_digest (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        VARCHAR(10) NOT NULL,          -- 'rekap' | 'resume'
  tanggal     DATE NOT NULL,
  waktu       VARCHAR(8),                     -- label jam, mis. '22:00'
  content     TEXT NOT NULL,
  source_file TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, tanggal, waktu)
);
CREATE INDEX IF NOT EXISTS monitor_digest_kind_tgl_idx ON monitor_digest (kind, tanggal DESC, waktu DESC);
