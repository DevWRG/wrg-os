-- 220 — F169 fase 2: jumlah tes PER_TEST dari Accurate (tes yang DITAGIH).
--
-- KEPUTUSAN USER 13 Okt 2026: sumber kebenaran jumlah tes = Accurate, karena itu
-- yang tercatat dan ditagihkan ke customer. Sheet teknisi ("2026 KSO Tes") tetap
-- diimpor sebagai laporan lapangan, tapi tidak lagi jadi penyebut Rp/tes PER_TEST.
-- Per 13 Okt sheet itu berhenti di Juli (Agustus separuh), sementara faktur Accurate
-- sinkron tiap 30 menit.
--
-- BELI_REAGEN TETAP DARI SHEET: customer membeli reagen, tesnya tidak ditagih, jadi
-- Accurate hampir tak punya baris PEMERIKSAAN untuk skema ini (Mar 2026: 140 vs sheet
-- 18.911).
--
-- SATU SUMBER: kso_tes_faskes_v = tes per (faskes, skema, jenis alat, bulan).
--   PER_TEST    — qty baris item PEMERIKSAAN% di faktur (satuan selalu TEST), jenis
--                 dari kso_item_pemeriksaan_v; periode = BULAN FAKTUR − 1 (faktur
--                 terbit sebulan sesudah pemakaian; aturan yang sama dengan pembanding
--                 tagih/lapor di 103-105/197 dan F73). Hanya untuk (faskes, jenis) yang
--                 PERNAH ditempati alat PER_TEST jenis itu (kso_asset_penempatan) —
--                 faskes berskema ganda di jenis yang sama ikut PER_TEST (aturan
--                 kso_penagihan_tes_v). Diukur prod 13 Okt: 94,7% qty PEMERIKSAAN masuk;
--                 2,4% di faskes tanpa alat KSO sejenis di master (celah populasi) dan
--                 0,9% di faskes yang alat sejenisnya BELI_REAGEN — dua-duanya tak dihitung.
--                 Item "PENGULANGAN HEMATOLOGY" (0,15%) tak bisa dipetakan ke 3Diff/5Diff,
--                 tidak dihitung.
--   BELI_REAGEN — tes sheet per alat lewat kso_tes_lokasi_v (217, ikut penempatan).
--
-- GRANULARITAS PER_TEST = faskes × jenis, BUKAN per SN: Accurate tidak mencatat alat.
-- Di kso_asset_produktivitas_v kolom per-alat PER_TEST (total_tes, bulan_terlapor,
-- rata_tes_bulanan) berisi angka JENIS itu di faskes itu (sama untuk alat sejenis), dan
-- capaian_target = rata tes jenis / jumlah target alat PER_TEST sejenis di faskes.
-- Total per faskes (seskema → Rp/tes) memakai jumlah per faskes, bukan jumlah baris
-- alat, supaya alat sejenis tidak menggandakan tes.
--
-- PORSI REVENUE (faskes berskema ganda, 102/121/122) SENGAJA TETAP DARI TES SHEET.
-- Porsi membagi revenue kategori KSO antara dua skema menurut perbandingan tes; kalau
-- satu sisi diganti tes Accurate (2026 saja) dan sisi lain tetap sheet (2025–2026),
-- perbandingannya mencampur dua periode dan revenue berpindah antar skema tanpa ada
-- yang berubah di lapangan (diukur: satu faskes, revenue BELI_REAGEN Feb 2,2 jt →
-- 20,8 jt). Keputusan user hanya mengganti PENYEBUT Rp/tes, bukan aturan atribusi.
--
-- Kolom keluaran semua view TIDAK berubah (MV + GRANT aman; CREATE OR REPLACE).
-- Pembanding tagih/lapor (banding, 103-105) tetap membandingkan Accurate vs sheet —
-- itu ukuran kualitas data, bukan sumber tes.

