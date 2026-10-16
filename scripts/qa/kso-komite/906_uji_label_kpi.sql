-- Uji migrasi 232 (label sumber volume + KPI tanpa nol palsu). DB UJI saja, sesudah 900–905.
\set ON_ERROR_STOP on
set timezone = 'UTC';
select uji.cek('Label: "data LIS 3 bulan terakhir" → data', kso.tebak_label_sumber('data LIS 3 bulan terakhir, dikirim kepala lab') = 'data');
select uji.cek('Label: "rekap BPJS RS" → data', kso.tebak_label_sumber('rekap BPJS RS Agustus') = 'data');
select uji.cek('Label: "kata pak Budi" → lisan (disimpan mentah, label turunan)', kso.tebak_label_sumber('kata pak Budi') = 'lisan');
select uji.cek('Label: "catatan lisan pengadaan" → lisan', kso.tebak_label_sumber('catatan lisan pengadaan') = 'lisan');
select uji.cek('Label: lisan menang bila keduanya disebut ("data dari obrolan")', kso.tebak_label_sumber('data dari obrolan dengan kepala lab') = 'lisan');
select uji.cek('Label: "menurut data LIS" tetap data', kso.tebak_label_sumber('menurut data LIS') = 'data');
select uji.cek('Label: "belum ada" → belum_ada', kso.tebak_label_sumber('belum ada') = 'belum_ada' and kso.tebak_label_sumber('belum ada data') = 'belum_ada');
select uji.cek('Label: kalimat tak jelas → NULL, bukan ditebak', kso.tebak_label_sumber('dari kunjungan kemarin') is null);
do $$ declare x bigint; begin
  x := kso.buat_draft('AM-02','F02','Z3',1,500,'kata pak Budi',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform uji.cek('Draft baru langsung berlabel dari kalimat AM', (select volume_sumber_label = 'lisan' and volume_sumber = 'kata pak Budi' from kso.rencana_kso where id = x));
  perform kso.lengkapi_draft(x, '{"volume_sumber":"data LIS 3 bulan"}');
  perform uji.cek('Sumber diubah AM → label ikut diperbarui', (select volume_sumber_label = 'data' from kso.rencana_kso where id = x));
  update kso.rencana_kso set volume_sumber_label = 'lisan', volume_sumber_label_manual = true where id = x;
  perform kso.lengkapi_draft(x, '{"volume_sumber":"data LIS 6 bulan"}');
  perform uji.cek('Label yang dikoreksi manusia tidak ditimpa mesin', (select volume_sumber_label = 'lisan' from kso.rencana_kso where id = x));
end $$;
-- KPI: AM yang usulannya tak satu pun berlabel → "belum ada data" (NULL), bukan 0%
update kso.rencana_kso set volume_sumber = 'dari kunjungan kemarin', volume_sumber_label = null where am_id = 'AM-04';
select uji.cek('KPI: AM tanpa usulan berlabel → sumber_data_persen NULL, bukan 0',
   coalesce((select bool_and(sumber_data_persen is null) from kso.v_kpi_am where am_id = 'AM-04'), true));
select uji.cek('KPI: AM yang berlabel tetap terhitung', (select bool_or(sumber_data_persen is not null) from kso.v_kpi_am where am_id <> 'AM-04'));
select uji.cek('KPI: capex terverifikasi & akurasi bulan-6 NULL bila belum ada verifikasi (bukan 0)',
   (select bool_and((capex_terverifikasi is null) = (akurasi_volume_median is null)) from kso.v_kpi_am));
