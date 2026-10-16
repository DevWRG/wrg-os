-- Diagnostik READ-ONLY F48 PMF Scorecard: seberapa tebal data deal Won/Lost per brand x region.
--
-- Konteks: jawaban Direktur 15 Okt 2026 — F48 boleh MEMBACA deal/crm_account (SELECT saja).
-- Skrip ini menjawab: (a) apakah sel brand x region cukup tebal (n >= 5), (b) seberapa
-- banyak deal terminal yang tanggal tutupnya hanya bisa dari spt_state_log, (c) berapa
-- deal impor (changed_by='import-pameran') yang harus dikeluarkan, (d) apakah
-- crm_account.tipe terisi >= 50% (syarat memasukkan tipe RS ke fase 1).
-- Hanya SELECT. Tak mengubah data.
--
-- Jalankan di Mac mini (akses prod), simpan hasilnya, kirim balik:
--   psql wrg_os_prod -X -f scripts/qa/diag-pmf-data.sql > /tmp/diag-pmf.txt
-- Keluaran HANYA angka agregat: brand dianonimkan (Brand #n menurut jumlah deal), tak ada nama
-- akun/cabang/AM. Aman dibaca peserta magang. Tetap jangan commit hasilnya ke repo (PUBLIC).

\pset null '∅'
\pset pager off

\echo '=== 1. Sebaran stage deal ==='
SELECT stage, count(*) AS n FROM deal GROUP BY 1 ORDER BY 2 DESC;

\echo '=== 2. Deal terminal: tanggal tutup dari log vs fallback, dan deal impor ==='
WITH t AS (
  SELECT d.deal_id, d.stage,
         (SELECT max(l.occurred_at) FROM spt_state_log l
           WHERE l.deal_id = d.deal_id AND l.to_stage = d.stage::text) AS tgl_log,
         EXISTS (SELECT 1 FROM spt_state_log l
                  WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran') AS impor
  FROM deal d WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
)
SELECT stage, count(*) AS total,
       count(*) FILTER (WHERE tgl_log IS NOT NULL) AS punya_log,
       count(*) FILTER (WHERE tgl_log IS NULL) AS tanpa_log_fallback,
       count(*) FILTER (WHERE impor) AS deal_impor,
       count(*) FILTER (WHERE NOT impor) AS non_impor
FROM t GROUP BY 1 ORDER BY 1;

\echo '=== 3. Keterisian dimensi pada deal terminal NON-impor ==='
WITH t AS (
  SELECT d.*, mu.cabang AS cabang_am
  FROM deal d
  LEFT JOIN master_user mu ON mu.am_id = d.am_id::text
  WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
    AND NOT EXISTS (SELECT 1 FROM spt_state_log l
                     WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran')
)
SELECT count(*) AS total,
       count(*) FILTER (WHERE coalesce(btrim(brand), '') <> '') AS brand_terisi,
       count(*) FILTER (WHERE coalesce(btrim(cabang), '') <> '') AS cabang_deal_terisi,
       count(*) FILTER (WHERE coalesce(btrim(cabang), '') = '' AND coalesce(btrim(cabang_am), '') <> '') AS cabang_via_am,
       count(*) FILTER (WHERE coalesce(btrim(cabang), '') = '' AND coalesce(btrim(cabang_am), '') = '') AS tanpa_cabang,
       count(*) FILTER (WHERE account_id IS NOT NULL) AS account_id_terisi,
       count(*) FILTER (WHERE coalesce(btrim(instansi_type), '') <> '') AS instansi_type_terisi
FROM t;

\echo '=== 4. Keterisian crm_account.tipe (syarat tipe RS: >= 50%) ==='
SELECT count(*) AS total_account,
       count(*) FILTER (WHERE coalesce(btrim(tipe), '') <> '') AS tipe_terisi,
       round(100.0 * count(*) FILTER (WHERE coalesce(btrim(tipe), '') <> '') / nullif(count(*), 0), 1) AS persen_terisi
FROM crm_account;

\echo '--- 4b. Dari deal terminal non-impor: berapa yang tipe-nya bisa ditentukan ---'
SELECT count(*) AS deal_terminal,
       count(*) FILTER (WHERE ca.tipe IS NOT NULL AND btrim(ca.tipe) <> '') AS via_crm_account,
       count(*) FILTER (WHERE (ca.tipe IS NULL OR btrim(ca.tipe) = '')
                          AND coalesce(btrim(d.instansi_type), '') <> '') AS via_instansi_type,
       count(*) FILTER (WHERE (ca.tipe IS NULL OR btrim(ca.tipe) = '')
                          AND coalesce(btrim(d.instansi_type), '') = '') AS tidak_diketahui,
       round(100.0 * count(*) FILTER (WHERE (ca.tipe IS NOT NULL AND btrim(ca.tipe) <> '')) / nullif(count(*), 0), 1) AS persen_crm_account
FROM deal d
LEFT JOIN crm_account ca ON ca.account_id = d.account_id
WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
  AND NOT EXISTS (SELECT 1 FROM spt_state_log l
                   WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran');

\echo '=== 5. Sel brand x region (non-impor): Won / Lost / n — brand DIANONIMKAN (Brand #1 = terbanyak deal) ==='
WITH rmap AS (
  SELECT upper(btrim(cabang)) AS cabang,
         CASE hod_key WHEN 'rocky' THEN 'East' WHEN 'yogi' THEN 'West' END AS region
  FROM hod_territory WHERE hod_key IN ('rocky', 'yogi')
), t AS (
  SELECT coalesce(nullif(btrim(d.brand), ''), '(tanpa brand)') AS brand,
         coalesce(r.region, 'Tanpa region') AS region, d.stage
  FROM deal d
  LEFT JOIN master_user mu ON mu.am_id = d.am_id::text
  LEFT JOIN rmap r ON r.cabang = upper(btrim(coalesce(nullif(btrim(d.cabang), ''), mu.cabang)))
  WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
    AND NOT EXISTS (SELECT 1 FROM spt_state_log l
                     WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran')
)
SELECT 'Brand #' || dense_rank() OVER (ORDER BY tb DESC, brand) AS brand_anon, region, won, lost, n, win_rate_pct
FROM (
  SELECT brand, region,
         count(*) FILTER (WHERE stage = 'Closing-Won') AS won,
         count(*) FILTER (WHERE stage = 'Closing-Lost') AS lost,
         count(*) AS n,
         round(100.0 * count(*) FILTER (WHERE stage = 'Closing-Won') / count(*), 0) AS win_rate_pct,
         sum(count(*)) OVER (PARTITION BY brand) AS tb
  FROM t GROUP BY brand, region
) x ORDER BY tb DESC, brand, n DESC LIMIT 40;

\echo '--- 5b. Berapa sel yang lolos ambang n >= 5 ---'
WITH rmap AS (
  SELECT upper(btrim(cabang)) AS cabang,
         CASE hod_key WHEN 'rocky' THEN 'East' WHEN 'yogi' THEN 'West' END AS region
  FROM hod_territory WHERE hod_key IN ('rocky', 'yogi')
), t AS (
  SELECT coalesce(nullif(btrim(d.brand), ''), '(tanpa brand)') AS brand,
         coalesce(r.region, 'Tanpa region') AS region
  FROM deal d
  LEFT JOIN master_user mu ON mu.am_id = d.am_id::text
  LEFT JOIN rmap r ON r.cabang = upper(btrim(coalesce(nullif(btrim(d.cabang), ''), mu.cabang)))
  WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
    AND NOT EXISTS (SELECT 1 FROM spt_state_log l
                     WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran')
), s AS (SELECT brand, region, count(*) AS n FROM t GROUP BY 1, 2)
SELECT count(*) AS total_sel,
       count(*) FILTER (WHERE n >= 5) AS sel_n_ge_5,
       coalesce(sum(n) FILTER (WHERE n >= 5), 0) AS deal_di_sel_tebal,
       coalesce(sum(n), 0) AS deal_total
FROM s;

\echo '=== 6. Lost: alasan (tanpa alasan tampil apa adanya) ==='
SELECT coalesce(loss_reason::text, '(tanpa alasan)') AS alasan, count(*) AS n
FROM deal WHERE stage = 'Closing-Lost' GROUP BY 1 ORDER BY 2 DESC;

\echo '=== 7. Sebaran deal terminal per kuartal (tanggal tutup dari log, non-impor) ==='
SELECT to_char(date_trunc('quarter', tgl), 'YYYY-"Q"Q') AS kuartal, count(*) AS n
FROM (
  SELECT (SELECT max(l.occurred_at) FROM spt_state_log l
           WHERE l.deal_id = d.deal_id AND l.to_stage = d.stage::text) AS tgl
  FROM deal d
  WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
    AND NOT EXISTS (SELECT 1 FROM spt_state_log l
                     WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran')
) x WHERE tgl IS NOT NULL GROUP BY 1 ORDER BY 1;
