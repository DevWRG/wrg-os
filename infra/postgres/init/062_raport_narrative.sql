-- 062: Narasi AI raport (Fase 3). Cache hasil generate BATCH (dijadwalkan setelah
-- 23:00) per karyawan + periode → ditampilkan di raport (Kesimpulan, bullet BSC,
-- akar masalah, catatan adil, predikat). Tanpa BEGIN/COMMIT (runner auto-deploy
-- membungkus transaksi). Idempotent (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS raport_narrative (
  am_id      VARCHAR(50) NOT NULL,
  period     VARCHAR(10) NOT NULL,          -- 2026 | 2026-H1 | 2026-Q3 | 2026-07
  verdict    VARCHAR(20),                   -- ya | tidak | bersyarat
  headline   TEXT,                          -- kesimpulan 1 kalimat
  narrative  JSONB NOT NULL DEFAULT '{}',   -- {pantas_puas[], penahan[], bsc{fin,cust,proc,learn}, akar_masalah, catatan_adil, ringkasan, predikat}
  model      VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (am_id, period)
);

CREATE INDEX IF NOT EXISTS idx_raport_narrative_period ON raport_narrative (period);
