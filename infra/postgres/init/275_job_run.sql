-- 275: Papan status job terjadwal — satu baris per eksekusi job scheduler.
--
-- Prioritas Direktur 20 Okt: "dua puluh pekerjaan terjadwal berjalan tanpa papan status";
-- ringkasan piutang beku 6 minggu tanpa satu galat pun karena tak ada yang melihat job mana
-- terakhir jalan kapan. Ditulis oleh pembungkus cron di scheduler.ts (repo/job-run.ts),
-- dibaca halaman /status-job. Retensi 30 hari per job (dihapus saat job itu mencatat).
--
-- Additive + idempoten.

CREATE TABLE IF NOT EXISTS job_run (
  id        BIGSERIAL PRIMARY KEY,
  job       TEXT        NOT NULL,             -- nama di log scheduler ("accurate-sync", "A2", …)
  expr      TEXT        NOT NULL,             -- ekspresi cron saat jalan
  mulai     TIMESTAMPTZ NOT NULL,
  selesai   TIMESTAMPTZ NOT NULL,
  ok        BOOLEAN     NOT NULL,             -- false = melempar galat ATAU menulis console.error
  galat     TEXT,                             -- galat pertama (dipotong 500 karakter)
  ringkasan TEXT,                             -- console.log terakhir job (dipotong 500 karakter)
  berikut   TIMESTAMPTZ                       -- jadwal berikutnya menurut cron → dasar status TERLEWAT
);

CREATE INDEX IF NOT EXISTS job_run_job_mulai_idx ON job_run (job, mulai DESC);
