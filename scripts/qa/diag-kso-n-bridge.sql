-- Diagnostik READ-ONLY F34 Fase 2: jembatan KSO-n (Accurate) ↔ kso_asset (SN).
--
-- Konteks: probe v2 menemukan 1.077 KSO-* aktif di Accurate vs 591 kso_asset aktif,
-- tanpa kunci bersama (Accurate = nomor KSO-n, kso_asset = SN). Skrip ini mengukur
-- strategi pencocokan MANA yang punya sinyal sebelum kita menulis kode apa pun.
-- Hanya SELECT. Tak mengubah data, tak menyentuh Accurate.
--
-- Jalankan di Mac mini (akses prod), simpan hasilnya, kirim balik:
--   psql wrg_os_prod -X -f scripts/qa/diag-kso-n-bridge.sql > /tmp/diag-kso-n.txt
-- Isi hasil memuat nama faskes/alat (bukan kredensial). Jangan commit ke repo (PUBLIC).

\pset null '∅'
\pset pager off

\echo '=== 1. Sebaran aset Accurate per prefiks ==='
SELECT prefix, fa_type_name, count(*) AS total,
       count(*) FILTER (WHERE NOT disposed) AS aktif,
       count(*) FILTER (WHERE description IS NULL OR description = '') AS desc_kosong,
       count(*) FILTER (WHERE notes IS NOT NULL AND notes <> '') AS notes_terisi,
       count(*) FILTER (WHERE purchase_invoice_id IS NOT NULL) AS tertaut_faktur
FROM accurate_fixed_asset GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '=== 2. 30 sampel KSO aktif (apa yang tertulis di description/notes/lokasi) ==='
SELECT number, left(description, 90) AS description, left(notes, 60) AS notes,
       location_name, trans_date, asset_cost
FROM accurate_fixed_asset
WHERE prefix = 'KSO' AND NOT disposed
ORDER BY random() LIMIT 30;

\echo '=== 3. Kunci JSON di raw (mana yang terisi) — cari field pelanggan/SN/pemasok ==='
SELECT k AS kunci, count(*) AS terisi
FROM accurate_fixed_asset a, jsonb_object_keys(a.raw) k
WHERE a.prefix = 'KSO' AND a.raw -> k NOT IN ('null'::jsonb, '""'::jsonb)
GROUP BY 1 ORDER BY 2 DESC;

\echo '=== 4. Pola description (angka & kode diratakan) — 40 teratas ==='
SELECT regexp_replace(upper(coalesce(description, '')), '[0-9]+', '#', 'g') AS pola,
       count(*) AS n, min(number) AS contoh
FROM accurate_fixed_asset
WHERE prefix = 'KSO' AND NOT disposed
GROUP BY 1 ORDER BY 2 DESC LIMIT 40;

\echo '=== 5. Strategi A: SN kso_asset muncul di teks aset Accurate ==='
-- sn_key >= 5 karakter, bukan placeholder NOSN:. Teks = description + notes + raw.
WITH k AS (
  SELECT id, sn_key, customer_raw, nama_alat FROM kso_asset
  WHERE aktif AND sn_key NOT LIKE 'NOSN:%' AND length(sn_key) >= 5
), hit AS (
  SELECT k.id, k.sn_key, a.id AS acc_id, a.number
  FROM k JOIN accurate_fixed_asset a ON a.prefix = 'KSO'
   AND upper(coalesce(a.description, '') || ' ' || coalesce(a.notes, '') || ' ' || a.raw::text)
       LIKE '%' || upper(k.sn_key) || '%'
)
SELECT (SELECT count(*) FROM k) AS kso_asset_ber_sn,
       count(DISTINCT id) AS ketemu_di_accurate,
       count(DISTINCT id) FILTER (WHERE id IN (SELECT id FROM hit GROUP BY id HAVING count(*) = 1)) AS tepat_satu,
       count(DISTINCT acc_id) AS aset_accurate_terpakai
FROM hit;

\echo '--- contoh hasil strategi A (20) ---'
SELECT k.sn_key, k.customer_raw, a.number, left(a.description, 70) AS description
FROM kso_asset k JOIN accurate_fixed_asset a ON a.prefix = 'KSO'
 AND upper(coalesce(a.description, '') || ' ' || coalesce(a.notes, '') || ' ' || a.raw::text)
     LIKE '%' || upper(k.sn_key) || '%'
WHERE k.aktif AND k.sn_key NOT LIKE 'NOSN:%' AND length(k.sn_key) >= 5
LIMIT 20;

\echo '=== 6. Strategi B: nama faskes (customer_raw) muncul di description ==='
-- Token pertama sebelum koma ("<nama>, <tipe> <KOTA>") dipakai sebagai nama faskes.
WITH k AS (
  SELECT id, trim(split_part(customer_raw, ',', 1)) AS nama, nama_alat, type_alat
  FROM kso_asset WHERE aktif AND length(trim(split_part(customer_raw, ',', 1))) >= 6
), hit AS (
  SELECT k.id, a.id AS acc_id
  FROM k JOIN accurate_fixed_asset a ON a.prefix = 'KSO' AND NOT a.disposed
   AND upper(coalesce(a.description, '')) LIKE '%' || upper(k.nama) || '%'
)
SELECT (SELECT count(*) FROM k) AS kso_asset_uji,
       count(DISTINCT id) AS punya_kandidat,
       count(DISTINCT id) FILTER (WHERE id IN (SELECT id FROM hit GROUP BY id HAVING count(*) = 1)) AS kandidat_tunggal,
       count(DISTINCT acc_id) AS aset_accurate_terpakai
FROM hit;

\echo '=== 7. Strategi C: nilai perolehan + tanggal ≈ tgl_sj kso_asset (hanya indikatif) ==='
SELECT count(*) AS aset_accurate_aktif_kso,
       count(*) FILTER (WHERE trans_date >= '2025-01-01') AS bertanggal_2025_ke_atas,
       count(*) FILTER (WHERE trans_date < '2024-01-01') AS bertanggal_sebelum_2024,
       count(DISTINCT trans_date) AS tanggal_unik
FROM accurate_fixed_asset WHERE prefix = 'KSO' AND NOT disposed;

\echo '=== 8. Penautan manual yang sudah ada & kso_asset tanpa pasangan ==='
SELECT (SELECT count(*) FROM fixed_asset_override WHERE kso_asset_id IS NOT NULL) AS tertaut_manual,
       (SELECT count(*) FROM kso_asset WHERE aktif) AS kso_asset_aktif,
       (SELECT count(*) FROM kso_asset WHERE aktif AND sn_key LIKE 'NOSN:%') AS tanpa_sn,
       (SELECT count(*) FROM kso_asset k WHERE aktif AND NOT EXISTS (
          SELECT 1 FROM fixed_asset_override o WHERE o.kso_asset_id = k.id)) AS belum_tertaut;

\echo '=== 9. Distribusi jenis alat kso_asset aktif (untuk dibandingkan dgn description Accurate) ==='
SELECT coalesce(type_alat, '∅') AS type_alat, coalesce(nama_alat, '∅') AS nama_alat, count(*) AS n
FROM kso_asset WHERE aktif GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30;