CREATE OR REPLACE VIEW kso_tes_faskes_v AS
WITH milik AS (
  SELECT p.account_id,
         kso_jenis_kanonik(a.type_alat) AS jenis,
         CASE WHEN bool_or(a.skema = 'PER_TEST') THEN 'PER_TEST' ELSE 'BELI_REAGEN' END AS skema
    FROM kso_asset_penempatan p
    JOIN kso_asset a ON a.id = p.asset_id
   WHERE p.account_id IS NOT NULL AND a.skema IN ('PER_TEST', 'BELI_REAGEN')
   GROUP BY p.account_id, kso_jenis_kanonik(a.type_alat)
), tagih AS (
  SELECT i.customer_id AS account_id,
         pm.jenis,
         (date_trunc('month', i.tanggal::timestamptz) - interval '1 month')::date AS periode,
         sum(ii.qty) AS qty
    FROM accurate_invoice i
    JOIN accurate_invoice_item ii ON ii.invoice_id = i.id
    JOIN kso_item_pemeriksaan_v pm ON pm.item_id = ii.item_id
   WHERE i.customer_id IS NOT NULL AND i.tanggal IS NOT NULL AND pm.jenis IS NOT NULL
   GROUP BY 1, 2, 3
)
SELECT t.account_id, 'PER_TEST'::text AS skema, t.jenis, t.periode,
       t.qty AS jumlah_tes, 'accurate'::text AS sumber
  FROM tagih t
  JOIN milik m ON m.account_id = t.account_id AND m.jenis = t.jenis AND m.skema = 'PER_TEST'
UNION ALL
SELECT tl.account_id, 'BELI_REAGEN'::text, kso_jenis_kanonik(a.type_alat), tl.periode,
       sum(tl.jumlah_tes), 'sheet'::text
  FROM kso_tes_lokasi_v tl
  JOIN kso_asset a ON a.id = tl.asset_id
 WHERE a.skema = 'BELI_REAGEN' AND tl.account_id IS NOT NULL AND tl.jumlah_tes IS NOT NULL
 GROUP BY tl.account_id, kso_jenis_kanonik(a.type_alat), tl.periode;

COMMENT ON VIEW kso_tes_faskes_v IS
  'Jumlah tes per faskes x skema x jenis alat x bulan (migrasi 220). PER_TEST = PEMERIKSAAN tertagih Accurate (periode = bulan faktur - 1); BELI_REAGEN = sheet teknisi lewat kso_tes_lokasi_v.';

