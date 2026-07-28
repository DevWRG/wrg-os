-- export-wa-corpus.sql — dump korpus komunikasi grup WhatsApp + agregat siap-analisis
-- (pemetaan jobdesk / SOP / relasi komunikasi antar posisi). Dijalankan lewat
-- scripts/ops/export-wa-corpus.sh (jangan langsung psql -f; butuh :variables).
--
-- Read-only terhadap data produksi: hanya SELECT + TEMP TABLE.
--
-- PENTING: psql harus dijalankan dengan cwd = folder tujuan. Semua \copy pakai
-- nama berkas relatif karena \copy TIDAK menginterpolasi :variabel (perilaku psql).
-- Berkas '_group_subjects.csv' harus sudah ada di cwd (disiapkan wrapper).
--
-- Variabel yang wajib di-set pemanggil (-v):
--   since, until      : batas tanggal (YYYY-MM-DD); until inklusif
--   adj_min           : window menit utk edge adjacency (siapa-balas-siapa)
--   gap_min           : gap menit pemisah sesi/percakapan (kandidat alur SOP)
--   include_dm        : true|false — ikutkan chat 1-on-1 (bukan @g.us)
--   name_mentions     : true|false — deteksi mention berbasis nama panggilan (mahal)
--   mention_min_len   : panjang minimum panggilan yang dianggap mention nama
--   group_pattern     : ILIKE pattern nama/JID grup ('%' = semua)

\set ON_ERROR_STOP on
\timing off

