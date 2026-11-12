-- Uji migrasi 312: SPH KSO — kso.app_catat_sph sesudah kso.app_terbitkan_penawaran (issue #2297).
-- Peran Sekretaris / Admin Sales, status PENAWARAN_TERBIT, harga ≥ lantai, snapshot isi surat, nomor unik, RLS baca.
-- DB UJI saja, sesudah 900–922. Nama & angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d923 (k text primary key, v text);
grant all on uji.d923 to wrg_app;

-- rencana dengan mandat yang masih berlaku dan belum diterbitkan penawarannya
insert into uji.d923
select 'r', r.id::text from kso.rencana_kso r join kso.mandat m on m.rencana_id = r.id
 where r.status in ('DIPUTUS_AM','DIPUTUS_HOD','MANDAT_TERBIT') and m.berlaku_sampai >= kso.hari_ini()
 order by r.id limit 1;
select uji.cek('Ada rencana bermandat untuk diuji', exists (select 1 from uji.d923 where k = 'r'));
insert into uji.d923 select 'lantai', harga_lantai::text from kso.mandat where rencana_id = (select v::bigint from uji.d923 where k = 'r');

-- 1. sebelum penawaran terbit: SPH ditolak
set role wrg_app;
select set_config('wrg.kso_user', 'u-sek', false), set_config('wrg.kso_peran', 'sekretaris', false), set_config('wrg.kso_ref', '', false);
select uji.harus_gagal('SPH sebelum penawaran terbit ditolak',
   format($q$select kso.app_catat_sph(%s, '00001/UJI/XI/2026', 999999, null, 'Direktur Fiktif', 'Direktur')$q$, (select v from uji.d923 where k = 'r')),
   'SPH_BELUM_BOLEH');

-- 2. penawaran terbit (fungsi lama) lalu SPH dicatat
select kso.app_terbitkan_penawaran((select v::bigint from uji.d923 where k = 'r'), (select v::numeric + 500 from uji.d923 where k = 'lantai'));
select uji.harus_gagal('Peran AM tidak boleh mencatat SPH',
   format($q$select set_config('wrg.kso_peran', 'am', true), kso.app_catat_sph(%s, '00001/UJI/XI/2026', 999999, null, 'Direktur Fiktif', 'Direktur')$q$,
          (select v from uji.d923 where k = 'r')),
   'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_peran', 'sekretaris', false);
select uji.harus_gagal('Harga di bawah lantai mandat ditolak',
   format($q$select kso.app_catat_sph(%s, '00001/UJI/XI/2026', %s, null, 'Direktur Fiktif', 'Direktur')$q$,
          (select v from uji.d923 where k = 'r'), (select v::numeric - 1 from uji.d923 where k = 'lantai')),
   'KELUAR_MANDAT');
select uji.harus_gagal('Penanda tangan kosong ditolak',
   format($q$select kso.app_catat_sph(%s, '00001/UJI/XI/2026', 999999, null, '  ', 'Direktur')$q$, (select v from uji.d923 where k = 'r')),
   'PENANDA_TANGAN_KOSONG');
select uji.harus_gagal('Nomor kosong ditolak',
   format($q$select kso.app_catat_sph(%s, ' ', 999999, null, 'Direktur Fiktif', 'Direktur')$q$, (select v from uji.d923 where k = 'r')),
   'NOMOR_SPH_KOSONG');
insert into uji.d923 select 's', kso.app_catat_sph((select v::bigint from uji.d923 where k = 'r'), ' 00001/UJI/XI/2026 ',
   (select v::numeric + 500 from uji.d923 where k = 'lantai'), 'u-dir', ' Direktur Fiktif ', 'Direktur Utama')::text;

select uji.cek('SPH tercatat: nomor & penanda tangan dirapikan, berlaku 30 hari sejak hari ini, peran pembuat tercatat',
   (select nomor = '00001/UJI/XI/2026' and ttd_nama = 'Direktur Fiktif' and ttd_jabatan = 'Direktur Utama' and ttd_user_id = 'u-dir'
           and berlaku_hari = 30 and berlaku_sampai = kso.hari_ini() + 30 and dibuat_user = 'u-sek' and dibuat_peran = 'sekretaris'
      from kso.sph where id = (select v::bigint from uji.d923 where k = 's')));
select uji.cek('Snapshot isi surat: harga, masa KSO ≤ tenor mandat, volume minimum & klausul wajib dari mandat, faskes & alat',
   (select s.harga_per_test = (select v::numeric + 500 from uji.d923 where k = 'lantai')
           and s.tenor_bulan = least(r.tenor_bulan, m.tenor_maks_bulan) and s.volume_minimum is not distinct from m.volume_minimum
           and s.klausul_wajib = m.klausul_wajib and s.faskes_nama = f.nama and s.alat_nama = coalesce(a.nama, a.kode) and s.jumlah >= 1
      from kso.sph s join kso.rencana_kso r on r.id = s.rencana_id join kso.mandat m on m.rencana_id = r.id
      join kso.faskes f on f.id = r.faskes_id join kso.alat a on a.kode = r.alat_kode
     where s.id = (select v::bigint from uji.d923 where k = 's')));
select uji.harus_gagal('Nomor SPH yang sama tak bisa dipakai dua kali',
   format($q$select kso.app_catat_sph(%s, '00001/UJI/XI/2026', 999999, null, 'Direktur Fiktif', 'Direktur')$q$, (select v from uji.d923 where k = 'r')),
   'sph_nomor_uq');
select uji.harus_gagal('Aplikasi tak bisa menulis kso.sph langsung',
   $q$insert into kso.sph (rencana_id, nomor, harga_per_test, tenor_bulan, faskes_nama, alat_nama, berlaku_sampai, ttd_nama)
      values (1, 'X', 1, 1, 'x', 'x', current_date, 'x')$q$, 'permission denied');

-- 3. RLS: Sekretaris melihat SPH; AM lain (bukan pemilik) tidak
select uji.cek('Sekretaris membaca SPH lewat RLS', exists (select 1 from kso.sph where id = (select v::bigint from uji.d923 where k = 's')));
select set_config('wrg.kso_peran', 'am', false), set_config('wrg.kso_ref', 'AM-TIDAK-ADA', false);
select uji.cek('AM bukan pemilik tidak melihat SPH (RLS boleh_lihat)', not exists (select 1 from kso.sph where id = (select v::bigint from uji.d923 where k = 's')));
reset role;
select set_config('wrg.kso_user', '', false), set_config('wrg.kso_peran', '', false), set_config('wrg.kso_ref', '', false);
