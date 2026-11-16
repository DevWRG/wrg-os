-- 325 — F175: bukti lokasi kunjungan teknisi diambil dari foto #REPORT, bukan #START
-- (keputusan user 16 Nov 2026 saat uji HP: "geotag lokasi dari kirim foto yang ada di report aja").
--
-- Koordinat foto = OCR watermark Geo-Tagging Camera oleh wa-bridge (wa_message.geo_lat/geo_lon/geo_address),
-- foto report tertaut lewat teknisi_kunjungan_foto.wa_message_id. Foto #START (bila ada) jadi cadangan.
-- Kolom lama teknisi_kerja_v TIDAK diubah (start_berlokasi tetap = lokasi dari start); kolom baru ditambah di
-- ujung: lokasi_lat/lon/alamat, lokasi_sumber ('report'|'start'), berlokasi, jumlah_foto. Hanya view; idempoten.

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
  (ka.id IS NOT NULL AND p.started_at IS NULL)  AS report_tanpa_start,
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
  (SELECT count(*) FROM teknisi_kunjungan_foto f WHERE f.kunjungan_id = k.id)::int AS jumlah_foto
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

COMMENT ON VIEW teknisi_kerja_v IS
  'F175: satu baris per pekerjaan teknisi — start, selesai, durasi, SLA tiket, lokasi (foto report > foto start), tanda kepatuhan.';
