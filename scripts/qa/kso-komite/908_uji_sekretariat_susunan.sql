-- Uji migrasi 241 (peran Sekretaris + pencocokan PKS + Susunan Komite). DB UJI saja, sesudah 900–907.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d908 (k text primary key, v bigint);
grant all on uji.d908 to wrg_app;

-- dua rencana dengan mandat Direksi yang diketahui (disusun sebagai owner; jalur gerbang sudah diuji 900)
do $$ declare x bigint; y bigint; begin
  x := kso.buat_draft('AM-04','F06','Z52',1,2400,'data LIS 3 bulan',12000,'baru',36,'{draft_rs}','[]');
  y := kso.buat_draft('AM-04','F08','Z3',1,600,'data LIS 3 bulan',18500,'baru',36,'{}','[]');
  update kso.rencana_kso set status = 'MANDAT_TERBIT' where id in (x, y);
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, tenor_maks_bulan, capex_maks, volume_minimum,
                          klausul_dilarang, berlaku_sampai, sumber)
  values (x, 12000, 13500, 36, 80000000, 1920, '{eksklusivitas}', kso.hari_ini() + 30, 'direksi'),
         (y, 18500, 19500, 36, 60000000, 480, '{}', kso.hari_ini() + 30, 'direksi');
  insert into uji.d908 values ('x', x), ('y', y) on conflict (k) do update set v = excluded.v;
end $$;

set role wrg_app;
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000ab', false);
select set_config('wrg.kso_peran', 'sekretaris', false);
select set_config('wrg.kso_ref', '', false);

-- 1. antrean & penawaran
select uji.cek('Sekretariat melihat mandat berlaku di antrean Terbitkan Penawaran',
   (select count(*) = 2 from kso.v_antrean where antrean = 'Sekretariat · Terbitkan Penawaran'
     and rencana_id in (select v from uji.d908)));
do $$ begin perform kso.app_terbitkan_penawaran((select v from uji.d908 where k='x'), 13500); end $$;
select uji.cek('Sekretaris bisa menerbitkan penawaran; jejak = sekretaris + orangnya',
   (select oleh = 'sekretaris:a1b2c3d4-0000-0000-0000-0000000000ab' and oleh_peran = 'sekretaris'
      from kso.riwayat_status where rencana_id = (select v from uji.d908 where k='x') and ke = 'PENAWARAN_TERBIT'));
select uji.cek('Sesudah penawaran terbit, rencana pindah ke antrean Cocokkan PKS',
   exists (select 1 from kso.v_antrean where antrean = 'Sekretariat · Cocokkan PKS' and rencana_id = (select v from uji.d908 where k='x')));
select uji.harus_gagal('Sekretaris tidak bisa memutus atas nama Direksi', 'select kso.app_putus_direksi(2,''SETUJU'')', 'PERAN_TIDAK_BERWENANG');

-- 2. PKS dicocokkan penuh — tiap ketidakcocokan ditolak
select uji.harus_gagal('PKS tanpa tenor/volume ditolak',
   format('select kso.app_cocokkan_pks(%s, 12800, null, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat}'')', (select v from uji.d908 where k='x')), 'PKS_TIDAK_LENGKAP');
select uji.harus_gagal('PKS tenor 48 bln > mandat 36 ditolak',
   format('select kso.app_cocokkan_pks(%s, 12800, 48, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat}'')', (select v from uji.d908 where k='x')), 'PKS_TIDAK_COCOK: tenor');
select uji.harus_gagal('PKS volume minimum di bawah mandat ditolak',
   format('select kso.app_cocokkan_pks(%s, 12800, 36, 1500, ''{eskalasi_tahunan,lapor_test,denda_telat}'')', (select v from uji.d908 where k='x')), 'PKS_TIDAK_COCOK: volume');
select uji.harus_gagal('PKS tanpa denda telat bayar ditolak (perlindungan wajib)',
   format('select kso.app_cocokkan_pks(%s, 12800, 36, 1920, ''{eskalasi_tahunan,lapor_test}'')', (select v from uji.d908 where k='x')), 'perlindungan wajib hilang \(denda_telat\)');
