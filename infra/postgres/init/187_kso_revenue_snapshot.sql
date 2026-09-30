-- 187 — Snapshot untuk kso_customer_revenue_v: sisa terakhir pembaca `raw`.
--
-- SISA YANG BELUM TERTUTUP. Sesudah snapshot atas (185) dan kolom generated
-- (186), /kso/produktivitas turun >100 dtk → ~1,3 dtk. Tapi pengukuran per
-- tabel di prod menunjukkan asalnya masih jelas:
--     accurate_invoice_item  → 0 blok TOAST   (186 tuntas)
--     accurate_invoice       → 40.174 blok TOAST per SATU permintaan
-- Sumbernya `kso_customer_revenue_v`, yang mengembangkan
-- `raw->'detailItem'` (array) atas seluruh faktur. `accurate_invoice` punya
-- TOAST 199 MB di atas heap 3,4 MB.
--
-- KENAPA BUKAN KOLOM GENERATED SEPERTI 186. Kolom generated hanya bisa berisi
-- SATU nilai per baris. Di sini yang dibutuhkan adalah array `detailItem` yang
-- mekar jadi banyak baris per faktur, lalu diagregasi per kategori — itu tak
-- bisa diwakili kolom skalar. Jadi bentuknya snapshot, seperti 185.
--
-- URUTAN REFRESH PENTING. `kso_asset_produktivitas_v` (sumber snapshot 185)
-- ikut membaca view ini, jadi snapshot revenue harus disegarkan LEBIH DULU
-- daripada kso_asset_produktivitas_mv — kalau terbalik, snapshot atas dibangun
-- dari revenue yang masih lama. Urutannya dijaga di apps/api/src/scheduler.ts.
--
-- Kunci unik (account_id, periode, kategori) terbukti unik di prod: 7.267 dari
-- 7.267 baris — syarat REFRESH ... CONCURRENTLY terpenuhi.
CREATE MATERIALIZED VIEW IF NOT EXISTS kso_customer_revenue_mv AS
  SELECT * FROM kso_customer_revenue_v;

CREATE UNIQUE INDEX IF NOT EXISTS kso_customer_revenue_mv_key_idx
  ON kso_customer_revenue_mv (account_id, periode, kategori);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT ON kso_customer_revenue_mv TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_customer_revenue_mv TO wrg_readonly;
  END IF;
END $$;

-- Dua pembacanya dialihkan ke snapshot. Daftar & tipe kolom keluaran kedua view
-- TIDAK berubah, jadi CREATE OR REPLACE cukup dan turunannya (termasuk
-- kso_asset_produktivitas_mv & kso_tren_bulanan_v) tak perlu dibuat ulang.

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
          WHERE a_1.account_id IS NOT NULL
        ), tes AS (
         SELECT kso_asset_test_monthly.asset_id,
            sum(kso_asset_test_monthly.jumlah_tes) AS total_tes,
            count(*) AS bulan_terlapor,
            avg(kso_asset_test_monthly.jumlah_tes) AS rata_tes_bulanan
           FROM kso_asset_test_monthly
          GROUP BY kso_asset_test_monthly.asset_id
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
         SELECT a_1.account_id,
            m.periode,
            sum(m.jumlah_tes) AS tes
           FROM kso_asset a_1
             JOIN kso_asset_test_monthly m ON m.asset_id = a_1.id
             CROSS JOIN jendela_banding j
          WHERE a_1.account_id IS NOT NULL AND m.periode >= j.dari AND m.periode <= j.sampai
          GROUP BY a_1.account_id, m.periode
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
                    ELSE sc.n::numeric / sum(sc.n) OVER (PARTITION BY sc.account_id)::numeric
                END AS porsi_kso
           FROM ( SELECT a_1.account_id,
                    a_1.skema,
                    count(*)::integer AS n,
                    COALESCE(sum(t_1.total_tes), 0::numeric) AS tes
                   FROM kso_asset a_1
                     LEFT JOIN tes t_1 ON t_1.asset_id = a_1.id
                  WHERE a_1.account_id IS NOT NULL AND (a_1.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text]))
                  GROUP BY a_1.account_id, a_1.skema) sc
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
         SELECT a_1.account_id,
            a_1.skema,
            count(*)::integer AS n,
            sum(t_1.total_tes) AS total_tes_seskema
           FROM kso_asset a_1
             LEFT JOIN tes t_1 ON t_1.asset_id = a_1.id
          WHERE a_1.account_id IS NOT NULL
          GROUP BY a_1.account_id, a_1.skema
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
    t.total_tes,
    t.bulan_terlapor,
    t.rata_tes_bulanan,
        CASE
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
          WHERE b_1.account_id = a.account_id AND b_1.skema <> a.skema AND (b_1.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])))) AS revenue_tumpang_tindih
   FROM aset a
     LEFT JOIN tes t ON t.asset_id = a.id
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
         SELECT a.account_id,
            a.skema,
            m.periode,
            sum(m.jumlah_tes) AS jumlah_tes,
            count(DISTINCT a.id)::integer AS alat_lapor
           FROM kso_asset_test_monthly m
             JOIN kso_asset a ON a.id = m.asset_id
          WHERE a.account_id IS NOT NULL AND (a.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])) AND m.jumlah_tes IS NOT NULL
          GROUP BY a.account_id, a.skema, m.periode
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
