-- 217 — F169 Riwayat penempatan alat KSO (faskes-minded).
--
-- MASALAH. kso_asset cuma punya SATU account_id. Saat alat pindah faskes, seluruh
-- riwayat tesnya ikut ke faskes baru — faskes lama kehilangan tes yang benar-benar
-- terjadi di sana, dan rasio tagih/lapor + porsi KSO kedua faskes meleset. Okt 2026
-- tiga alat terpaksa "dikunci" di faskes lama (migrasi 196) sebagai tambalan, dan
-- impor 13 Okt membawa empat pindahan lagi.
--
-- MODEL. Satu baris kso_asset_penempatan = satu periode alat berada di satu faskes:
--   mulai   = hari pertama alat di faskes itu (TGL SJ). NULL = sejak awal tercatat,
--             tanggal masuknya tak diketahui (semua isian awal migrasi ini).
--   selesai = hari pertama alat SUDAH TIDAK di sana (eksklusif). NULL = masih di sana.
-- Tarik ke gudang = pindah ke penempatan ber-account_id NULL dengan customer
-- "STOK KANTOR …" — pola yang sama dengan sheet Populasi Alat, jadi
-- kso_asset_status_kode (197) otomatis membacanya sebagai stok kantor.
--
-- kso_asset.account_id / customer_raw TETAP ADA sebagai "lokasi sekarang" (dibaca
-- puluhan query). Sinkronnya satu arah per jalur:
--   · pindah  → HANYA lewat kso_pindahkan_alat(): tutup penempatan lama, buka yang
--               baru, lalu salin lokasi baru ke kso_asset.
--   · koreksi → UPDATE kso_asset biasa (importer ganti ejaan nama, kso-account-match
--               mengisi account_id) diteruskan trigger ke penempatan yang SEDANG
--               terbuka. Itu membetulkan identitas tempat alat berada, bukan pindah.
--
-- ATRIBUSI TES. Tes bulanan (sheet teknisi, per SN) dimiliki penempatan yang paling
-- banyak harinya di bulan itu; seri → penempatan yang lebih baru. Tanpa riwayat
-- (setiap alat satu penempatan terbuka sejak awal) hasilnya IDENTIK dengan sebelum
-- migrasi ini — diuji dengan diff keluaran view pada salinan data prod 13 Okt 2026.
-- Revenue tidak perlu diatribusi: faktur Accurate memang terbit atas nama faskes.
--
-- Tumpang tindih periode ditolak trigger (bukan EXCLUDE constraint, supaya tak
-- butuh ekstensi btree_gist dan pesan galatnya bisa dibaca tim KSO).

CREATE TABLE IF NOT EXISTS kso_asset_penempatan (
  id            bigserial PRIMARY KEY,
  asset_id      bigint NOT NULL REFERENCES kso_asset(id) ON DELETE CASCADE,
  account_id    bigint REFERENCES accurate_customer(id) ON DELETE SET NULL,
  customer_raw  text NOT NULL,
  mulai         date,
  selesai       date,
  sumber        text NOT NULL CHECK (sumber IN ('awal', 'sheet', 'manual', 'sistem')),
  catatan       text,
  dicatat_oleh  text NOT NULL DEFAULT 'sistem',
  dicatat_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kso_penempatan_urut CHECK (mulai IS NULL OR selesai IS NULL OR selesai > mulai)
);

CREATE UNIQUE INDEX IF NOT EXISTS kso_penempatan_satu_terbuka
  ON kso_asset_penempatan (asset_id) WHERE selesai IS NULL;
CREATE INDEX IF NOT EXISTS kso_penempatan_account_idx
  ON kso_asset_penempatan (account_id) WHERE account_id IS NOT NULL;

COMMENT ON TABLE kso_asset_penempatan IS
  'Riwayat lokasi alat KSO per faskes (migrasi 217). Pindah HANYA lewat kso_pindahkan_alat().';

CREATE OR REPLACE FUNCTION kso_penempatan_rentang(p_mulai date, p_selesai date) RETURNS daterange
LANGUAGE sql IMMUTABLE AS $$
  SELECT daterange(coalesce(p_mulai, '-infinity'::date), coalesce(p_selesai, 'infinity'::date), '[)')
$$;