CREATE OR REPLACE VIEW kso_asset_produktivitas_v AS
WITH kategori_skema AS (
         SELECT kso_kategori_skema.skema,
            array_agg(kso_kategori_skema.kategori ORDER BY kso_kategori_skema.kategori) AS kategori
           FROM kso_kategori_skema
          GROUP BY kso_kategori_skema.skema
        ), aset AS (
         SELECT a_1.id,
            a_1.sn_key,
            a_1.sn_raw,
            a_1.customer_raw,
            a_1.account_id,
            a_1.kota,
            a_1.station,
            a_1.admin,
            a_1.type_alat,
            a_1.nama_alat,
            a_1.skema,
            a_1.pemilik_alat,
            a_1.nomor_mou,
            a_1.mou_berlaku_sampai,
            a_1.target_jumlah_tes,
            a_1.ritme_kunjungan,
            a_1.paket,
            a_1.status_sheet,
            a_1.keterangan,
            a_1.tgl_sj,
            a_1.alamat,
            a_1.outlet,
            a_1.in_populasi,
            a_1.sumber_sheet,
            a_1.catatan_sync,
            a_1.aktif,
            a_1.created_at,
            a_1.updated_at,
            ks.kategori AS kategori_berlaku
           FROM kso_asset a_1
             JOIN kategori_skema ks ON ks.skema = a_1.skema
          WHERE a_1.account_id IS NOT NULL AND kso_asset_status_kode(a_1.*) = 'operasional'::text
        ), tes AS (
         SELECT tl.asset_id,
            tl.account_id,
            sum(tl.jumlah_tes) AS total_tes,
            count(*) AS bulan_terlapor,
            avg(tl.jumlah_tes) AS rata_tes_bulanan
           FROM kso_tes_lokasi_v tl
          GROUP BY tl.asset_id, tl.account_id
        ), tes_pt_jenis AS (
         SELECT f.account_id,
            f.jenis,
            sum(f.jumlah_tes) AS total_tes,
            count(*) AS bulan_terlapor,
            avg(f.jumlah_tes) AS rata_tes_bulanan
           FROM kso_tes_faskes_v f
          WHERE f.skema = 'PER_TEST'::text
          GROUP BY f.account_id, f.jenis
        ), tes_pt_faskes AS (
         SELECT tes_pt_jenis.account_id,
            sum(tes_pt_jenis.total_tes) AS total_tes
           FROM tes_pt_jenis
          GROUP BY tes_pt_jenis.account_id
        ), pasangan AS (
         SELECT a_1.id AS asset_id,
            a_1.account_id,
            a_1.skema,
            true AS sekarang
           FROM kso_asset a_1
          WHERE a_1.account_id IS NOT NULL AND kso_asset_status_kode(a_1.*) = 'operasional'::text
        UNION ALL
         SELECT a_1.id AS asset_id,
            t_1.account_id,
            a_1.skema,
            false AS sekarang
           FROM tes t_1
             JOIN kso_asset a_1 ON a_1.id = t_1.asset_id
          WHERE t_1.account_id IS NOT NULL AND t_1.account_id IS DISTINCT FROM a_1.account_id AND kso_asset_status_kode(a_1.*) = 'operasional'::text
        ), faktur_customer AS (
         SELECT accurate_invoice.customer_id AS account_id,
            count(*)::integer AS jumlah_faktur_total
           FROM accurate_invoice
          WHERE accurate_invoice.customer_id IS NOT NULL
          GROUP BY accurate_invoice.customer_id
        ), jendela_banding AS (
         SELECT (date_trunc('month'::text, min(accurate_invoice.tanggal)::timestamp with time zone) - '1 mon'::interval)::date AS dari,
            (date_trunc('month'::text, max(accurate_invoice.tanggal)::timestamp with time zone) - '1 mon'::interval)::date AS sampai
           FROM accurate_invoice
          WHERE accurate_invoice.tanggal IS NOT NULL
        ), tagih AS (
         SELECT ai.customer_id AS account_id,
            (date_trunc('month'::text, ai.tanggal::timestamp with time zone) - '1 mon'::interval)::date AS periode,
            sum((d.val ->> 'quantity'::text)::numeric) AS qty
           FROM accurate_invoice ai
             JOIN LATERAL jsonb_array_elements(COALESCE(ai.raw -> 'detailItem'::text, '[]'::jsonb)) d(val) ON true
          WHERE ai.customer_id IS NOT NULL AND ai.tanggal IS NOT NULL AND (COALESCE((d.val -> 'item'::text) ->> 'name'::text, ''::text) ~~* 'PEMERIKSAAN%'::text OR COALESCE((d.val -> 'item'::text) ->> 'name'::text, ''::text) ~~* '%PENGULANGAN%'::text)
          GROUP BY ai.customer_id, ((date_trunc('month'::text, ai.tanggal::timestamp with time zone) - '1 mon'::interval)::date)
        ), periode_sheet AS (
         SELECT m.account_id,
            m.periode,
            sum(m.jumlah_tes) AS tes
           FROM kso_tes_lokasi_v m
             JOIN kso_asset a_1 ON a_1.id = m.asset_id
             CROSS JOIN jendela_banding j
          WHERE m.account_id IS NOT NULL AND a_1.aktif AND m.periode >= j.dari AND m.periode <= j.sampai
          GROUP BY m.account_id, m.periode
        ), banding AS (
         SELECT ps.account_id,
            sum(ps.tes) AS tes_sheet_periode_banding,
            sum(COALESCE(t_1.qty, 0::numeric)) AS tes_ditagihkan_accurate,
            count(*) FILTER (WHERE t_1.qty IS NOT NULL) AS bulan_tertagih,
            count(DISTINCT t_1.qty) AS nilai_qty_unik
           FROM periode_sheet ps
             LEFT JOIN tagih t_1 ON t_1.account_id = ps.account_id AND t_1.periode = ps.periode
          GROUP BY ps.account_id
        ), porsi AS (
         SELECT sc.account_id,
            sc.skema,
                CASE
                    WHEN count(*) OVER (PARTITION BY sc.account_id) = 1 THEN 1::numeric
                    WHEN min(sc.tes) OVER (PARTITION BY sc.account_id) = 0::numeric AND sum(sc.tes) OVER (PARTITION BY sc.account_id) > 0::numeric AND pr.porsi_reagen IS NOT NULL THEN pr.porsi_reagen
                    WHEN sum(sc.tes) OVER (PARTITION BY sc.account_id) > 0::numeric THEN sc.tes / sum(sc.tes) OVER (PARTITION BY sc.account_id)
                    ELSE sc.n::numeric / NULLIF(sum(sc.n) OVER (PARTITION BY sc.account_id), 0)::numeric
                END AS porsi_kso
           FROM ( SELECT ps.account_id,
                    ps.skema,
                    count(*) FILTER (WHERE ps.sekarang)::integer AS n,
                    COALESCE(sum(t_1.total_tes), 0::numeric) AS tes
                   FROM pasangan ps
                     LEFT JOIN tes t_1 ON t_1.asset_id = ps.asset_id AND t_1.account_id = ps.account_id
                  WHERE ps.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])
                  GROUP BY ps.account_id, ps.skema) sc
             LEFT JOIN kso_porsi_reagen_v pr ON pr.account_id = sc.account_id AND pr.skema = sc.skema
        ), penagihan_tes AS (
         SELECT kso_penagihan_tes_v.account_id,
            kso_penagihan_tes_v.skema,
            sum(kso_penagihan_tes_v.nilai_netto) AS revenue_netto
           FROM kso_penagihan_tes_v
          GROUP BY kso_penagihan_tes_v.account_id, kso_penagihan_tes_v.skema
        ), rev AS (
         SELECT COALESCE(k.account_id, pt.account_id) AS account_id,
            COALESCE(k.skema, pt.skema) AS skema,
            COALESCE(k.revenue_netto, 0::numeric) + COALESCE(pt.revenue_netto, 0::numeric) AS revenue_netto,
            k.jumlah_faktur,
            k.porsi_kso
           FROM ( SELECT r.account_id,
                    ks.skema,
                    sum(
                        CASE
                            WHEN r.kategori = 'KSO'::text THEN r.revenue_netto * p.porsi_kso
                            ELSE r.revenue_netto
                        END) AS revenue_netto,
                    sum(r.jumlah_faktur) AS jumlah_faktur,
                    max(p.porsi_kso) AS porsi_kso
                   FROM kso_customer_revenue_mv r
                     JOIN kategori_skema ks ON r.kategori = ANY (ks.kategori)
                     JOIN porsi p ON p.account_id = r.account_id AND p.skema = ks.skema
                  GROUP BY r.account_id, ks.skema) k
             FULL JOIN penagihan_tes pt ON pt.account_id = k.account_id AND pt.skema = k.skema
        ), seskema AS (
         SELECT ps.account_id,
            ps.skema,
            count(*) FILTER (WHERE ps.sekarang)::integer AS n,
                CASE
                    WHEN ps.skema = 'PER_TEST'::text THEN ( SELECT tpf.total_tes
                       FROM tes_pt_faskes tpf
                      WHERE tpf.account_id = ps.account_id)
                    ELSE sum(t_1.total_tes)
                END AS total_tes_seskema
           FROM pasangan ps
             LEFT JOIN tes t_1 ON t_1.asset_id = ps.asset_id AND t_1.account_id = ps.account_id
          GROUP BY ps.account_id, ps.skema
        ), target_pt_jenis AS (
         SELECT a_1.account_id,
            kso_jenis_kanonik(a_1.type_alat) AS jenis,
            sum(a_1.target_jumlah_tes) FILTER (WHERE a_1.target_jumlah_tes > 0) AS target
           FROM aset a_1
          WHERE a_1.skema = 'PER_TEST'::text
          GROUP BY a_1.account_id, (kso_jenis_kanonik(a_1.type_alat))
        )
 SELECT a.id AS asset_id,
    a.sn_key,
    a.customer_raw,
    a.account_id,
    a.kota,
    a.station,
    a.type_alat,
    a.nama_alat,
    a.skema,
    a.pemilik_alat,
    a.target_jumlah_tes,
        CASE
            WHEN a.skema = 'PER_TEST'::text THEN tj.total_tes
            ELSE t.total_tes
        END AS total_tes,
        CASE
            WHEN a.skema = 'PER_TEST'::text THEN tj.bulan_terlapor
            ELSE t.bulan_terlapor
        END AS bulan_terlapor,
        CASE
            WHEN a.skema = 'PER_TEST'::text THEN tj.rata_tes_bulanan
            ELSE t.rata_tes_bulanan
        END AS rata_tes_bulanan,
        CASE
            WHEN a.skema = 'PER_TEST'::text THEN
            CASE
                WHEN tg.target > 0 THEN round(tj.rata_tes_bulanan / tg.target::numeric, 3)
                ELSE NULL::numeric
            END
            WHEN a.target_jumlah_tes > 0 THEN round(t.rata_tes_bulanan / a.target_jumlah_tes::numeric, 3)
            ELSE NULL::numeric
        END AS capaian_target,
    rev.revenue_netto AS revenue_netto_customer,
    rev.jumlah_faktur,
    round(rev.porsi_kso, 12) AS porsi_kso,
    s.n AS alat_seskema_di_customer,
    s.total_tes_seskema AS total_tes_customer_seskema,
    b.tes_sheet_periode_banding,
    b.tes_ditagihkan_accurate,
        CASE
            WHEN b.bulan_tertagih > 0 AND b.tes_sheet_periode_banding > 0::numeric THEN round(b.tes_ditagihkan_accurate / b.tes_sheet_periode_banding, 3)
            ELSE NULL::numeric
        END AS rasio_tagih_lapor,
    b.bulan_tertagih AS bulan_tertagih_accurate,
    b.bulan_tertagih >= 4 AND b.nilai_qty_unik <= 2 AS tagih_pola_datar,
        CASE
            WHEN b.bulan_tertagih > 0 THEN 'ada_catatan_tes'::text
            WHEN COALESCE(fc.jumlah_faktur_total, 0) > 0 THEN 'faktur_tanpa_catatan_tes'::text
            ELSE 'tanpa_faktur'::text
        END AS status_penagihan,
        CASE
            WHEN rev.revenue_netto IS NOT NULL AND s.total_tes_seskema > 0::numeric THEN round(rev.revenue_netto / s.total_tes_seskema, 2)
            ELSE NULL::numeric
        END AS rupiah_per_tes_customer,
    COALESCE(s.total_tes_seskema, 0::numeric) >= 100::numeric AS basis_tes_memadai,
    (EXISTS ( SELECT 1
           FROM kso_asset b_1
          WHERE b_1.account_id = a.account_id AND kso_asset_status_kode(b_1.*) = 'operasional'::text AND b_1.skema <> a.skema AND (b_1.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])))) AS revenue_tumpang_tindih
   FROM aset a
     LEFT JOIN tes t ON t.asset_id = a.id AND t.account_id = a.account_id
     LEFT JOIN tes_pt_jenis tj ON a.skema = 'PER_TEST'::text AND tj.account_id = a.account_id AND tj.jenis = kso_jenis_kanonik(a.type_alat)
     LEFT JOIN target_pt_jenis tg ON a.skema = 'PER_TEST'::text AND tg.account_id = a.account_id AND tg.jenis = kso_jenis_kanonik(a.type_alat)
     LEFT JOIN rev ON rev.account_id = a.account_id AND rev.skema = a.skema
     LEFT JOIN seskema s ON s.account_id = a.account_id AND s.skema = a.skema
     LEFT JOIN banding b ON b.account_id = a.account_id
     LEFT JOIN faktur_customer fc ON fc.account_id = a.account_id;

