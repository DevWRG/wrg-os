-- 197 — Status alat KSO dari SATU aturan, dipakai menu Daftar Alat dan
-- Produktivitas KSO.
--
-- MASALAH. Tidak ada definisi "alat operasional". Produktivitas KSO kebetulan
-- benar per Okt 2026 karena dua efek samping:
--   · alat stok kantor sudah dinonaktifkan tangan (`aktif` tak pernah ditulis
--     kode mana pun — lihat 195);
--   · alat BACKUP / NOT READY berskema UNKNOWN (STATUS-nya bukan jenis skema),
--     sehingga terbuang oleh INNER JOIN kategori_skema.
-- Efek kedua runtuh begitu alat yang sama juga muncul di tab 2026 KSO Tes /
-- Reagent: skemanya lalu terisi dari tab itu, dan alat backup ikut dihitung
-- produktivitasnya. Menu Daftar Alat (keputusan user 6 Okt 2026) butuh status
-- yang sama, plus KETERANGAN dari mana status itu berasal.
--
-- ATURAN (urutan = prioritas; yang pertama cocok menang):
--   stok_kantor  kolom Customer di sheet Populasi berawalan "STOK KANTOR"
--   backup       STATUS atau Keterangan = BACKUP
--   not_ready    STATUS atau Keterangan berawalan NOT READY
--   nonaktif     aktif = false (ditandai manual: alat tak beroperasi)
--   operasional  skema PER_TEST / BELI_REAGEN
--   perlu_cek    selain itu (STATUS kosong/tak dikenal, mis. MCU)
-- Lokasi/kondisi didahulukan dari `aktif`: keenam alat "STOK KANTOR READY"
-- semuanya aktif=false, dan "stok kantor" jauh lebih informatif dari "nonaktif".
--
-- Dampak diukur di prod 6 Okt 2026: 545 operasional · 46 perlu cek · 13 nonaktif ·
-- 1 backup · 1 not ready. Isi Produktivitas KSO TIDAK berubah (531 aset): aturan
-- ini mengunci perilaku yang sekarang benar secara kebetulan.

CREATE OR REPLACE FUNCTION kso_asset_status_kode(a kso_asset) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN a.customer_raw ~* '^\s*stok\s+kantor' THEN 'stok_kantor'
    WHEN upper(btrim(coalesce(a.status_sheet, ''))) = 'BACKUP'
      OR upper(btrim(coalesce(a.keterangan, ''))) = 'BACKUP' THEN 'backup'
    WHEN coalesce(a.status_sheet, '') ~* '^\s*not\s*ready'
      OR coalesce(a.keterangan, '') ~* '^\s*not\s*ready' THEN 'not_ready'
    WHEN NOT a.aktif THEN 'nonaktif'
    WHEN a.skema IN ('PER_TEST', 'BELI_REAGEN') THEN 'operasional'
    ELSE 'perlu_cek'
  END
$$;

COMMENT ON FUNCTION kso_asset_status_kode(kso_asset) IS
  'Status alat KSO (migrasi 197). SATU-SATUNYA definisi "operasional" — dipakai kso_asset_status_v dan kso_asset_produktivitas_v.';