CREATE OR REPLACE FUNCTION kso_penempatan_cek_tumpang() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  bentrok kso_asset_penempatan;
BEGIN
  SELECT * INTO bentrok FROM kso_asset_penempatan p
   WHERE p.asset_id = NEW.asset_id AND p.id <> NEW.id
     AND kso_penempatan_rentang(p.mulai, p.selesai) && kso_penempatan_rentang(NEW.mulai, NEW.selesai)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Periode penempatan alat bertumpuk dengan penempatan #% (% s/d %) di "%".',
      bentrok.id, coalesce(bentrok.mulai::text, 'awal'), coalesce(bentrok.selesai::text, 'sekarang'),
      bentrok.customer_raw
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS kso_penempatan_cek_tumpang ON kso_asset_penempatan;
CREATE TRIGGER kso_penempatan_cek_tumpang
  BEFORE INSERT OR UPDATE OF asset_id, mulai, selesai ON kso_asset_penempatan
  FOR EACH ROW EXECUTE FUNCTION kso_penempatan_cek_tumpang();

-- Isian awal: satu penempatan terbuka per alat, dari lokasi yang tercatat sekarang.
INSERT INTO kso_asset_penempatan (asset_id, account_id, customer_raw, mulai, selesai, sumber, catatan)
SELECT a.id, a.account_id, a.customer_raw, NULL, NULL, 'awal',
       'Lokasi saat riwayat mulai dicatat (migrasi 217); tanggal masuk tak diketahui.'
  FROM kso_asset a
 WHERE NOT EXISTS (SELECT 1 FROM kso_asset_penempatan p WHERE p.asset_id = a.id);

-- Alat baru → penempatan terbuka. Importer boleh mengisi `mulai` (TGL SJ) sesudahnya.
CREATE OR REPLACE FUNCTION kso_asset_penempatan_baru() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO kso_asset_penempatan (asset_id, account_id, customer_raw, sumber, catatan)
  VALUES (NEW.id, NEW.account_id, NEW.customer_raw, 'sistem', 'Alat baru tercatat.');
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS kso_asset_penempatan_baru ON kso_asset;
CREATE TRIGGER kso_asset_penempatan_baru
  AFTER INSERT ON kso_asset
  FOR EACH ROW EXECUTE FUNCTION kso_asset_penempatan_baru();

