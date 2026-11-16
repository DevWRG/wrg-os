-- F176 Riwayat Alat — riwayat PM / servis / install / kalibrasi PER ALAT, ikut alatnya ke faskes
-- mana pun ia dipasang (keputusan user 17 Nov 2026: menu baru Aftersales, teknisi lihat semua alat).
--
-- KUNCI IDENTITAS = SN yang dinormalisasi (`alat_sn_key`), aturan yang SAMA dengan kso_asset.sn_key
-- (097): trim → buang kutip pembuka → buang ekor `.0` angka → upper → buang spasi → buang leading
-- zero. Tiap kejadian menyimpan faskes SAAT kejadian itu, jadi riwayat di faskes lama tetap terbaca
-- setelah alat dipindah.
--
-- Sumber riwayat (view alat_riwayat_v):
--   wa      — #REPORT teknisi F175 (teknisi_kunjungan_alat)
--   form    — Google Form "Kegiatan Teknisi" 2024–2026, diimpor ke alat_riwayat_form
--             (scripts/db/import_kegiatan_teknisi.py). Data TIDAK di repo.
--   jadwal  — kunjungan rutin F154 yang selesai TANPA #REPORT F175 (alat = snapshot SN di jadwal)
--   pm      — PM & Kalibrasi alat beli: hanya "terakhir selesai" (modul itu tak menyimpan per kejadian)
--   install — install_schedule selesai tanpa #REPORT F175
--   servis  — laporan lama #install/#servis/#training/#kalibrasi (teknisi_report) per unit beli