CREATE OR REPLACE VIEW kso_faskes_tren_v AS
WITH porsi AS (
         SELECT DISTINCT kso_asset_produktivitas_v.account_id,
            kso_asset_produktivitas_v.skema,
            kso_asset_produktivitas_v.porsi_kso
           FROM kso_asset_produktivitas_v
        ), tes AS (
         SELECT m.account_id,
            a.skema,
            m.periode,
            sum(m.jumlah_tes) AS jumlah_tes,
            count(DISTINCT a.id)::integer AS alat_lapor
           FROM kso_tes_lokasi_v m
             JOIN kso_asset a ON a.id = m.asset_id
          WHERE m.account_id IS NOT NULL AND a.skema = 'BELI_REAGEN'::text AND m.jumlah_tes IS NOT NULL
          GROUP BY m.account_id, a.skema, m.periode
        UNION ALL
         SELECT x.account_id,
            'PER_TEST'::text AS skema,
            x.periode,
            x.jumlah_tes,
            ( SELECT count(DISTINCT p.asset_id)::integer AS count
                   FROM kso_asset_penempatan p
                     JOIN kso_asset a ON a.id = p.asset_id
                  WHERE p.account_id = x.account_id AND a.skema = 'PER_TEST'::text AND (kso_jenis_kanonik(a.type_alat) = ANY (x.jenis)) AND kso_penempatan_rentang(p.mulai, p.selesai) && daterange(x.periode, (x.periode + '1 mon'::interval)::date, '[)'::text)) AS alat_lapor
           FROM ( SELECT f.account_id,
                    f.periode,
                    sum(f.jumlah_tes) AS jumlah_tes,
                    array_agg(f.jenis) AS jenis
                   FROM kso_tes_faskes_v f
                  WHERE f.skema = 'PER_TEST'::text
                  GROUP BY f.account_id, f.periode) x
        ), rev AS (
         SELECT r.account_id,
            ks.skema,
            r.periode,
            sum(
                CASE
                    WHEN r.kategori = 'KSO'::text THEN r.revenue_netto * p.porsi_kso
                    ELSE r.revenue_netto
                END) AS revenue_netto
           FROM kso_customer_revenue_mv r
             JOIN kso_kategori_skema ks ON ks.kategori = r.kategori
             JOIN porsi p ON p.account_id = r.account_id AND p.skema = ks.skema
          GROUP BY r.account_id, ks.skema, r.periode
        ), pt AS (
         SELECT kso_penagihan_tes_v.account_id,
            kso_penagihan_tes_v.skema,
            kso_penagihan_tes_v.periode,
            sum(kso_penagihan_tes_v.nilai_netto) AS revenue_netto
           FROM kso_penagihan_tes_v
          GROUP BY kso_penagihan_tes_v.account_id, kso_penagihan_tes_v.skema, kso_penagihan_tes_v.periode
        ), rev_all AS (
         SELECT COALESCE(k.account_id, p.account_id) AS account_id,
            COALESCE(k.skema, p.skema) AS skema,
            COALESCE(k.periode, p.periode) AS periode,
                CASE
                    WHEN k.revenue_netto IS NULL AND p.revenue_netto IS NULL THEN NULL::numeric
                    ELSE COALESCE(k.revenue_netto, 0::numeric) + COALESCE(p.revenue_netto, 0::numeric)
                END AS revenue_netto
           FROM rev k
             FULL JOIN pt p ON p.account_id = k.account_id AND p.skema = k.skema AND p.periode = k.periode
        )
 SELECT COALESCE(t.account_id, rv.account_id) AS account_id,
    COALESCE(t.skema, rv.skema) AS skema,
    COALESCE(t.periode, rv.periode) AS periode,
    t.jumlah_tes,
    t.alat_lapor,
    rv.revenue_netto
   FROM tes t
     FULL JOIN rev_all rv ON rv.account_id = t.account_id AND rv.skema = t.skema AND rv.periode = t.periode;

