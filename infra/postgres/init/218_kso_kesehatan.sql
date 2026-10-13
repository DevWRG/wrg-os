-- 218 — F73 KSO Utilization & Health Monitor.
--
-- Keputusan user (2026-10-13): status kesehatan per faskes KSO SEHAT / WASPADA /
-- KRITIS + alasan, dihitung deterministik di apps/api/src/repo/kso-kesehatan.ts
-- (beli rutin, tren revenue, utilisasi tes vs target, pembayaran, kontrak).
-- Tabel ini HANYA snapshot mingguan untuk rekap WA ke HoD ("baru jatuh ke
-- Waspada/Kritis" = dibanding snapshot minggu sebelumnya). Status harian tidak
-- disimpan — selalu dihitung ulang dari data sumber.
-- (217 sengaja dilewati: disisakan untuk PR #1694 yang perlu ganti nomor.)
-- Additive & idempoten.

CREATE TABLE IF NOT EXISTS kso_kesehatan_snapshot (
  minggu      date   NOT NULL,              -- Senin minggu ISO (WIB)
  account_id  bigint NOT NULL,              -- accurate_customer.id
  status      text   NOT NULL CHECK (status IN ('SEHAT', 'WASPADA', 'KRITIS')),
  alasan      jsonb  NOT NULL DEFAULT '[]'::jsonb,
  cabang      text,
  dibuat_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (minggu, account_id)
);

COMMENT ON TABLE kso_kesehatan_snapshot IS
  'F73: snapshot mingguan status kesehatan faskes KSO, pembanding rekap WA HoD (faskes yang baru memburuk). Keputusan user 13 Okt 2026.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON kso_kesehatan_snapshot TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_kesehatan_snapshot TO wrg_readonly;
  END IF;
END $$;
