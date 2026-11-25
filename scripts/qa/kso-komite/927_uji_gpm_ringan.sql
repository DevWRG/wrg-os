-- Uji migrasi 340: penanda HD ringan (kso.app_hd) untuk daftar "Belum lengkap" = kolom hd kso.app_angka_gpm,
-- dan hitung_gpm tetap memakai tambalan 307 (alat baru → zona Direktur). DB UJI saja. Angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';

select uji.cek('hitung_gpm memakai bahan_gpm_model dan tambalan 307 tetap ada',
   (select position('kso.bahan_gpm_model' in d) > 0 and position('Alat belum ada di database' in d) > 0
      and position('kso_bottomline_model_v' in d) = 0
      from (select pg_get_functiondef('kso.hitung_gpm(bigint)'::regprocedure) d) x));

-- satu rencana ber-alat Hemodialisa supaya kedua nilai hd teruji
update kso.rencana_kso set alat_kode = 'HDX' where id = (select max(id) from kso.rencana_kso where not exists
  (select 1 from kso.alat a where a.kode = alat_kode and a.baru));

create table if not exists uji.d927 (k text primary key, v text);
grant all on uji.d927 to wrg_app;
insert into uji.d927 select 'luar_am01', min(id)::text from kso.rencana_kso where am_id <> 'AM-01';

set role wrg_app;
select set_config('wrg.kso_user', 'u-kom', false), set_config('wrg.kso_peran', 'komite', false), set_config('wrg.kso_ref', '', false);
select uji.cek('app_hd = hd app_angka_gpm untuk semua rencana (termasuk alat baru & alat tanpa peta)',
   (select count(*) > 0 and bool_and(kso.app_hd(r.id) is not distinct from (select g.hd from kso.app_angka_gpm(r.id) g))
      from kso.rencana_kso r));
select uji.cek('app_hd menandai rencana Hemodialisa',
   (select bool_or(kso.app_hd(r.id)) from kso.rencana_kso r));
select set_config('wrg.kso_user', 'u-am', false), set_config('wrg.kso_peran', 'am', false), set_config('wrg.kso_ref', 'AM-01', false);
select uji.harus_gagal('app_hd menolak rencana di luar akses AM',
   format($q$select kso.app_hd(%s)$q$, (select v from uji.d927 where k = 'luar_am01')), 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('Aplikasi tak bisa memanggil bahan_gpm_model langsung',
   $q$select * from kso.bahan_gpm_model('M-Z3')$q$, 'permission denied');
reset role;