CREATE OR REPLACE VIEW kso_jenis_ringkas_v AS
WITH jendela AS (
         SELECT (date_trunc('month'::text, min(accurate_invoice.tanggal)::timestamp with time zone) - '1 mon'::interval)::date AS dari,
            (date_trunc('month'::text, max(accurate_invoice.tanggal)::timestamp with time zone) - '1 mon'::interval)::date AS sampai
           FROM accurate_invoice
          WHERE accurate_invoice.tanggal IS NOT NULL
        ), populasi AS (
         SELECT kso_jenis_kanonik(a.type_alat) AS jenis,
            count(*)::integer AS aset_total,
            count(*) FILTER (WHERE
                CASE
                    WHEN a.skema = 'PER_TEST'::text THEN (EXISTS ( SELECT 1
                       FROM kso_tes_faskes_v f
                         CROSS JOIN jendela j
                      WHERE f.skema = 'PER_TEST'::text AND f.account_id = a.account_id AND f.jenis = kso_jenis_kanonik(a.type_alat) AND f.periode >= j.dari AND f.periode <= j.sampai))
                    ELSE (EXISTS ( SELECT 1
                       FROM kso_asset_test_monthly m
                         CROSS JOIN jendela j
                      WHERE m.asset_id = a.id AND m.periode >= j.dari AND m.periode <= j.sampai))
                END)::integer AS aset_melapor,
            count(DISTINCT a.account_id)::integer AS customer
           FROM kso_asset a
          WHERE a.account_id IS NOT NULL
          GROUP BY (kso_jenis_kanonik(a.type_alat))
        ), tes AS (
         SELECT x.jenis,
            sum(x.tes)::bigint AS tes
           FROM ( SELECT kso_jenis_kanonik(a.type_alat) AS jenis,
                    m.jumlah_tes AS tes
                   FROM kso_tes_lokasi_v m
                     JOIN kso_asset a ON a.id = m.asset_id
                     CROSS JOIN jendela j
                  WHERE m.account_id IS NOT NULL AND a.skema <> 'PER_TEST'::text AND m.periode >= j.dari AND m.periode <= j.sampai
                UNION ALL
                 SELECT f.jenis,
                    f.jumlah_tes
                   FROM kso_tes_faskes_v f
                     CROSS JOIN jendela j
                  WHERE f.skema = 'PER_TEST'::text AND f.periode >= j.dari AND f.periode <= j.sampai) x
          GROUP BY x.jenis
        ), rev AS (
         SELECT r.jenis,
            sum(r.revenue_netto) AS revenue_netto
           FROM kso_revenue_jenis_v r
             JOIN ( SELECT DISTINCT kso_asset.account_id
                   FROM kso_asset
                  WHERE kso_asset.account_id IS NOT NULL) k ON k.account_id = r.account_id
             CROSS JOIN jendela j
          WHERE (r.kategori IN ( SELECT kso_kategori_skema.kategori
                   FROM kso_kategori_skema)) AND (r.periode - '1 mon'::interval)::date >= j.dari AND (r.periode - '1 mon'::interval)::date <= j.sampai
          GROUP BY r.jenis
        )
 SELECT COALESCE(p.jenis, rev.jenis) AS jenis,
    p.aset_total,
    p.aset_melapor,
        CASE
            WHEN p.aset_total > 0 THEN round(p.aset_melapor::numeric / p.aset_total::numeric, 3)
            ELSE NULL::numeric
        END AS rasio_lapor,
    p.customer,
    t.tes,
    rev.revenue_netto,
        CASE
            WHEN t.tes > 0 AND rev.revenue_netto IS NOT NULL THEN round(rev.revenue_netto / t.tes::numeric, 2)
            ELSE NULL::numeric
        END AS rupiah_per_tes,
    COALESCE(p.aset_total > 0 AND (p.aset_melapor::numeric / p.aset_total::numeric) >= 0.8, false) AS cakupan_lapor_memadai,
    COALESCE(p.jenis IS NOT NULL, false) AS jenis_alat_nyata,
    ( SELECT jendela.dari
           FROM jendela) AS periode_dari,
    ( SELECT jendela.sampai
           FROM jendela) AS periode_sampai
   FROM populasi p
     FULL JOIN rev ON rev.jenis = p.jenis
     LEFT JOIN tes t ON t.jenis = p.jenis;

