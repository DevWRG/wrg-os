-- 293 — F175 bagian 2: hasil efek #REPORT Teknisi + view Plan Tidak Realisasi.
-- Lanjutan 291_teknisi_plan_report.sql. Spesifikasi: docs/features/F175-plan-report-teknisi.md.

-- Apa yang terjadi di jadwal/tiket/install akibat laporan alat ini ("jadwal rutin bulan
-- ini selesai", "2 tiket servis terbuka — tutup manual"). NULL = tak ada efek.
ALTER TABLE teknisi_kunjungan_alat ADD COLUMN IF NOT EXISTS efek text;

-- Plan Tidak Realisasi (pengganti sheet "Plan Tidak Realisasi" Google Form):
-- (a) item plan yang tak dilaporkan sampai batas (job harian mengisi tidak_realisasi_at), dan
-- (b) alat yang dilaporkan Batal (dengan atau tanpa item plan).
CREATE OR REPLACE VIEW teknisi_plan_tidak_realisasi_v AS
SELECT p.tanggal, p.teknisi_id, p.account_id, p.faskes_teks, p.kso_asset_id, p.installation_unit_id,
       p.sn_teks, p.alat_teks, p.jenis, 'tanpa laporan'::text AS alasan, p.id AS plan_item_id,
       NULL::bigint AS kunjungan_alat_id
FROM teknisi_plan_item p
WHERE p.tidak_realisasi_at IS NOT NULL AND p.reported_at IS NULL
UNION ALL
SELECT k.tanggal, k.teknisi_id, k.account_id, k.faskes_teks, ka.kso_asset_id, ka.installation_unit_id,
       ka.sn_teks, ka.alat_teks, ka.jenis, COALESCE(ka.alasan, 'batal'), ka.plan_item_id, ka.id
FROM teknisi_kunjungan_alat ka
JOIN teknisi_kunjungan k ON k.id = ka.kunjungan_id
WHERE ka.status = 'Batal';

COMMENT ON VIEW teknisi_plan_tidak_realisasi_v IS
  'F175: plan teknisi yang tak terealisasi — tak dilaporkan s/d batas (alasan ''tanpa laporan'') atau dilaporkan Batal.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT ON teknisi_plan_tidak_realisasi_v TO wrg_app;
  END IF;
END $$;