-- Status + kalimat SUMBER-nya. Kalimat sumber menyebut kolom & nilai mentah dari
-- sheet, supaya yang membaca tahu harus membetulkan di mana — di sheet, bukan di
-- aplikasi.
CREATE OR REPLACE VIEW kso_asset_status_v AS
SELECT
  a.id,
  s.kode AS status_kode,
  CASE s.kode
    WHEN 'operasional' THEN 'Operasional'
    WHEN 'stok_kantor' THEN 'Stok kantor'
    WHEN 'backup'      THEN 'Backup'
    WHEN 'not_ready'   THEN 'Not ready'
    WHEN 'nonaktif'    THEN 'Nonaktif'
    ELSE 'Perlu dicek'
  END AS status_label,
  CASE s.kode
    WHEN 'stok_kantor' THEN format('Kolom Customer di sheet Populasi Alat: "%s"', btrim(a.customer_raw))
    WHEN 'backup' THEN
      CASE WHEN upper(btrim(coalesce(a.status_sheet, ''))) = 'BACKUP'
        THEN format('Kolom STATUS di sheet Populasi Alat: "%s"', btrim(a.status_sheet))
        ELSE format('Kolom Keterangan di sheet Populasi Alat: "%s"', btrim(a.keterangan)) END
    WHEN 'not_ready' THEN
      CASE WHEN coalesce(a.status_sheet, '') ~* '^\s*not\s*ready'
        THEN format('Kolom STATUS di sheet Populasi Alat: "%s"', btrim(a.status_sheet))
        ELSE format('Kolom Keterangan di sheet Populasi Alat: "%s"', btrim(a.keterangan)) END
    WHEN 'nonaktif' THEN 'Ditandai tidak beroperasi di WRG OS (kolom aktif, diubah manual)'
    WHEN 'operasional' THEN
      CASE
        WHEN upper(btrim(coalesce(a.status_sheet, ''))) IN ('PER TEST', 'PERTES', 'BELI REAGEN')
          THEN format('Kolom STATUS di sheet Populasi Alat: "%s"', btrim(a.status_sheet))
        WHEN a.sumber_sheet && ARRAY['2026 KSO Tes', '2026 KSO Reagent']
          THEN 'Tercatat di tab realisasi ' || array_to_string(
                 ARRAY(SELECT x FROM unnest(a.sumber_sheet) x WHERE x LIKE '2026 KSO%'), ' & ')
        ELSE 'Skema tercatat di WRG OS: ' || a.skema
      END
    ELSE coalesce(nullif(btrim(a.catatan_sync), ''),
                  CASE WHEN a.status_sheet IS NULL
                    THEN 'Kolom STATUS kosong di sheet Populasi Alat dan alat tidak ada di tab realisasi 2026'
                    ELSE format('Kolom STATUS di sheet Populasi Alat berisi "%s" — bukan skema yang dikenal', btrim(a.status_sheet)) END)
  END AS status_sumber,
  s.kode = 'operasional' AS operasional,
  -- Sama persis dengan syarat baris di kso_asset_produktivitas_v (aset CTE).
  s.kode = 'operasional' AND a.account_id IS NOT NULL AS masuk_produktivitas,
  array_remove(ARRAY[
    CASE WHEN NOT a.in_populasi THEN 'Belum tercatat di sheet Populasi Alat' END,
    CASE WHEN s.kode = 'operasional' AND a.account_id IS NULL
      THEN 'Faskes belum dicocokkan ke customer Accurate — tidak masuk Produktivitas KSO' END,
    CASE WHEN a.pemilik_alat IS NULL THEN 'Pemilik alat belum diisi' END,
    CASE WHEN s.kode <> 'perlu_cek' AND nullif(btrim(a.catatan_sync), '') IS NOT NULL
      THEN 'Catatan sinkronisasi: ' || btrim(a.catatan_sync) END
  ], NULL) AS penanda
FROM kso_asset a
CROSS JOIN LATERAL (SELECT kso_asset_status_kode(a) AS kode) s;

COMMENT ON VIEW kso_asset_status_v IS
  'Status alat KSO + sumbernya (migrasi 197). Dibaca menu /kso-alat.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT ON kso_asset_status_v TO wrg_app;
    GRANT EXECUTE ON FUNCTION kso_asset_status_kode(kso_asset) TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_asset_status_v TO wrg_readonly;
    GRANT EXECUTE ON FUNCTION kso_asset_status_kode(kso_asset) TO wrg_readonly;
  END IF;
END $$;

-- Produktivitas: EMPAT dari lima syarat `aktif` di 195 diganti status =
-- 'operasional' — daftar aset (CTE aset), alat seskema & tes customer
-- (seskema), porsi revenue (porsi), dan tanda tumpang-tindih.
--
-- PENGECUALIAN SENGAJA: CTE `periode_sheet` tetap memakai `aktif`. Ia
-- menjumlah tes yang DILAPORKAN faskes untuk dibandingkan dengan tes yang
-- DITAGIHKAN di Accurate (rasio tagih/lapor). Tes yang terjadi di alat
-- berlabel backup tetap tes yang terjadi: RSUD Kab. Sampang punya K Lyte 5
-- (SN DJ02D24100003) ber-STATUS "BACKUP" yang melaporkan 703 tes. Membuangnya
-- menurunkan "tes dilaporkan" Sampang dari 894 ke 191 dan membuat rasio
-- penagihannya salah.
--
-- Kolom keluaran tak berubah ⇒ CREATE OR REPLACE cukup, MV tidak dibuat ulang;
-- snapshot ikut terbarui pada refresh terjadwal berikutnya (kso-mv refresh).
-- Diuji pada salinan prod 6 Okt 2026: isi view identik baris-demi-baris (531).
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
          WHERE a_1.account_id IS NOT NULL AND kso_asset_status_kode(a_1) = 'operasional'
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
          WHERE a_1.account_id IS NOT NULL AND a_1.aktif AND m.periode >= j.dari AND m.periode <= j.sampai
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
                  WHERE a_1.account_id IS NOT NULL AND kso_asset_status_kode(a_1) = 'operasional' AND (a_1.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text]))
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
          WHERE a_1.account_id IS NOT NULL AND kso_asset_status_kode(a_1) = 'operasional'
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
          WHERE b_1.account_id = a.account_id AND kso_asset_status_kode(b_1) = 'operasional' AND b_1.skema <> a.skema AND (b_1.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])))) AS revenue_tumpang_tindih
   FROM aset a
     LEFT JOIN tes t ON t.asset_id = a.id
     LEFT JOIN rev ON rev.account_id = a.account_id AND rev.skema = a.skema
     LEFT JOIN seskema s ON s.account_id = a.account_id AND s.skema = a.skema
     LEFT JOIN banding b ON b.account_id = a.account_id
     LEFT JOIN faktur_customer fc ON fc.account_id = a.account_id;