-- ── util: normalisasi nomor WA (port master.ts normalizeWa) ───────────────────
CREATE FUNCTION pg_temp.normwa(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d LIKE '620%' THEN '62' || substr(d, 4)
    WHEN d LIKE '0%'   THEN '62' || substr(d, 2)
    ELSE d
  END
  FROM (SELECT regexp_replace(COALESCE(raw, ''), '[^0-9]', '', 'g') AS d) x;
$$;

CREATE FUNCTION pg_temp.flat(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(COALESCE(t, ''), '[\r\n\t]+', ' ⏎ ', 'g');
$$;

-- ── nama grup: wa_message.group_name SELALU kosong (lihat repo/group-names.ts),
--    subject grup cuma ada di sessions.json openclaw → di-inject dari CSV.
CREATE TEMP TABLE grp_subject (group_jid text PRIMARY KEY, subject text);
\copy grp_subject FROM '_group_subjects.csv' WITH (FORMAT csv, HEADER true)

-- ── 1. korpus dasar ──────────────────────────────────────────────────────────
CREATE TEMP TABLE msg AS
SELECT
  m.id                                            AS msg_id,
  m.received_at                                   AS ts_utc,
  (m.received_at AT TIME ZONE 'Asia/Jakarta')     AS ts_wib,
  m.group_jid,
  COALESCE(NULLIF(gs.subject, ''), NULLIF(m.group_name, ''), m.group_jid) AS group_name,
  (m.group_jid NOT LIKE '%@g.us')                 AS is_dm,
  COALESCE(m.sender_jid, '')                      AS sender_jid,
  COALESCE(m.sender_name, '')                     AS pushname,
  COALESCE(NULLIF(m.message_type, ''), 'text')    AS message_type,
  m.body,
  m.media_path,
  m.geo_lat, m.geo_lon, m.geo_address
FROM wa_message m
LEFT JOIN grp_subject gs ON gs.group_jid = m.group_jid
WHERE m.received_at >= (:'since')::date::timestamptz
  AND m.received_at <  ((:'until')::date + 1)::timestamptz
  AND (:include_dm OR m.group_jid LIKE '%@g.us')
  AND (
    COALESCE(NULLIF(gs.subject, ''), m.group_jid) ILIKE :'group_pattern'
    OR m.group_jid ILIKE :'group_pattern'
  );

CREATE INDEX ON msg (group_jid, ts_wib);

-- ── 2. resolusi pengirim ─────────────────────────────────────────────────────
-- JEBAKAN: untuk pesan grup, wa_message.sender_jid = group_jid (openclaw mengisi
-- inbound.from = JID chat, bukan JID peserta). Jadi identitas per-orang praktis
-- bergantung pada pushname + tabel sender_alias. Urutan tier mengikuti
-- repo/master.ts resolveSender: alias → phone → pushname (6 sub-strategi).
CREATE TEMP TABLE sender_key AS
SELECT DISTINCT group_jid, pushname, sender_jid FROM msg;

CREATE TEMP TABLE sender_res AS
WITH base AS (
  SELECT s.*,
         pg_temp.normwa(split_part(split_part(s.sender_jid, '@', 1), ':', 1)) AS wa_norm,
         (s.sender_jid LIKE '%@s.whatsapp.net'
          OR length(pg_temp.normwa(split_part(split_part(s.sender_jid, '@', 1), ':', 1))) BETWEEN 1 AND 14
         ) AS is_individual
  FROM sender_key s
)
SELECT
  b.group_jid, b.pushname, b.sender_jid,
  COALESCE(a.am_id, p.am_id, n.am_id)                       AS am_id,
  CASE WHEN a.am_id IS NOT NULL THEN 'alias'
       WHEN p.am_id IS NOT NULL THEN 'phone'
       WHEN n.am_id IS NOT NULL THEN 'pushname'
       ELSE 'unknown' END                                   AS resolve_via
FROM base b
-- tier A' — alias manual (group_jid, pushname) → am_id
LEFT JOIN LATERAL (
  SELECT mu.am_id FROM sender_alias sa
  JOIN master_user mu ON mu.am_id = sa.am_id
  WHERE sa.group_jid = b.group_jid AND lower(sa.pushname) = lower(b.pushname)
  LIMIT 1
) a ON b.pushname <> ''
-- tier B — nomor pengirim (hanya bila JID individual)
LEFT JOIN LATERAL (
  SELECT mu.am_id FROM master_user mu
  WHERE regexp_replace(COALESCE(mu.wa_number, ''), '[^0-9]', '', 'g') = b.wa_norm
  LIMIT 1
) p ON a.am_id IS NULL AND b.is_individual AND b.wa_norm <> ''
-- tier C — pushname (port resolveAmByPushname)
LEFT JOIN LATERAL (
  WITH q AS (SELECT regexp_replace(lower(b.pushname), '[^a-z]', '', 'g') AS norm)
  SELECT mu.am_id FROM master_user mu, q
  WHERE lower(mu.nama) = lower(b.pushname)
     OR lower(mu.panggilan) = lower(b.pushname)
     OR lower(mu.nama) LIKE lower(b.pushname) || ' %'
     OR lower(mu.panggilan) = lower(split_part(b.pushname, ' ', 1))
     OR lower(mu.panggilan) = lower(regexp_replace(b.pushname, '[-_|/[:space:]].*$', ''))
     OR (length(q.norm) >= 5 AND regexp_replace(lower(mu.nama), '[^a-z]', '', 'g') LIKE q.norm || '%')
     OR (length(q.norm) >= 5 AND q.norm LIKE regexp_replace(lower(mu.nama), '[^a-z]', '', 'g') || '%')
  ORDER BY CASE
      WHEN lower(mu.nama) = lower(b.pushname) THEN 1
      WHEN lower(mu.panggilan) = lower(b.pushname) THEN 2
      WHEN lower(mu.nama) LIKE lower(b.pushname) || ' %' THEN 3
      WHEN lower(mu.panggilan) = lower(split_part(b.pushname, ' ', 1)) THEN 4
      WHEN lower(mu.panggilan) = lower(regexp_replace(b.pushname, '[-_|/[:space:]].*$', '')) THEN 5
      ELSE 6 END, length(mu.nama)
  LIMIT 1
) n ON a.am_id IS NULL AND p.am_id IS NULL AND b.pushname <> '';

CREATE INDEX ON sender_res (group_jid, pushname, sender_jid);

-- spine karyawan (migrasi 052/053) opsional — dipakai kalau tabelnya ada.
SELECT (to_regclass('public.employee') IS NOT NULL)::text AS has_spine \gset

\if :has_spine
CREATE TEMP TABLE spine AS
SELECT DISTINCT ON (am_id)
       am_id, id AS employee_id, dept, role AS spine_role, atasan_raw, hod_key, lokasi, okr_objective
FROM employee WHERE am_id IS NOT NULL AND am_id <> ''
ORDER BY am_id, id;
\else
CREATE TEMP TABLE spine (am_id text, employee_id text, dept text, spine_role text,
                         atasan_raw text, hod_key text, lokasi text, okr_objective text);
\endif

-- ── 3. korpus ter-enrich (basis semua agregat) ───────────────────────────────
CREATE TEMP TABLE msg_x AS
SELECT
  m.*,
  r.am_id,
  r.resolve_via,
  -- pengirim tak ter-resolve tetap jadi aktor tersendiri supaya graf tak bolong
  COALESCE(r.am_id, 'unknown:' || NULLIF(m.pushname, ''), 'unknown:' || m.group_jid) AS person_key,
  COALESCE(mu.nama, NULLIF(m.pushname, ''), '(tanpa nama)')                          AS person_label,
  mu.panggilan, mu.role AS am_role, mu.posisi, mu.cabang, mu.area, mu.aktif,
  sp.dept, sp.spine_role, sp.atasan_raw, sp.hod_key, sp.employee_id,
  au.title AS app_title,
  COALESCE(NULLIF(mu.posisi, ''), NULLIF(sp.spine_role, ''), NULLIF(mu.role, ''), 'TIDAK DIKENAL') AS position_key,
  COALESCE(NULLIF(sp.dept, ''), 'TIDAK DIKENAL')                                     AS dept_key,
  (m.message_type <> 'text')                                                         AS is_media,
  (m.geo_lat IS NOT NULL)                                                            AS has_geo,
  length(COALESCE(m.body, ''))                                                       AS body_chars,
  array_length(regexp_split_to_array(COALESCE(m.body, ''), '\s+'), 1)                AS body_words,
  (array_length(string_to_array(COALESCE(m.body, ''), E'\n'), 1))                     AS body_lines,
  lower(COALESCE(substring(COALESCE(m.body, '') FROM '^\s*#([A-Za-z]+)'), ''))        AS hashtag
FROM msg m
JOIN sender_res r
  ON r.group_jid = m.group_jid AND r.pushname = m.pushname AND r.sender_jid = m.sender_jid
LEFT JOIN master_user mu ON mu.am_id = r.am_id
LEFT JOIN spine sp       ON sp.am_id = r.am_id
LEFT JOIN LATERAL (
  SELECT title FROM app_user WHERE am_id = r.am_id ORDER BY active DESC, created_at LIMIT 1
) au ON true;

CREATE INDEX ON msg_x (group_jid, ts_wib, msg_id);
CREATE INDEX ON msg_x (person_key);
ANALYZE msg_x;

-- ═════════════════════════ OUTPUT 01 — korpus pesan ═════════════════════════
CREATE TEMP TABLE o01_messages AS
SELECT
  msg_id, ts_utc, ts_wib,
  ts_wib::date                                                                  AS tanggal,
  to_char(ts_wib, 'HH24:MI')                                                    AS jam,
  extract(hour FROM ts_wib)::int                                                AS jam_num,
  (ARRAY['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])[extract(dow FROM ts_wib)::int + 1] AS hari,
  to_char(ts_wib, 'IYYY-"W"IW')                                                 AS minggu_iso,
  to_char(ts_wib, 'YYYY-MM')                                                    AS bulan,
  group_jid, group_name, is_dm,
  person_key, person_label, pushname, am_id, resolve_via,
  position_key, dept_key, am_role, posisi, spine_role, app_title,
  cabang, area, atasan_raw, aktif,
  message_type, is_media, has_geo, geo_address, media_path,
  hashtag, body_chars, body_words, body_lines,
  body
FROM msg_x
ORDER BY group_name, ts_wib, msg_id;

\copy o01_messages TO '01_messages.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 02 — roster + aktivitas ═══════════════════
CREATE TEMP TABLE o02_roster AS
WITH act AS (
  SELECT person_key, am_id,
         count(*)                                   AS total_pesan,
         count(DISTINCT group_jid)                  AS jumlah_grup,
         count(DISTINCT ts_wib::date)               AS hari_aktif,
         min(ts_wib)                                AS pesan_pertama,
         max(ts_wib)                                AS pesan_terakhir,
         round(avg(body_chars))                     AS rata_panjang_pesan,
         count(*) FILTER (WHERE is_media)           AS pesan_media,
         count(*) FILTER (WHERE hashtag <> '')      AS pesan_hashtag,
         round(avg(extract(hour FROM ts_wib))::numeric, 1) AS rata_jam_kirim,
         string_agg(DISTINCT group_name, ' | ')     AS daftar_grup
  FROM msg_x GROUP BY person_key, am_id
)
SELECT
  COALESCE(a.person_key, 'am:' || mu.am_id)                       AS person_key,
  mu.am_id, mu.nama, mu.panggilan, mu.role AS am_role, mu.posisi,
  sp.dept, sp.spine_role, sp.atasan_raw, sp.hod_key, sp.okr_objective,
  au.title AS app_title, au.email AS app_email,
  mu.cabang, mu.area, mu.aktif, mu.wa_number IS NOT NULL AS punya_nomor,
  COALESCE(a.total_pesan, 0)   AS total_pesan,
  COALESCE(a.jumlah_grup, 0)   AS jumlah_grup,
  COALESCE(a.hari_aktif, 0)    AS hari_aktif,
  a.pesan_pertama, a.pesan_terakhir,
  a.rata_panjang_pesan, a.pesan_media, a.pesan_hashtag, a.rata_jam_kirim,
  a.daftar_grup,
  CASE WHEN a.total_pesan IS NULL THEN 'TIDAK TERDETEKSI di korpus' ELSE 'aktif di korpus' END AS status_korpus
FROM master_user mu
LEFT JOIN act a          ON a.am_id = mu.am_id
LEFT JOIN spine sp       ON sp.am_id = mu.am_id
LEFT JOIN LATERAL (SELECT title, email FROM app_user WHERE am_id = mu.am_id ORDER BY active DESC LIMIT 1) au ON true
UNION ALL
-- aktor yang tak ter-resolve ke roster (pushname asing / peserta luar)
SELECT a.person_key, NULL, replace(a.person_key, 'unknown:', ''), NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false,
       a.total_pesan, a.jumlah_grup, a.hari_aktif, a.pesan_pertama, a.pesan_terakhir,
       a.rata_panjang_pesan, a.pesan_media, a.pesan_hashtag, a.rata_jam_kirim, a.daftar_grup,
       'TIDAK TER-RESOLVE ke master_user'
FROM act a WHERE a.am_id IS NULL
ORDER BY total_pesan DESC NULLS LAST;

\copy o02_roster TO '02_roster.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 03 — direktori grup ═══════════════════════
CREATE TEMP TABLE o03_groups AS
SELECT
  group_jid, group_name, bool_or(is_dm) AS is_dm,
  count(*)                                              AS total_pesan,
  count(DISTINCT person_key)                            AS jumlah_aktor,
  count(DISTINCT am_id)                                 AS aktor_ter_resolve,
  round(100.0 * count(*) FILTER (WHERE am_id IS NOT NULL) / count(*), 1) AS persen_ter_resolve,
  count(DISTINCT position_key)                          AS jumlah_posisi,
  count(DISTINCT dept_key)                              AS jumlah_dept,
  min(ts_wib)                                           AS pesan_pertama,
  max(ts_wib)                                           AS pesan_terakhir,
  count(DISTINCT ts_wib::date)                          AS hari_aktif,
  round(count(*)::numeric / GREATEST(count(DISTINCT ts_wib::date), 1), 1) AS pesan_per_hari_aktif,
  count(*) FILTER (WHERE is_media)                      AS pesan_media,
  count(*) FILTER (WHERE hashtag <> '')                 AS pesan_hashtag,
  mode() WITHIN GROUP (ORDER BY extract(hour FROM ts_wib)) AS jam_tersibuk,
  (SELECT string_agg(x.lbl, ' | ') FROM (
      SELECT person_label || ' (' || cnt || ')' AS lbl
      FROM (SELECT person_label, count(*) cnt FROM msg_x i
            WHERE i.group_jid = m.group_jid GROUP BY person_label
            ORDER BY count(*) DESC LIMIT 5) t) x)   AS aktor_teratas,
  (SELECT string_agg(x.lbl, ' | ') FROM (
      SELECT position_key || ' (' || cnt || ')' AS lbl
      FROM (SELECT position_key, count(*) cnt FROM msg_x i
            WHERE i.group_jid = m.group_jid GROUP BY position_key
            ORDER BY count(*) DESC LIMIT 5) t) x)   AS posisi_teratas
FROM msg_x m
GROUP BY group_jid, group_name
ORDER BY total_pesan DESC;

\copy o03_groups TO '03_groups.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 04 — partisipasi grup × orang ═════════════
CREATE TEMP TABLE o04_participation AS
SELECT
  m.group_jid, m.group_name, m.person_key, m.person_label, m.am_id,
  m.position_key, m.dept_key, m.cabang,
  count(*)                                          AS pesan,
  round(100.0 * count(*) / g.total, 2)              AS persen_dari_grup,
  rank() OVER (PARTITION BY m.group_jid ORDER BY count(*) DESC) AS peringkat_di_grup,
  count(DISTINCT m.ts_wib::date)                    AS hari_aktif,
  min(m.ts_wib)                                     AS pertama,
  max(m.ts_wib)                                     AS terakhir,
  round(avg(m.body_chars))                          AS rata_panjang,
  count(*) FILTER (WHERE m.is_media)                AS media,
  count(*) FILTER (WHERE m.hashtag <> '')           AS pakai_hashtag,
  mode() WITHIN GROUP (ORDER BY extract(hour FROM m.ts_wib)) AS jam_favorit
FROM msg_x m
JOIN (SELECT group_jid, count(*) AS total FROM msg_x GROUP BY group_jid) g USING (group_jid)
GROUP BY m.group_jid, m.group_name, m.person_key, m.person_label, m.am_id,
         m.position_key, m.dept_key, m.cabang, g.total
ORDER BY m.group_name, pesan DESC;

\copy o04_participation TO '04_participation.csv' WITH (FORMAT csv, HEADER true)

-- ── kamus topik (dipakai output 06c, 09, 11) ────────────────────────────────
-- Bucket kata kunci = proksi "apa yang orang ini benar-benar kerjakan di WA".
-- EDIT daftar di bawah kalau kosakata tim berubah.
CREATE TEMP TABLE topik (topik text, pola text);
INSERT INTO topik VALUES
  ('order/PO',        '\m(po|order|pesan(an)?|so|sales ?order|orderan)\M'),
  ('penawaran/harga', '\m(harga|quotation|penawaran|diskon|nego|pricelist|price)\M'),
  ('pengiriman',      '\m(kirim(an)?|dikirim|ekspedisi|do|delivery|resi|kurir|surat jalan|sj)\M'),
  ('stok/gudang',     '\m(stok|stock|gudang|kosong|ready|sisa|opname|inden)\M'),
  ('invoice/AR',      '\m(invoice|inv|faktur|tagihan|bayar|pembayaran|lunas|tempo|piutang|ar|tt|tanda terima)\M'),
  ('tender',          '\m(tender|lelang|lpse|e-?katalog|katalog|rup|hps)\M'),
  ('teknis/service',  '\m(service|servis|kalibrasi|instal(asi)?|training|rusak|error|maintenance|troubleshoot)\M'),
  ('komplain',        '\m(komplain|keluhan|complain|retur|klaim|masalah|kendala)\M'),
  ('kunjungan',       '\m(visit|kunjung(an)?|plan|report|jv|join visit|silaturahmi)\M'),
  ('dokumen/admin',   '\m(dokumen|berkas|surat|ttd|tanda tangan|scan|softcopy|hardcopy|form|npwp|spk|kontrak|mou)\M'),
  ('koordinasi/rapat','\m(meeting|rapat|zoom|koordinasi|jadwal|agenda|notulen|briefing)\M'),
  ('izin/absen',      '\m(izin|ijin|cuti|sakit|telat|off|libur|wfh|absen)\M'),
  ('eskalasi/urgent', '\m(urgent|segera|asap|penting|tolong dibantu|mohon dibantu|follow ?up|fu)\M'),
  ('SDM/rekrutmen',   '\m(rekrut|kandidat|interview|karyawan baru|onboarding|resign|training internal)\M'),
  ('produk/alkes',    '\m(reagen|alat|unit|mesin|consumable|spare ?part|sparepart|barang)\M');

-- ═════════════════════════ OUTPUT 05 — edge orang → orang ═══════════════════
-- Proksi "siapa merespons siapa": pesan berurutan dalam grup yang sama dengan
-- jeda <= :adj_min menit dan pengirim berbeda. WA tidak menyimpan quoted-reply
-- di wa_message, jadi adjacency adalah proksi terbaik yang tersedia.
CREATE TEMP TABLE adj AS
WITH seq AS (
  SELECT group_jid, group_name, ts_wib, msg_id,
         person_key, person_label, position_key, dept_key,
         LAG(person_key)    OVER w AS prev_key,
         LAG(person_label)  OVER w AS prev_label,
         LAG(position_key)  OVER w AS prev_position,
         LAG(dept_key)      OVER w AS prev_dept,
         LAG(ts_wib)        OVER w AS prev_ts
  FROM msg_x
  WINDOW w AS (PARTITION BY group_jid ORDER BY ts_wib, msg_id)
)
SELECT * , extract(epoch FROM (ts_wib - prev_ts))::int AS jeda_detik
FROM seq
WHERE prev_key IS NOT NULL
  AND prev_key <> person_key
  AND ts_wib - prev_ts <= ((:'adj_min') || ' minutes')::interval;

CREATE TEMP TABLE o05_edges_orang AS
SELECT
  group_jid, group_name,
  prev_key AS dari_key, prev_label AS dari_orang, prev_position AS dari_posisi, prev_dept AS dari_dept,
  person_key AS ke_key, person_label AS ke_orang, position_key AS ke_posisi, dept_key AS ke_dept,
  count(*)                                        AS bobot,
  round(avg(jeda_detik))                          AS rata_jeda_detik,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY jeda_detik) AS median_jeda_detik,
  min(ts_wib)                                     AS pertama,
  max(ts_wib)                                     AS terakhir,
  count(DISTINCT ts_wib::date)                    AS hari_terjadi
FROM adj
GROUP BY 1,2,3,4,5,6,7,8,9,10
ORDER BY bobot DESC;

\copy o05_edges_orang TO '05_edges_orang.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 06 — matriks posisi ↔ posisi ══════════════
-- Format long (dari_posisi, ke_posisi, bobot) — pivot di spreadsheet kalau butuh
-- matriks lebar. reciprocity = seberapa dua-arah relasinya (0..1).
CREATE TEMP TABLE pos_edge AS
SELECT prev_position AS dari_posisi, position_key AS ke_posisi,
       count(*) AS bobot,
       count(DISTINCT group_jid) AS jumlah_grup,
       count(DISTINCT prev_key)  AS jumlah_orang_dari,
       count(DISTINCT person_key) AS jumlah_orang_ke,
       count(DISTINCT ts_wib::date) AS hari_terjadi,
       mode() WITHIN GROUP (ORDER BY extract(hour FROM ts_wib)) AS jam_dominan,
       mode() WITHIN GROUP (ORDER BY
         (ARRAY['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])[extract(dow FROM ts_wib)::int + 1]
       ) AS hari_dominan,
       string_agg(DISTINCT group_name, ' | ') AS grup
FROM adj GROUP BY 1,2;

CREATE TEMP TABLE o06_matriks_posisi AS
SELECT e.dari_posisi, e.ke_posisi, e.bobot,
       COALESCE(r.bobot, 0) AS bobot_arah_balik,
       round(100.0 * e.bobot / SUM(e.bobot) OVER (PARTITION BY e.dari_posisi), 1) AS persen_dari_total_keluar,
       round(LEAST(e.bobot, COALESCE(r.bobot, 0))::numeric
             / GREATEST(e.bobot, COALESCE(r.bobot, 0)), 2) AS resiprositas,
       e.jumlah_grup, e.jumlah_orang_dari, e.jumlah_orang_ke,
       e.hari_terjadi, e.jam_dominan, e.hari_dominan, e.grup
FROM pos_edge e
LEFT JOIN pos_edge r ON r.dari_posisi = e.ke_posisi AND r.ke_posisi = e.dari_posisi
ORDER BY e.bobot DESC;

\copy o06_matriks_posisi TO '06_matriks_posisi.csv' WITH (FORMAT csv, HEADER true)

-- matriks per departemen (agregat lebih tinggi)
CREATE TEMP TABLE o06b_matriks_dept AS
WITH d AS (
  SELECT prev_dept AS dari_dept, dept_key AS ke_dept, count(*) AS bobot,
         count(DISTINCT group_jid) AS jumlah_grup
  FROM adj GROUP BY 1,2
)
SELECT d.dari_dept, d.ke_dept, d.bobot, COALESCE(r.bobot, 0) AS bobot_arah_balik,
       round(100.0 * d.bobot / SUM(d.bobot) OVER (PARTITION BY d.dari_dept), 1) AS persen_dari_total_keluar,
       d.jumlah_grup
FROM d LEFT JOIN d r ON r.dari_dept = d.ke_dept AND r.ke_dept = d.dari_dept
ORDER BY d.bobot DESC;

\copy o06b_matriks_dept TO '06b_matriks_dept.csv' WITH (FORMAT csv, HEADER true)

-- topik yang dibicarakan tiap pasangan posisi → kolom "Yang Dikoordinasikan"
CREATE TEMP TABLE o06c_topik_pasangan AS
WITH p AS (
  SELECT a.prev_position AS dari_posisi, a.position_key AS ke_posisi,
         a.group_name, a.ts_wib, m.body
  FROM adj a JOIN msg_x m ON m.msg_id = a.msg_id
  WHERE m.body IS NOT NULL
)
SELECT p.dari_posisi, p.ke_posisi, t.topik,
       count(*)                       AS bobot,
       count(DISTINCT p.ts_wib::date) AS hari,
       string_agg(DISTINCT p.group_name, ' | ') AS grup,
       mode() WITHIN GROUP (ORDER BY extract(hour FROM p.ts_wib)) AS jam_dominan,
       mode() WITHIN GROUP (ORDER BY
         (ARRAY['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])[extract(dow FROM p.ts_wib)::int + 1]
       ) AS hari_dominan,
       rank() OVER (PARTITION BY p.dari_posisi, p.ke_posisi ORDER BY count(*) DESC) AS peringkat,
       left(pg_temp.flat((array_agg(p.body ORDER BY length(p.body) DESC))[1]), 240) AS contoh_pesan
FROM p JOIN topik t ON p.body ~* t.pola
GROUP BY 1,2,3
ORDER BY p.dari_posisi, p.ke_posisi, bobot DESC;

\copy o06c_topik_pasangan TO '06c_topik_pasangan_posisi.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 07 — mention (penyebutan) ═════════════════
-- Sinyal relasi yang lebih tegas daripada adjacency: A menyebut B eksplisit.
--   (a) mention WA "@62xxx"  → cocokkan ke master_user.wa_number
--   (b) nama panggilan / nama depan sebagai kata utuh (opsional, :name_mentions)
CREATE TEMP TABLE mention AS
SELECT m.msg_id, m.group_jid, m.group_name, m.ts_wib,
       m.person_key AS dari_key, m.person_label AS dari_orang, m.position_key AS dari_posisi,
       mu.am_id AS ke_am, mu.nama AS ke_orang,
       COALESCE(NULLIF(mu.posisi, ''), mu.role, 'TIDAK DIKENAL') AS ke_posisi,
       'nomor'::text AS jenis
FROM msg_x m
CROSS JOIN LATERAL regexp_matches(COALESCE(m.body, ''), '@([0-9]{8,16})', 'g') AS g(dig)
JOIN master_user mu
  ON regexp_replace(COALESCE(mu.wa_number, ''), '[^0-9]', '', 'g') = pg_temp.normwa(g.dig[1])
WHERE m.body IS NOT NULL;

\if :name_mentions
INSERT INTO mention
SELECT m.msg_id, m.group_jid, m.group_name, m.ts_wib,
       m.person_key, m.person_label, m.position_key,
       mu.am_id, mu.nama,
       COALESCE(NULLIF(mu.posisi, ''), mu.role, 'TIDAK DIKENAL'),
       'nama'
FROM msg_x m
JOIN master_user mu
  ON mu.aktif
 AND mu.am_id IS DISTINCT FROM m.am_id
 AND COALESCE(NULLIF(mu.panggilan, ''), split_part(mu.nama, ' ', 1)) ~ '^[A-Za-z][A-Za-z ]+$'
 AND length(COALESCE(NULLIF(mu.panggilan, ''), split_part(mu.nama, ' ', 1))) >= (:'mention_min_len')::int
 AND m.body ~* ('\m' || COALESCE(NULLIF(mu.panggilan, ''), split_part(mu.nama, ' ', 1)) || '\M')
WHERE m.body IS NOT NULL AND m.body_chars BETWEEN 1 AND 4000;
\endif

CREATE TEMP TABLE o07_mentions AS
SELECT group_jid, group_name, dari_key, dari_orang, dari_posisi,
       ke_am, ke_orang, ke_posisi, jenis,
       count(*) AS bobot,
       count(DISTINCT ts_wib::date) AS hari_terjadi,
       min(ts_wib) AS pertama, max(ts_wib) AS terakhir
FROM mention
GROUP BY 1,2,3,4,5,6,7,8,9
ORDER BY bobot DESC;

\copy o07_mentions TO '07_mentions.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 08 — ritme waktu ══════════════════════════
CREATE TEMP TABLE o08_ritme AS
SELECT 'jam'::text AS dimensi, lpad(extract(hour FROM ts_wib)::text, 2, '0') AS bucket,
       person_key, person_label, position_key, dept_key, count(*) AS pesan
FROM msg_x GROUP BY 2,3,4,5,6
UNION ALL
SELECT 'hari',
       extract(dow FROM ts_wib)::text || '-' ||
       (ARRAY['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])[extract(dow FROM ts_wib)::int + 1],
       person_key, person_label, position_key, dept_key, count(*)
FROM msg_x GROUP BY 2,3,4,5,6
UNION ALL
SELECT 'bulan', to_char(ts_wib, 'YYYY-MM'),
       person_key, person_label, position_key, dept_key, count(*)
FROM msg_x GROUP BY 2,3,4,5,6
ORDER BY 1, 2, 7 DESC;

\copy o08_ritme TO '08_ritme_waktu.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 09 — sinyal topik (jobdesk aktual) ════════
CREATE TEMP TABLE o09_sinyal_topik AS
WITH hit AS (
  SELECT m.person_key, m.person_label, m.am_id, m.position_key, m.dept_key, t.topik,
         count(*) AS pesan, count(DISTINCT m.group_jid) AS grup,
         count(DISTINCT m.ts_wib::date) AS hari
  FROM msg_x m JOIN topik t ON m.body ~* t.pola
  WHERE m.body IS NOT NULL
  GROUP BY 1,2,3,4,5,6
), tot AS (
  SELECT person_key, sum(pesan) AS total_hit FROM hit GROUP BY 1
)
SELECT h.person_key, h.person_label, h.am_id, h.position_key, h.dept_key, h.topik,
       h.pesan, h.grup, h.hari,
       round(100.0 * h.pesan / t.total_hit, 1) AS persen_dari_topik_orang,
       rank() OVER (PARTITION BY h.person_key ORDER BY h.pesan DESC) AS peringkat_topik_orang
FROM hit h JOIN tot t USING (person_key)
ORDER BY h.person_label, h.pesan DESC;

\copy o09_sinyal_topik TO '09_sinyal_topik.csv' WITH (FORMAT csv, HEADER true)

-- sinyal topik per posisi (untuk dibandingkan dengan jobdesk formal)
CREATE TEMP TABLE o09b_topik_posisi AS
WITH hit AS (
  SELECT m.position_key, t.topik,
         string_agg(DISTINCT m.dept_key, ' | ')                          AS dept,
         count(*)                          AS pesan,
         count(DISTINCT m.person_key)      AS orang,
         count(DISTINCT m.ts_wib::date)    AS hari,
         count(DISTINCT m.group_jid)       AS grup,
         string_agg(DISTINCT m.group_name, ' | ')                       AS daftar_grup,
         mode() WITHIN GROUP (ORDER BY extract(hour FROM m.ts_wib))     AS jam_dominan,
         mode() WITHIN GROUP (ORDER BY
           (ARRAY['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'])[extract(dow FROM m.ts_wib)::int + 1]
         )                                                             AS hari_dominan,
         left(pg_temp.flat((array_agg(m.body ORDER BY length(m.body) DESC))[1]), 240) AS contoh_pesan
  FROM msg_x m JOIN topik t ON m.body ~* t.pola
  WHERE m.body IS NOT NULL GROUP BY 1,2
)
SELECT position_key, dept, topik, pesan, orang, hari, grup, daftar_grup,
       jam_dominan, hari_dominan,
       round(100.0 * pesan / SUM(pesan) OVER (PARTITION BY position_key), 1) AS persen_dari_posisi,
       rank() OVER (PARTITION BY position_key ORDER BY pesan DESC) AS peringkat,
       contoh_pesan
FROM hit ORDER BY position_key, pesan DESC;

\copy o09b_topik_posisi TO '09b_topik_posisi.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 10 — jobdesk & SOP formal ═════════════════
\if :has_spine
CREATE TEMP TABLE o10_jobdesk_formal AS
SELECT e.id AS employee_id, e.nama, e.panggilan, e.am_id, e.dept, e.role, e.atasan_raw,
       e.hod_key, e.cabang, e.lokasi, e.okr_objective,
       (SELECT string_agg(task, ' • ' ORDER BY seq) FROM employee_task WHERE employee_id = e.id) AS tugas,
       (SELECT string_agg(tool, ' • ' ORDER BY seq) FROM employee_tool WHERE employee_id = e.id) AS tools,
       (SELECT string_agg(role_type || ':' || process, ' • ' ORDER BY seq)
          FROM raci_assignment WHERE employee_id = e.id)                                        AS raci,
       (SELECT string_agg(name || COALESCE(' (target ' || target || ')', ''), ' • ' ORDER BY seq)
          FROM kpi WHERE employee_id = e.id)                                                    AS kpi,
       (SELECT string_agg('P:' || COALESCE(plan_step,'') || ' D:' || COALESCE(do_step,'')
                          || ' C:' || COALESCE(check_step,'') || ' A:' || COALESCE(act_step,''), ' • ' ORDER BY seq)
          FROM pdca_cycle WHERE employee_id = e.id)                                             AS pdca,
       (SELECT string_agg(kind || ': ' || content, ' • ' ORDER BY seq)
          FROM voice_item WHERE employee_id = e.id)                                             AS voice
FROM employee e
ORDER BY e.dept NULLS LAST, e.nama;

\copy o10_jobdesk_formal TO '10_jobdesk_formal.csv' WITH (FORMAT csv, HEADER true)

-- proses RACI × posisi → siapa yang seharusnya bicara soal proses apa
CREATE TEMP TABLE o10b_raci_proses AS
SELECT ra.process AS proses, ra.role_type AS peran_raci,
       count(DISTINCT ra.employee_id) AS jumlah_orang,
       string_agg(DISTINCT COALESCE(e.dept, '?'), ' | ')  AS dept_terlibat,
       string_agg(DISTINCT e.nama, ' | ')                  AS orang
FROM raci_assignment ra JOIN employee e ON e.id = ra.employee_id
GROUP BY 1,2 ORDER BY 1,2;

\copy o10b_raci_proses TO '10b_raci_proses.csv' WITH (FORMAT csv, HEADER true)
\endif

-- ═════════════════════════ OUTPUT 11 — sesi percakapan (kandidat SOP) ═══════
-- Satu sesi = rentetan pesan dalam satu grup dengan jeda antar pesan <= :gap_min.
-- Urutan aktor + posisi di kolom `alur_*` = kandidat alur kerja/SOP nyata.
CREATE TEMP TABLE sess AS
WITH marked AS (
  SELECT msg_id, group_jid, group_name, ts_wib, person_key, person_label,
         position_key, dept_key, body, body_chars, is_media, hashtag,
         CASE WHEN LAG(ts_wib) OVER w IS NULL
                OR ts_wib - LAG(ts_wib) OVER w > ((:'gap_min') || ' minutes')::interval
              THEN 1 ELSE 0 END AS mulai_baru
  FROM msg_x
  WINDOW w AS (PARTITION BY group_jid ORDER BY ts_wib, msg_id)
), numbered AS (
  SELECT *, SUM(mulai_baru) OVER (PARTITION BY group_jid ORDER BY ts_wib, msg_id) AS sesi
  FROM marked
)
SELECT *,
       (person_key IS DISTINCT FROM LAG(person_key) OVER (PARTITION BY group_jid, sesi ORDER BY ts_wib, msg_id)) AS ganti_aktor,
       (position_key IS DISTINCT FROM LAG(position_key) OVER (PARTITION BY group_jid, sesi ORDER BY ts_wib, msg_id)) AS ganti_posisi
FROM numbered;

-- topik dominan per sesi → nama kandidat SOP di sheet "B. Bedah SOP"
CREATE TEMP TABLE sesi_topik AS
SELECT s.group_jid, s.sesi, t.topik, count(*) AS n
FROM sess s JOIN topik t ON s.body ~* t.pola
WHERE s.body IS NOT NULL
GROUP BY 1, 2, 3;

CREATE INDEX ON sesi_topik (group_jid, sesi);

CREATE TEMP TABLE o11_sesi AS
SELECT
  group_jid, group_name, sesi AS sesi_no,
  (SELECT st.topik FROM sesi_topik st
    WHERE st.group_jid = sess.group_jid AND st.sesi = sess.sesi
    ORDER BY st.n DESC, st.topik LIMIT 1)           AS topik_dominan,
  min(ts_wib)                                       AS mulai,
  max(ts_wib)                                       AS selesai,
  extract(epoch FROM (max(ts_wib) - min(ts_wib)))::int / 60 AS durasi_menit,
  count(*)                                          AS jumlah_pesan,
  count(DISTINCT person_key)                        AS jumlah_aktor,
  count(DISTINCT position_key)                      AS jumlah_posisi,
  (array_agg(person_label ORDER BY ts_wib, msg_id))[1]  AS pembuka,
  (array_agg(position_key ORDER BY ts_wib, msg_id))[1]  AS posisi_pembuka,
  (array_agg(person_label ORDER BY ts_wib DESC, msg_id DESC))[1] AS penutup,
  string_agg(person_label, ' → ' ORDER BY ts_wib, msg_id) FILTER (WHERE ganti_aktor)   AS alur_orang,
  string_agg(position_key, ' → ' ORDER BY ts_wib, msg_id) FILTER (WHERE ganti_posisi)  AS alur_posisi,
  string_agg(DISTINCT NULLIF(hashtag, ''), ' | ')   AS hashtag,
  count(*) FILTER (WHERE is_media)                  AS pesan_media,
  left(pg_temp.flat((array_agg(body ORDER BY ts_wib, msg_id))[1]), 400) AS pesan_pembuka
FROM sess
GROUP BY group_jid, group_name, sesi
HAVING count(*) >= 2
ORDER BY group_name, mulai;

\copy o11_sesi TO '11_sesi_percakapan.csv' WITH (FORMAT csv, HEADER true)

-- pola alur posisi yang berulang → kandidat SOP de-facto
CREATE TEMP TABLE o11b_pola_alur AS
SELECT alur_posisi,
       mode() WITHIN GROUP (ORDER BY COALESCE(topik_dominan, '(tanpa topik)')) AS topik_dominan,
       count(*) AS frekuensi,
       count(DISTINCT group_jid) AS jumlah_grup,
       string_agg(DISTINCT group_name, ' | ') AS grup,
       round(avg(jumlah_pesan), 1) AS rata_pesan,
       round(avg(durasi_menit), 1) AS rata_durasi_menit,
       min(mulai) AS pertama, max(mulai) AS terakhir
FROM o11_sesi
WHERE alur_posisi IS NOT NULL AND alur_posisi LIKE '%→%'
GROUP BY alur_posisi
HAVING count(*) >= 2
ORDER BY frekuensi DESC;

\copy o11b_pola_alur TO '11b_pola_alur.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ OUTPUT 12 — pengirim tak ter-resolve ═════════════
-- Loop kualitas data: isi sender_alias dari sini lalu jalankan ulang export.
CREATE TEMP TABLE o12_unresolved AS
SELECT m.group_jid, m.group_name, m.pushname, count(*) AS pesan,
       min(m.ts_wib) AS pertama, max(m.ts_wib) AS terakhir,
       left(pg_temp.flat((array_agg(m.body ORDER BY m.ts_wib))[1]), 200) AS contoh_pesan,
       'INSERT INTO sender_alias (group_jid, pushname, am_id, note) VALUES ('''
         || m.group_jid || ''', ' || quote_literal(m.pushname)
         || ', ''<AM_ID>'', ''export-wa-corpus'');' AS sql_perbaikan
FROM msg_x m
WHERE m.am_id IS NULL
GROUP BY m.group_jid, m.group_name, m.pushname
ORDER BY pesan DESC;

\copy o12_unresolved TO '12_pengirim_tak_dikenal.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ parameter run ════════════════════════════════════
-- Dipakai generator form (frekuensi Harian/Mingguan/Bulanan dihitung relatif
-- terhadap hari_ada_pesan).
CREATE TEMP TABLE o00_parameter AS
SELECT (:'since')::date              AS periode_mulai_diminta,
       (:'until')::date              AS periode_selesai_diminta,
       min(ts_wib)::date             AS pesan_pertama,
       max(ts_wib)::date             AS pesan_terakhir,
       count(DISTINCT ts_wib::date)  AS hari_ada_pesan,
       (max(ts_wib)::date - min(ts_wib)::date + 1) AS hari_kalender,
       count(*)                      AS total_pesan,
       count(DISTINCT group_jid)     AS jumlah_grup,
       count(DISTINCT person_key)    AS jumlah_aktor,
       count(DISTINCT position_key)  AS jumlah_posisi,
       round(100.0 * count(*) FILTER (WHERE am_id IS NOT NULL) / GREATEST(count(*), 1), 1) AS persen_ter_resolve,
       (:'adj_min')::int             AS adj_min,
       (:'gap_min')::int             AS gap_min
FROM msg_x;

\copy o00_parameter TO '00_parameter.csv' WITH (FORMAT csv, HEADER true)

-- ═════════════════════════ ringkasan (stdout, ditangkap wrapper) ════════════
CREATE TEMP TABLE ringkasan (urut int, berkas text, baris bigint, keterangan text);
INSERT INTO ringkasan VALUES
  ( 1, '01_messages.csv',            (SELECT count(*) FROM o01_messages),      'korpus pesan (1 baris = 1 pesan, pengirim ter-resolve)'),
  ( 2, '02_roster.csv',              (SELECT count(*) FROM o02_roster),        'roster + statistik aktivitas WA per orang'),
  ( 3, '03_groups.csv',              (SELECT count(*) FROM o03_groups),        'direktori grup + kualitas resolusi'),
  ( 4, '04_participation.csv',       (SELECT count(*) FROM o04_participation), 'partisipasi grup x orang'),
  ( 5, '05_edges_orang.csv',         (SELECT count(*) FROM o05_edges_orang),   'edge orang -> orang (adjacency)'),
  ( 6, '06_matriks_posisi.csv',      (SELECT count(*) FROM o06_matriks_posisi),'matriks posisi <-> posisi (long)'),
  ( 7, '06b_matriks_dept.csv',       (SELECT count(*) FROM o06b_matriks_dept), 'matriks departemen <-> departemen'),
  ( 7, '06c_topik_pasangan_posisi.csv', (SELECT count(*) FROM o06c_topik_pasangan), 'topik per pasangan posisi (isi kolom Yang Dikoordinasikan)'),
  ( 8, '07_mentions.csv',            (SELECT count(*) FROM o07_mentions),      'edge penyebutan eksplisit (@nomor / nama)'),
  ( 9, '08_ritme_waktu.csv',         (SELECT count(*) FROM o08_ritme),         'ritme jam/hari/bulan per orang'),
  (10, '09_sinyal_topik.csv',        (SELECT count(*) FROM o09_sinyal_topik),  'topik aktual per orang (jobdesk de-facto)'),
  (11, '09b_topik_posisi.csv',       (SELECT count(*) FROM o09b_topik_posisi), 'topik aktual per posisi'),
  (12, '11_sesi_percakapan.csv',     (SELECT count(*) FROM o11_sesi),          'sesi percakapan + alur aktor/posisi'),
  (13, '11b_pola_alur.csv',          (SELECT count(*) FROM o11b_pola_alur),    'pola alur posisi berulang (kandidat SOP)'),
  (14, '12_pengirim_tak_dikenal.csv',(SELECT count(*) FROM o12_unresolved),    'pushname gagal resolve + SQL perbaikan'),
  ( 0, '00_parameter.csv',           (SELECT count(*) FROM o00_parameter),     'parameter run (periode, hari ada pesan, cakupan)');

\if :has_spine
INSERT INTO ringkasan VALUES
  (15, '10_jobdesk_formal.csv', (SELECT count(*) FROM o10_jobdesk_formal), 'jobdesk formal (employee spine: tugas/RACI/KPI/PDCA)'),
  (16, '10b_raci_proses.csv',   (SELECT count(*) FROM o10b_raci_proses),   'proses x peran RACI');
\endif

\copy (SELECT urut, berkas, baris, keterangan FROM ringkasan ORDER BY urut) TO '00_MANIFEST.csv' WITH (FORMAT csv, HEADER true)

\pset format aligned
\pset border 2
SELECT berkas, baris, keterangan FROM ringkasan ORDER BY urut;

SELECT count(*) AS total_pesan,
       count(DISTINCT group_jid) AS grup,
       count(DISTINCT person_key) AS aktor,
       count(*) FILTER (WHERE am_id IS NULL) AS pesan_pengirim_tak_dikenal,
       round(100.0 * count(*) FILTER (WHERE am_id IS NOT NULL) / GREATEST(count(*), 1), 1) AS persen_ter_resolve,
       min(ts_wib) AS pesan_pertama, max(ts_wib) AS pesan_terakhir
FROM msg_x;
