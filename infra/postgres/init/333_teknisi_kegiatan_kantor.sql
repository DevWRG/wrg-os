-- F175 kegiatan teknisi di KANTOR (keputusan user 18 Nov 2026): Training, Maintenance (= PM), Prepare,
-- Administrasi — cukup #REPORT (tanpa #PLAN/#START), isian wajib sama dengan kunjungan. Blok `KANTOR …` /
-- `RS: Kantor`. Report tanpa plan (kantor maupun kunjungan) kini dicatat sebagai item di luar plan (urut 51+)
-- supaya tampil di Kinerja Teknisi.

ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS kantor boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN teknisi_plan_item.kantor IS
  'true = kegiatan di kantor (Training/PM/Prepare/Administrasi), dicatat dari #REPORT tanpa plan; tak butuh #START/foto geotag.';

ALTER TABLE teknisi_plan_item DROP CONSTRAINT IF EXISTS teknisi_plan_item_jenis_check;
ALTER TABLE teknisi_plan_item ADD CONSTRAINT teknisi_plan_item_jenis_check CHECK (jenis IN ('PM','Service','Install','Uji Fungsi','Tarik Alat','Training','Kalibrasi','Call','Prepare','Administrasi'));
ALTER TABLE teknisi_kunjungan_alat DROP CONSTRAINT IF EXISTS teknisi_kunjungan_alat_jenis_check;
ALTER TABLE teknisi_kunjungan_alat ADD CONSTRAINT teknisi_kunjungan_alat_jenis_check CHECK (jenis IN ('PM','Service','Install','Uji Fungsi','Tarik Alat','Training','Kalibrasi','Call','Prepare','Administrasi'));

CREATE OR REPLACE VIEW teknisi_kerja_v AS
SELECT
  p.id                    AS plan_item_id,
  p.teknisi_id,
  p.tanggal,
  p.urut,
  p.jenis,
  p.account_id,
  p.faskes_teks,
  p.kso_asset_id,
  p.installation_unit_id,
  p.di_luar_plan,
  p.is_late               AS plan_telat,
  p.submitted_at,
  p.started_at,
  (p.start_lat IS NOT NULL AND p.start_lon IS NOT NULL) AS start_berlokasi,
  p.start_lat, p.start_lon, p.start_alamat,
  k.reported_at           AS selesai_at,
  ka.status               AS status_report,
  ka.id                   AS kunjungan_alat_id,
  -- 333: kegiatan kantor cukup #REPORT (keputusan user 18 Nov 2026) — bukan pelanggaran tanpa #START.
  (ka.id IS NOT NULL AND p.started_at IS NULL AND NOT p.kantor)  AS report_tanpa_start,
  (p.started_at IS NOT NULL AND ka.id IS NULL)  AS start_tanpa_report,
  CASE WHEN p.started_at IS NOT NULL AND k.reported_at IS NOT NULL AND k.reported_at >= p.started_at
       THEN round(extract(epoch FROM (k.reported_at - p.started_at)) / 60)::int END AS durasi_menit,
  ka.service_ticket_id,
  t.created_at            AS tiket_masuk_at,
  CASE WHEN t.created_at IS NOT NULL AND p.started_at IS NOT NULL
       THEN round(extract(epoch FROM (p.started_at - t.created_at)) / 60)::int END AS sla_respon_menit,
  CASE WHEN t.created_at IS NOT NULL AND k.reported_at IS NOT NULL
       THEN round(extract(epoch FROM (k.reported_at - t.created_at)) / 60)::int END AS sla_selesai_menit,
  p.tidak_realisasi_at,
  -- 325: bukti lokasi dari foto REPORT ber-geotag (utama); foto #START (cadangan).
  COALESCE(fl.geo_lat, p.start_lat)                     AS lokasi_lat,
  COALESCE(fl.geo_lon, p.start_lon)                     AS lokasi_lon,
  COALESCE(fl.geo_address, p.start_alamat)              AS lokasi_alamat,
  CASE WHEN fl.geo_lat IS NOT NULL THEN 'report'
       WHEN p.start_lat IS NOT NULL THEN 'start' END    AS lokasi_sumber,
  (fl.geo_lat IS NOT NULL OR p.start_lat IS NOT NULL)   AS berlokasi,
  (SELECT count(*) FROM teknisi_kunjungan_foto f WHERE f.kunjungan_id = k.id)::int AS jumlah_foto,
  p.kantor
FROM teknisi_plan_item p
LEFT JOIN LATERAL (
  SELECT x.* FROM teknisi_kunjungan_alat x WHERE x.plan_item_id = p.id ORDER BY x.id DESC LIMIT 1
) ka ON true
LEFT JOIN teknisi_kunjungan k ON k.id = ka.kunjungan_id
LEFT JOIN service_ticket t ON t.id = ka.service_ticket_id
LEFT JOIN LATERAL (
  -- Foto alat itu didahulukan, lalu foto kunjungan umum.
  SELECT w.geo_lat, w.geo_lon, w.geo_address
  FROM teknisi_kunjungan_foto f JOIN wa_message w ON w.message_id = f.wa_message_id
  WHERE f.kunjungan_id = k.id AND w.geo_lat IS NOT NULL AND w.geo_lon IS NOT NULL
  ORDER BY (f.kunjungan_alat_id = ka.id) DESC NULLS LAST, f.id
  LIMIT 1
) fl ON true;
