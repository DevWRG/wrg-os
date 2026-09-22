-- 185 — Snapshot terwujud untuk produktivitas aset KSO.
--
-- MASALAH. `kso_asset_produktivitas_v` menghasilkan 524 baris tapi butuh
-- 122 DETIK di prod, dan dihitung ulang tiap kali halaman /kso-produktivitas
-- dibuka (juga dipakai /accounts-nya menu Executive dan export XLSX).
-- Biayanya bukan jumlah baris melainkan rantai view di bawahnya yang membaca
-- kolom `raw` jsonb: `accurate_invoice` punya TOAST 199 MB di atas heap 3,4 MB
-- dan `accurate_invoice_item` 141 MB di atas 3,9 MB, sementara shared_buffers
-- prod cuma 128 MB — jadi tiap perhitungan ulang berarti ratusan ribu
-- pembacaan acak ke TOAST. Terukur per simpul: kso_faskes_reagen_v 20 dtk,
-- kso_penagihan_tes_v 38 dtk, kso_customer_revenue_v 50 dtk.
--
-- KENAPA SNAPSHOT, BUKAN MENULIS ULANG VIEW-NYA. Dua view di rantai itu cuma
-- butuh SATU field dari jsonb (`charField1` = kategori pengadaan), jadi sempat
-- terpikir mengambilnya dari `accurate_invoice_item` yang sudah berbentuk
-- tabel. Itu DITOLAK setelah diperiksa: ekspansi `raw->'detailItem'`
-- menghasilkan 31.899 baris sedangkan tabel item punya 31.940 — 9 faktur
-- berbeda, selisih 41 baris. Kecil, tapi cukup untuk menggeser angka revenue
-- tanpa ada yang sadar. Snapshot tidak mengubah satu pun perhitungan: isinya
-- menurut definisi persis keluaran view-nya.
--
-- KESEGARAN. Bukan trade-off yang sesungguhnya: sumber datanya sendiri cuma
-- berubah saat sinkron Accurate (hari kerja 6×, cron 10/12/14/16/18/20).
-- Refresh ditempelkan tepat sesudah sinkron itu di apps/api/src/scheduler.ts,
-- jadi snapshot ini sama segarnya dengan data yang mendasarinya.
--
-- Indeks unik WAJIB ada supaya REFRESH bisa CONCURRENTLY — tanpa itu refresh
-- mengunci pembacaan selama ~2 menit tiap kali, yang justru memindahkan
-- masalahnya alih-alih menyelesaikannya. asset_id sudah terbukti unik
-- (524 dari 524 baris).
CREATE MATERIALIZED VIEW IF NOT EXISTS kso_asset_produktivitas_mv AS
  SELECT * FROM kso_asset_produktivitas_v;

CREATE UNIQUE INDEX IF NOT EXISTS kso_asset_produktivitas_mv_asset_id_idx
  ON kso_asset_produktivitas_mv (asset_id);

-- GRANT eksplisit. `ALTER DEFAULT PRIVILEGES` di migrasi 039 semestinya sudah
-- mencakup objek baru (materialized view ikut kategori TABLES), tapi ia hanya
-- berlaku untuk objek yang dibuat oleh role yang dulu menjalankannya. Ditulis
-- lagi di sini supaya tak bergantung pada itu: view aslinya memang punya grant
-- ke wrg_app & wrg_readonly, dan kalau snapshot ini tak punya, aplikasi
-- langsung kena `permission denied` begitu kode diarahkan ke sini.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT ON kso_asset_produktivitas_mv TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_asset_produktivitas_mv TO wrg_readonly;
  END IF;
END $$;
