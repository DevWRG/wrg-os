-- Uji migrasi 265/266 (F170 v2, Pedoman Komite KSO Forum v01) lewat peran wrg_app. DB UJI saja, sesudah 900–908.
-- Alur zona & gerbang sudah diuji 900 sebagai owner; di sini: verifikasi volume hanya Sekretaris, fungsi inti tertutup.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d909 (k text primary key, v bigint);
grant all on uji.d909 to wrg_app;

do $$ declare x bigint; begin
  -- Z52 @ Rp 12.000 / 2.400 tes = zona Forum (tiruan 005); bukti tertulis menunggu verifikasi
  x := kso.buat_draft('AM-02','F02','Z52',1,2400,'rekap LIS 6 bulan',12000,'idle',36,'{}',
                      '[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(x);
  insert into uji.d909 values ('x', x) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Zona Forum: gerbang 2 menunggu verifikasi Sekretaris',
   (select status = 'belum' from kso.gerbang_hasil where rencana_id = (select v from uji.d909 where k='x') and no = 2));

set role wrg_app;
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000aa', false);
select set_config('wrg.kso_peran', 'am', false);
select set_config('wrg.kso_ref', 'AM-02', false);
select uji.harus_gagal('AM tidak bisa memverifikasi bukti volumenya sendiri',
   format('select kso.app_verifikasi_volume(%s, true)', (select v from uji.d909 where k='x')), 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('Fungsi inti verifikasi tertutup untuk aplikasi',
   format('select kso.verifikasi_volume(%s, true, null, ''x'')', (select v from uji.d909 where k='x')), 'permission denied');
select uji.cek('AM pemilik melihat angka GPM rencananya sendiri (268)',
   (select gpm is not null from kso.app_angka_gpm((select v from uji.d909 where k='x'))));
select set_config('wrg.kso_ref', 'AM-01', false);
select uji.harus_gagal('AM lain tidak bisa membaca angka GPM rencana orang lain',
   format('select * from kso.app_angka_gpm(%s)', (select v from uji.d909 where k='x')), 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_ref', 'AM-02', false);
select uji.harus_gagal('Fungsi GPM inti tertutup untuk aplikasi',
   format('select * from kso.hitung_gpm(%s)', (select v from uji.d909 where k='x')), 'permission denied');

select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000ab', false);
select set_config('wrg.kso_peran', 'sekretaris', false);
select set_config('wrg.kso_ref', '', false);
select uji.harus_gagal('Sekretaris menolak bukti tanpa alasan → ditolak',
   format('select kso.app_verifikasi_volume(%s, false)', (select v from uji.d909 where k='x')), 'ALASAN_WAJIB');
do $$ begin perform kso.app_verifikasi_volume((select v from uji.d909 where k='x'), true, 'Rekap LIS 6 bulan sesuai'); end $$;
select uji.cek('Sekretaris melihat angka GPM + tiga harga untuk verifikasi',
   (select harga_forum > 0 and harga_hod > harga_forum and harga_am > harga_hod from kso.app_angka_gpm((select v from uji.d909 where k='x'))));
reset role;
select uji.cek('Sekretaris memverifikasi → gerbang 2 hijau, jejak = sekretaris + orangnya',
   (select r.volume_terverifikasi and r.volume_verifikasi_oleh = 'sekretaris:a1b2c3d4-0000-0000-0000-0000000000ab'
           and g.status = 'hijau'
      from kso.rencana_kso r join kso.gerbang_hasil g on g.rencana_id = r.id and g.no = 2
     where r.id = (select v from uji.d909 where k='x')));