CREATE OR REPLACE FUNCTION alat_sn_key(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN s = '' THEN NULL ELSE COALESCE(NULLIF(ltrim(s, '0'), ''), s) END
  FROM (
    SELECT upper(regexp_replace(
             regexp_replace(regexp_replace(btrim(coalesce(raw, '')), '^[''"`‘’]+', ''), '^(\d+)\.0$', '\1'),
             '\s+', '', 'g')) AS s
  ) x
$$;
COMMENT ON FUNCTION alat_sn_key(text) IS
  'F176: normalisasi SN = aturan kso_asset.sn_key (097) / normSn() di asetTetapRekon.ts. NULL bila kosong.';

-- Riwayat lama Google Form "Kegiatan Teknisi". Idempoten per baris form (`baris_key`), jadi impor
-- ulang ekspor terbaru hanya menambah baris baru. Foto form TIDAK diimpor (isinya path internal
-- AppSheet, bukan tautan), begitu juga email pengirim & nama analis (data pribadi, tak dibutuhkan).
CREATE TABLE IF NOT EXISTS alat_riwayat_form (
  id               bigserial   PRIMARY KEY,
  baris_key        text        NOT NULL UNIQUE,
  waktu            timestamptz NOT NULL,
  jenis_kegiatan   text,                 -- Visit / Call / Join Visit
  jenis_kunjungan  text,                 -- Maintenance / Service / Install / Tarik Alat / Uji Fungsi / …
  cabang           text,
  kota             text,
  customer_teks    text,
  account_id       bigint      REFERENCES accurate_customer(id) ON DELETE SET NULL,
  jenis_alat       text,
  type_alat        text,
  sn_teks          text,
  sn_key           text,
  teknisi_nama     text,
  keluhan          text,
  kegiatan         text,
  jumlah_tes       numeric,
  sparepart        text,
  catatan          text,
  kondisi_alat     text,
  keterangan       text,
  waktu_keluhan    timestamptz,
  waktu_selesai    timestamptz,
  status_sla       text,
  diimpor_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alat_riwayat_form_sn_idx ON alat_riwayat_form (sn_key);
CREATE INDEX IF NOT EXISTS alat_riwayat_form_waktu_idx ON alat_riwayat_form (waktu);
COMMENT ON TABLE alat_riwayat_form IS
  'F176: impor Google Form "Kegiatan Teknisi" (Form Responses 1). baris_key = md5(timestamp|SN|teknisi|jenis).';

CREATE OR REPLACE VIEW alat_riwayat_v AS
-- 1. #REPORT teknisi F175 — satu baris per alat per kunjungan.
SELECT
  'wa'::text                                         AS sumber,
  'wa:' || ka.id                                      AS ref,
  COALESCE(a.sn_key, alat_sn_key(iu.serial_number), alat_sn_key(ka.sn_teks)) AS sn_key,
  COALESCE(a.sn_raw, iu.serial_number, ka.sn_teks)    AS sn,
  COALESCE(NULLIF(a.nama_alat, ''), a.type_alat, iu.alat_name, ka.alat_teks) AS alat,
  k.reported_at                                       AS waktu,
  ka.jenis                                            AS jenis,
  ka.status || COALESCE(' — ' || NULLIF(ka.alasan, ''), '') AS status,
  k.account_id                                        AS account_id,
  COALESCE(ac.name, k.faskes_teks)                    AS faskes,
  COALESCE(NULLIF(mu.panggilan, ''), mu.nama, k.teknisi_id) AS teknisi,
  NULL::text                                          AS keluhan,
  ka.kegiatan                                         AS kegiatan,
  NULLIF(ka.sparepart, '')                            AS sparepart,
  ka.jumlah_tes::numeric                              AS jumlah_tes,
  NULL::text                                          AS kondisi,
  NULLIF(concat_ws(' · ', NULLIF(ka.catatan, ''), NULLIF(k.catatan, '')), '') AS catatan
FROM teknisi_kunjungan_alat ka
JOIN teknisi_kunjungan k ON k.id = ka.kunjungan_id
LEFT JOIN kso_asset a ON a.id = ka.kso_asset_id
LEFT JOIN installation_unit iu ON iu.id = ka.installation_unit_id
LEFT JOIN accurate_customer ac ON ac.id = k.account_id
LEFT JOIN master_user mu ON mu.am_id = k.teknisi_id

UNION ALL
-- 2. Google Form "Kegiatan Teknisi" (impor).
SELECT
  'form', 'form:' || f.id, f.sn_key, f.sn_teks,
  NULLIF(concat_ws(' ', NULLIF(f.type_alat, ''), '(' || NULLIF(f.jenis_alat, '') || ')'), ''),
  f.waktu, f.jenis_kunjungan,
  NULLIF(concat_ws(' · ', NULLIF(f.jenis_kegiatan, ''), NULLIF(f.status_sla, '')), ''),
  f.account_id, COALESCE(ac.name, f.customer_teks), f.teknisi_nama,
  NULLIF(f.keluhan, ''), NULLIF(f.kegiatan, ''), NULLIF(f.sparepart, ''), f.jumlah_tes,
  NULLIF(f.kondisi_alat, ''), NULLIF(concat_ws(' · ', NULLIF(f.keterangan, ''), NULLIF(f.catatan, '')), '')
FROM alat_riwayat_form f
LEFT JOIN accurate_customer ac ON ac.id = f.account_id

UNION ALL
-- 3. Kunjungan rutin F154 yang selesai tanpa #REPORT F175 (kalau ada report, baris 1 sudah mewakili).
SELECT
  'jadwal', 'jadwal:' || jr.id || ':' || x.ord, alat_sn_key(x.el->>'sn'), x.el->>'sn', x.el->>'nama',
  COALESCE(jr.selesai_at, jr.tanggal::timestamptz), 'PM', 'Selesai (jadwal rutin)',
  jr.account_id, ac.name, COALESCE(NULLIF(mu.panggilan, ''), mu.nama, jr.teknisi_id),
  NULL, NULLIF(jr.catatan, ''), NULL, NULL, NULL, NULL
FROM jadwal_rutin jr
CROSS JOIN LATERAL jsonb_array_elements(jr.alat) WITH ORDINALITY AS x(el, ord)
LEFT JOIN accurate_customer ac ON ac.id = jr.account_id
LEFT JOIN master_user mu ON mu.am_id = jr.teknisi_id
WHERE jr.status = 'selesai'
  AND NOT EXISTS (
    SELECT 1 FROM teknisi_plan_item p JOIN teknisi_kunjungan_alat ka2 ON ka2.plan_item_id = p.id
    WHERE p.jadwal_rutin_id = jr.id)

UNION ALL
-- 4. PM & Kalibrasi alat beli — modul itu hanya menyimpan penyelesaian TERAKHIR.
SELECT
  'pm', 'pm:' || ms.id, alat_sn_key(iu.serial_number), iu.serial_number, iu.alat_name,
  ms.last_completed_at, 'PM', 'Selesai (PM & Kalibrasi, ' || ms.completed_count || '× tercatat)',
  iu.account_id, COALESCE(ac.name, iu.customer_name), ms.teknisi_name,
  NULL, NULLIF(ms.last_note, ''), NULL, NULL, NULL, NULL
FROM maintenance_schedule ms
JOIN installation_unit iu ON iu.id = ms.installation_unit_id
LEFT JOIN accurate_customer ac ON ac.id = iu.account_id
WHERE ms.last_completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM teknisi_kunjungan_alat ka2 JOIN teknisi_kunjungan k2 ON k2.id = ka2.kunjungan_id
    WHERE ka2.installation_unit_id = iu.id AND ka2.jenis = 'PM'
      AND (k2.reported_at AT TIME ZONE 'Asia/Jakarta')::date = (ms.last_completed_at AT TIME ZONE 'Asia/Jakarta')::date)

UNION ALL
-- 5. Install alat beli yang selesai tanpa #REPORT F175.
SELECT
  'install', 'install:' || isc.id, alat_sn_key(iu.serial_number), iu.serial_number, iu.alat_name,
  COALESCE(iu.bast_at, isc.updated_at), 'Install', 'Selesai',
  iu.account_id, COALESCE(ac.name, iu.customer_name), tc.nama,
  NULL, NULLIF(isc.note, ''), NULL, NULL, NULL, NULL
FROM install_schedule isc
JOIN installation_unit iu ON iu.id = isc.installation_unit_id
LEFT JOIN accurate_customer ac ON ac.id = iu.account_id
LEFT JOIN teknisi_capacity tc ON tc.id = isc.teknisi_id
WHERE isc.status = 'done'
  AND NOT EXISTS (
    SELECT 1 FROM teknisi_plan_item p JOIN teknisi_kunjungan_alat ka2 ON ka2.plan_item_id = p.id
    WHERE p.install_schedule_id = isc.id)

UNION ALL
-- 6. Laporan lama #install/#servis/#training/#kalibrasi (teks bebas) per unit beli.
SELECT
  'servis', 'servis:' || tr.id, alat_sn_key(iu.serial_number), iu.serial_number, iu.alat_name,
  tr.created_at, initcap(tr.report_type), NULL,
  iu.account_id, COALESCE(ac.name, iu.customer_name), tc.nama,
  NULL, tr.body, NULL, NULL, NULL, NULL
FROM teknisi_report tr
JOIN installation_unit iu ON iu.id = tr.installation_unit_id
LEFT JOIN accurate_customer ac ON ac.id = iu.account_id
LEFT JOIN teknisi_capacity tc ON tc.id = tr.teknisi_id;

COMMENT ON VIEW alat_riwayat_v IS
  'F176: satu baris per kejadian per alat (sn_key) dari semua sumber; faskes = faskes SAAT kejadian.';