select uji.harus_gagal('PKS memuat klausul yang dilarang mandat ditolak',
   format('select kso.app_cocokkan_pks(%s, 12800, 36, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat,eksklusivitas}'')', (select v from uji.d908 where k='x')), 'dilarang mandat');
select uji.harus_gagal('PKS memuat klausul khusus yang tak pernah diusulkan ditolak',
   format('select kso.app_cocokkan_pks(%s, 12800, 36, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat,alat_jatuh}'')', (select v from uji.d908 where k='x')), 'di luar usulan');
select uji.harus_gagal('PKS di bawah batas bawah ditolak',
   format('select kso.app_cocokkan_pks(%s, 11000, 36, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat}'')', (select v from uji.d908 where k='x')), 'KELUAR_MANDAT');
select uji.harus_gagal('Pembungkus lama app_catat_pks (harga saja) sudah dicabut',
   format('select kso.app_catat_pks(%s, 12800)', (select v from uji.d908 where k='x')), 'does not exist');

select set_config('wrg.kso_peran', 'direksi', false);
select uji.harus_gagal('Direksi tidak lagi mencatat PKS (pindah ke Sekretaris)',
   format('select kso.app_cocokkan_pks(%s, 12800, 36, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat}'')', (select v from uji.d908 where k='x')), 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_peran', 'sekretaris', false);

do $$ begin perform kso.app_cocokkan_pks((select v from uji.d908 where k='x'), 12800, 36, 1920, '{eskalasi_tahunan,lapor_test,denda_telat,draft_rs}'); end $$;
select uji.cek('PKS yang cocok dicatat: PKS_TTD + isi PKS tersimpan',
   (select status = 'PKS_TTD' and harga_deal = 12800 and pks_tenor_bulan = 36 and pks_volume_minimum = 1920 and 'draft_rs' = any(pks_klausul)
      from kso.rencana_kso where id = (select v from uji.d908 where k='x')));

-- 3. kalah dicatat Sekretaris
do $$ begin perform kso.app_catat_kalah((select v from uji.d908 where k='y'), 'Kompetitor menawar Rp 17.000/test'); end $$;
select uji.cek('Sekretaris bisa mencatat kalah beserta alasannya',
   (select status = 'KALAH' and risiko_catatan like '%Kompetitor%' from kso.rencana_kso where id = (select v from uji.d908 where k='y')));

-- admin_sales tetap boleh menerbitkan penawaran & mencatat kalah (tab cadangan)
select set_config('wrg.kso_peran', 'admin_sales', false);
select uji.harus_gagal('Admin Sales tidak bisa mencocokkan PKS',
   format('select kso.app_cocokkan_pks(%s, 12800, 36, 1920, ''{eskalasi_tahunan,lapor_test,denda_telat}'')', (select v from uji.d908 where k='x')), 'PERAN_TIDAK_BERWENANG');

-- 4. Susunan Komite: satu pemegang aktif per jabatan, riwayat tersimpan
insert into public.kso_komite_pemegang (jabatan_kode, user_id, mulai, dicatat_oleh) values ('sekretaris_kso', 'u-sek-1', '2026-10-19', 'u-owner');
select uji.harus_gagal('Dua pemegang aktif untuk satu jabatan ditolak',
   'insert into public.kso_komite_pemegang (jabatan_kode, user_id, mulai, dicatat_oleh) values (''sekretaris_kso'', ''u-sek-2'', ''2026-11-01'', ''u-owner'')', 'kso_komite_pemegang_aktif');
update public.kso_komite_pemegang set selesai = '2026-10-31' where jabatan_kode = 'sekretaris_kso' and selesai is null;
insert into public.kso_komite_pemegang (jabatan_kode, user_id, mulai, dicatat_oleh) values ('sekretaris_kso', 'u-sek-2', '2026-11-01', 'u-owner');
select uji.cek('Ganti pemegang: lama ditutup, baru aktif, riwayat dua baris',
   (select count(*) = 2 and count(*) filter (where selesai is null and user_id = 'u-sek-2') = 1
      from public.kso_komite_pemegang where jabatan_kode = 'sekretaris_kso'));
select uji.cek('Jabatan awal hanya label (tanpa nama orang)', (select count(*) = 6 from public.kso_komite_jabatan));
reset role;
