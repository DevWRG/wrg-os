-- 323 — F175 #START Teknisi: jam mulai per pekerjaan → waktu servis & SLA + kepatuhan harian.
--
-- Alur (keputusan user 16 Nov 2026): #PLAN → #START n (jam mulai, foto geotag (Geo-Tagging Camera, pola foto kunjungan AM) sebagai bukti lokasi)
-- → #REPORT n (jam selesai). Waktu servis = jam report − jam start. Report tanpa start tetap diterima,
-- ditandai. Kerja di luar plan: `#START RS | SN | jenis` membuat item plan baru (di_luar_plan).
--
-- Koordinat start disimpan permanen (puluhan byte); FOTO start dihapus setelah masa simpan (default 30 hari,
-- job teknisi-foto-start-retensi). Foto #REPORT (teknisi_kunjungan_foto) TIDAK disentuh — disimpan permanen.
-- Hanya menambah kolom/view; idempoten. Butuh service_ticket (135, Aftersales) — sudah ada di dev & main.

ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS started_at           timestamptz;
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_wa_message_id  text;
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_group_jid      text;
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_lat            numeric(9,6);
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_lon            numeric(9,6);
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_geo_ts         text;
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_alamat         text;
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_media_path     text;
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS start_foto_dihapus_at timestamptz;
-- true = item dibuat oleh #START (kerja mendadak), bukan dari #PLAN.
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS di_luar_plan         boolean NOT NULL DEFAULT false;
-- Jam pengingat "sudah start, belum report" terkirim (supaya tak dikirim dua kali).
ALTER TABLE teknisi_plan_item ADD COLUMN IF NOT EXISTS ingat_report_at      timestamptz;

CREATE INDEX IF NOT EXISTS teknisi_plan_item_start_terbuka_idx
  ON teknisi_plan_item (tanggal) WHERE started_at IS NOT NULL AND reported_at IS NULL;
CREATE INDEX IF NOT EXISTS teknisi_plan_item_start_foto_idx
  ON teknisi_plan_item (started_at) WHERE start_media_path IS NOT NULL;

-- Tiket servis yang ditutup oleh efek #REPORT Service (untuk SLA: tiket masuk → start → report).
ALTER TABLE teknisi_kunjungan_alat ADD COLUMN IF NOT EXISTS service_ticket_id uuid;

-- Satu baris per pekerjaan (item plan + laporan alat yang menautnya). Bahan dashboard Plan & Report.
-- durasi_menit  = report − start (NULL bila tanpa start / belum report)
-- sla_respon_menit / sla_selesai_menit = dari tiket masuk ke start / ke report (hanya Service bertiket).
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
  p.tidak_realisasi_at
FROM teknisi_plan_item p
LEFT JOIN LATERAL (
  SELECT x.* FROM teknisi_kunjungan_alat x WHERE x.plan_item_id = p.id ORDER BY x.id DESC LIMIT 1
) ka ON true
LEFT JOIN teknisi_kunjungan k ON k.id = ka.kunjungan_id
LEFT JOIN service_ticket t ON t.id = ka.service_ticket_id;

COMMENT ON VIEW teknisi_kerja_v IS
  'F175 #START: satu baris per pekerjaan teknisi — start, selesai, durasi, SLA tiket, tanda kepatuhan.';