CREATE OR REPLACE VIEW kso_revenue_jenis_v AS
WITH inv AS (
         SELECT i.id,
            i.customer_id,
            date_trunc('month'::text, i.tanggal::timestamp with time zone)::date AS periode,
            i.total - COALESCE(i.tax_amount, 0::numeric) AS netto
           FROM accurate_invoice i
          WHERE i.customer_id IS NOT NULL AND i.tanggal IS NOT NULL
        ), lin AS (
         SELECT inv.id,
            inv.customer_id,
            inv.periode,
            inv.netto,
            COALESCE(m.jenis, 'TAK TERPETAKAN'::text) AS jenis,
            COALESCE(NULLIF(ii.raw ->> 'charField1'::text, ''::text), 'Tanpa kategori'::text) AS kategori,
            GREATEST(ii.total, 0::numeric) AS w
           FROM inv
             JOIN accurate_invoice_item ii ON ii.invoice_id = inv.id
             LEFT JOIN kso_item_jenis_v m ON m.item_id = ii.item_id
        ), alokasi AS (
         SELECT x.customer_id,
            x.periode,
            x.jenis,
            x.kategori,
            sum(
                CASE
                    WHEN x.wsum > 0::numeric THEN x.netto * x.w / x.wsum
                    ELSE x.netto / x.cnt::numeric
                END) AS rev
           FROM ( SELECT lin.id,
                    lin.customer_id,
                    lin.periode,
                    lin.netto,
                    lin.jenis,
                    lin.kategori,
                    lin.w,
                    sum(lin.w) OVER (PARTITION BY lin.id) AS wsum,
                    count(*) OVER (PARTITION BY lin.id) AS cnt
                   FROM lin) x
          GROUP BY x.customer_id, x.periode, x.jenis, x.kategori
        ), porsi AS (
         SELECT g.jenis_gabungan,
            g.jenis_anggota,
            t.account_id,
            t.tes / NULLIF(sum(t.tes) OVER (PARTITION BY g.jenis_gabungan, t.account_id), 0::numeric) AS porsi
           FROM kso_jenis_gabungan g
             JOIN ( SELECT x.account_id,
                    x.jenis,
                    COALESCE(sum(x.tes), 0::numeric) AS tes
                   FROM ( SELECT a.account_id,
                            kso_jenis_kanonik(a.type_alat) AS jenis,
                            NULL::numeric AS tes
                           FROM kso_asset a
                          WHERE a.account_id IS NOT NULL
                        UNION ALL
                         SELECT m.account_id,
                            kso_jenis_kanonik(a.type_alat) AS jenis,
                            m.jumlah_tes AS tes
                           FROM kso_tes_lokasi_v m
                             JOIN kso_asset a ON a.id = m.asset_id
                          WHERE m.account_id IS NOT NULL AND a.skema <> 'PER_TEST'::text
                        UNION ALL
                         SELECT f.account_id,
                            f.jenis,
                            f.jumlah_tes AS tes
                           FROM kso_tes_faskes_v f
                          WHERE f.skema = 'PER_TEST'::text) x
                  GROUP BY x.account_id, x.jenis) t ON t.jenis = g.jenis_anggota
        )
 SELECT a.customer_id AS account_id,
    a.periode,
    a.jenis,
    a.kategori,
    a.rev AS revenue_netto
   FROM alokasi a
  WHERE NOT (a.jenis IN ( SELECT kso_jenis_gabungan.jenis_gabungan
           FROM kso_jenis_gabungan))
UNION ALL
 SELECT a.customer_id AS account_id,
    a.periode,
    p.jenis_anggota AS jenis,
    a.kategori,
    a.rev * p.porsi AS revenue_netto
   FROM alokasi a
     JOIN porsi p ON p.jenis_gabungan = a.jenis AND p.account_id = a.customer_id AND p.porsi IS NOT NULL
UNION ALL
 SELECT a.customer_id AS account_id,
    a.periode,
    a.jenis,
    a.kategori,
    a.rev AS revenue_netto
   FROM alokasi a
  WHERE (a.jenis IN ( SELECT kso_jenis_gabungan.jenis_gabungan
           FROM kso_jenis_gabungan)) AND NOT (EXISTS ( SELECT 1
           FROM porsi p
          WHERE p.jenis_gabungan = a.jenis AND p.account_id = a.customer_id AND p.porsi IS NOT NULL));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT ON kso_tes_faskes_v TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_tes_faskes_v TO wrg_readonly;
  END IF;
END $$;