-- Koreksi identitas lokasi sekarang (bukan pindah) → penempatan terbuka ikut.
-- Dilewati saat kso_pindahkan_alat() sendiri yang menulis kso_asset.
CREATE OR REPLACE FUNCTION kso_asset_penempatan_sinkron() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('wrg.kso_penempatan_pindah', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.customer_raw IS NOT DISTINCT FROM OLD.customer_raw
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NULL;
  END IF;
  UPDATE kso_asset_penempatan
     SET customer_raw = NEW.customer_raw, account_id = NEW.account_id
   WHERE asset_id = NEW.id AND selesai IS NULL;
  IF NOT FOUND THEN
    -- Alat yang penempatan terakhirnya sudah ditutup tapi lalu diberi lokasi lewat
    -- UPDATE biasa: buka penempatan baru mulai hari ini daripada diam-diam hilang.
    INSERT INTO kso_asset_penempatan (asset_id, account_id, customer_raw, mulai, sumber, catatan)
    VALUES (NEW.id, NEW.account_id, NEW.customer_raw,
            greatest(current_date, (SELECT max(selesai) FROM kso_asset_penempatan WHERE asset_id = NEW.id)),
            'sistem', 'Lokasi diisi lewat pembaruan data alat, bukan lewat pencatatan pindah.');
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS kso_asset_penempatan_sinkron ON kso_asset;
CREATE TRIGGER kso_asset_penempatan_sinkron
  AFTER UPDATE OF customer_raw, account_id ON kso_asset
  FOR EACH ROW EXECUTE FUNCTION kso_asset_penempatan_sinkron();

-- Satu-satunya jalur PINDAH (dipakai menu, importer, dan skrip ops).
-- p_tanggal = hari pertama alat di lokasi baru (TGL SJ).
CREATE OR REPLACE FUNCTION kso_pindahkan_alat(
  p_asset_id bigint, p_customer_raw text, p_account_id bigint, p_tanggal date,
  p_sumber text, p_catatan text, p_oleh text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  buka kso_asset_penempatan;
  id_baru bigint;
BEGIN
  IF p_tanggal IS NULL THEN
    RAISE EXCEPTION 'Tanggal pindah wajib diisi.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_tanggal > current_date THEN
    RAISE EXCEPTION 'Tanggal pindah (%) belum terjadi.', p_tanggal USING ERRCODE = 'check_violation';
  END IF;
  IF nullif(btrim(p_customer_raw), '') IS NULL THEN
    RAISE EXCEPTION 'Lokasi tujuan wajib diisi.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM kso_asset WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alat #% tidak ditemukan.', p_asset_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO buka FROM kso_asset_penempatan
   WHERE asset_id = p_asset_id AND selesai IS NULL;
  IF FOUND THEN
    IF buka.mulai IS NOT NULL AND p_tanggal <= buka.mulai THEN
      RAISE EXCEPTION 'Tanggal pindah (%) harus sesudah tanggal alat masuk ke "%" (%).',
        p_tanggal, buka.customer_raw, buka.mulai USING ERRCODE = 'check_violation';
    END IF;
    IF buka.account_id IS NOT DISTINCT FROM p_account_id
       AND upper(btrim(buka.customer_raw)) = upper(btrim(p_customer_raw)) THEN
      RAISE EXCEPTION 'Alat sudah berada di "%".', buka.customer_raw USING ERRCODE = 'check_violation';
    END IF;
    UPDATE kso_asset_penempatan SET selesai = p_tanggal WHERE id = buka.id;
  ELSIF EXISTS (SELECT 1 FROM kso_asset_penempatan
                 WHERE asset_id = p_asset_id AND selesai > p_tanggal) THEN
    RAISE EXCEPTION 'Alat sudah punya riwayat sesudah %.', p_tanggal USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO kso_asset_penempatan (asset_id, account_id, customer_raw, mulai, sumber, catatan, dicatat_oleh)
  VALUES (p_asset_id, p_account_id, btrim(p_customer_raw), p_tanggal, p_sumber,
          nullif(btrim(p_catatan), ''), coalesce(nullif(btrim(p_oleh), ''), 'sistem'))
  RETURNING id INTO id_baru;

  PERFORM set_config('wrg.kso_penempatan_pindah', 'on', true);
  UPDATE kso_asset SET customer_raw = btrim(p_customer_raw), account_id = p_account_id, updated_at = now()
   WHERE id = p_asset_id;
  PERFORM set_config('wrg.kso_penempatan_pindah', '', true);
  RETURN id_baru;
END $$;

-- Batalkan pindah terakhir yang salah catat: hapus penempatan terbuka, buka lagi
-- penempatan sebelumnya. Hanya untuk catatan pindah (sheet/manual), bukan isian awal.
CREATE OR REPLACE FUNCTION kso_batalkan_pindah(p_asset_id bigint) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  buka kso_asset_penempatan;
  lama kso_asset_penempatan;
BEGIN
  PERFORM 1 FROM kso_asset WHERE id = p_asset_id FOR UPDATE;
  SELECT * INTO buka FROM kso_asset_penempatan WHERE asset_id = p_asset_id AND selesai IS NULL;
  IF NOT FOUND OR buka.sumber NOT IN ('sheet', 'manual') THEN
    RAISE EXCEPTION 'Tidak ada catatan pindah yang bisa dibatalkan untuk alat ini.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO lama FROM kso_asset_penempatan
   WHERE asset_id = p_asset_id AND selesai = buka.mulai;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Penempatan sebelum % tidak ditemukan.', buka.mulai USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM kso_asset_penempatan WHERE id = buka.id;
  UPDATE kso_asset_penempatan SET selesai = NULL WHERE id = lama.id;
  PERFORM set_config('wrg.kso_penempatan_pindah', 'on', true);
  UPDATE kso_asset SET customer_raw = lama.customer_raw, account_id = lama.account_id, updated_at = now()
   WHERE id = p_asset_id;
  PERFORM set_config('wrg.kso_penempatan_pindah', '', true);
  RETURN lama.id;
END $$;

-- Tes bulanan + penempatan pemiliknya. SATU-SATUNYA tempat aturan atribusi bulan:
-- penempatan dengan hari terbanyak di bulan itu; seri → yang lebih baru. Bulan di
-- luar semua penempatan (laporan sebelum TGL SJ — salah isi sheet) jatuh ke
-- penempatan paling awal supaya tes tak hilang tanpa jejak.
CREATE OR REPLACE VIEW kso_tes_lokasi_v AS
SELECT m.asset_id,
       m.periode,
       m.jumlah_tes,
       m.sumber_sheet,
       p.id AS penempatan_id,
       p.account_id
  FROM kso_asset_test_monthly m
  LEFT JOIN LATERAL (
    SELECT p.id, p.account_id
      FROM kso_asset_penempatan p
      CROSS JOIN LATERAL (
        SELECT kso_penempatan_rentang(p.mulai, p.selesai)
               * daterange(m.periode, (m.periode + interval '1 month')::date, '[)') AS r
      ) x
     WHERE p.asset_id = m.asset_id
     ORDER BY nullif(upper(x.r) - lower(x.r), 0) DESC NULLS LAST,
              CASE WHEN isempty(x.r) THEN p.mulai END ASC NULLS FIRST,
              p.mulai DESC NULLS LAST
     LIMIT 1
  ) p ON true;

COMMENT ON VIEW kso_tes_lokasi_v IS
  'Tes bulanan sheet per alat + faskes tempat alat berada bulan itu (migrasi 217). Semua view KSO yang menjumlah tes per faskes membaca ini, bukan kso_asset.account_id.';

-- Riwayat untuk menu: satu baris per penempatan + tes yang dilaporkan selama di sana.
CREATE OR REPLACE VIEW kso_penempatan_v AS
SELECT p.id,
       p.asset_id,
       a.sn_key,
       a.sn_raw,
       a.type_alat,
       a.nama_alat,
       a.skema,
       p.account_id,
       c.name AS faskes,
       p.customer_raw,
       p.mulai,
       p.selesai,
       p.selesai IS NULL AS terbuka,
       p.sumber,
       p.catatan,
       p.dicatat_oleh,
       p.dicatat_at,
       t.tes,
       t.bulan_lapor
  FROM kso_asset_penempatan p
  JOIN kso_asset a ON a.id = p.asset_id
  LEFT JOIN accurate_customer c ON c.id = p.account_id
  LEFT JOIN (
    SELECT tl.penempatan_id, sum(tl.jumlah_tes) AS tes, count(tl.jumlah_tes)::integer AS bulan_lapor
      FROM kso_tes_lokasi_v tl GROUP BY tl.penempatan_id
  ) t ON t.penempatan_id = p.id;

COMMENT ON VIEW kso_penempatan_v IS 'Riwayat penempatan alat KSO + tes selama di lokasi itu (migrasi 217).';

-- ── View yang menjumlah tes per faskes: account_id dari penempatan, bukan dari
-- lokasi alat sekarang. Kolom keluaran TIDAK berubah (kso_asset_produktivitas_mv
-- bergantung padanya; CREATE OR REPLACE mempertahankan GRANT — jangan DROP).
--
-- kso_asset_produktivitas_v: CTE `tes` kini per (alat, faskes). Baris per alat
-- memakai tes selama alat di faskes SEKARANG; total per faskes (seskema, porsi)
-- ikut menghitung alat yang sudah pindah, lewat CTE `pasangan` (sekarang=false),
-- tanpa menambah jumlah alat (n). Pembagi porsi diberi NULLIF: faskes yang cuma
-- punya alat-pernah-di-sini bernilai n=0.
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
                  WHERE (ps.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text]))
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
            sum(t_1.total_tes) AS total_tes_seskema
           FROM pasangan ps
             LEFT JOIN tes t_1 ON t_1.asset_id = ps.asset_id AND t_1.account_id = ps.account_id
          GROUP BY ps.account_id, ps.skema
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
          WHERE b_1.account_id = a.account_id AND kso_asset_status_kode(b_1.*) = 'operasional'::text AND b_1.skema <> a.skema AND (b_1.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])))) AS revenue_tumpang_tindih
   FROM aset a
     LEFT JOIN tes t ON t.asset_id = a.id AND t.account_id = a.account_id
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
          WHERE m.account_id IS NOT NULL AND (a.skema = ANY (ARRAY['PER_TEST'::text, 'BELI_REAGEN'::text])) AND m.jumlah_tes IS NOT NULL
          GROUP BY m.account_id, a.skema, m.periode
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
            count(*) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM kso_asset_test_monthly m
                     CROSS JOIN jendela j
                  WHERE m.asset_id = a.id AND m.periode >= j.dari AND m.periode <= j.sampai)))::integer AS aset_melapor,
            count(DISTINCT a.account_id)::integer AS customer
           FROM kso_asset a
          WHERE a.account_id IS NOT NULL
          GROUP BY (kso_jenis_kanonik(a.type_alat))
        ), tes AS (
         SELECT kso_jenis_kanonik(a.type_alat) AS jenis,
            sum(m.jumlah_tes)::bigint AS tes
           FROM kso_tes_lokasi_v m
             JOIN kso_asset a ON a.id = m.asset_id
             CROSS JOIN jendela j
          WHERE m.account_id IS NOT NULL AND m.periode >= j.dari AND m.periode <= j.sampai
          GROUP BY (kso_jenis_kanonik(a.type_alat))
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
                          WHERE m.account_id IS NOT NULL) x
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON kso_asset_penempatan TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE kso_asset_penempatan_id_seq TO wrg_app;
    GRANT SELECT ON kso_tes_lokasi_v, kso_penempatan_v TO wrg_app;
    GRANT EXECUTE ON FUNCTION kso_pindahkan_alat(bigint, text, bigint, date, text, text, text),
                              kso_batalkan_pindah(bigint),
                              kso_penempatan_rentang(date, date) TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_asset_penempatan, kso_tes_lokasi_v, kso_penempatan_v TO wrg_readonly;
    GRANT EXECUTE ON FUNCTION kso_penempatan_rentang(date, date) TO wrg_readonly;
  END IF;
END $$;
