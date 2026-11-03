-- Uji migrasi 269 (uji E2E dev 3 Nov): zona dihitung ulang sesudah verifikasi bukti volume, dan mandat
-- Direksi membawa harga pembuka + volume terbukti. DB UJI saja, sesudah 900–909. Angka dari tiruan 005.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d910 (k text primary key, v bigint);
grant all on uji.d910 to wrg_app;

-- Z52 @ Rp 12.000 / 2.400 tes = GPM 45,1% (zona dasar Forum); bukti tertulis belum diverifikasi → naik ke Direktur
do $$ declare a bigint; b bigint; c bigint; begin
  a := kso.buat_draft('AM-02','F02','Z52',1,2400,'rekap LIS 6 bulan',12000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  b := kso.buat_draft('AM-02','F02','Z52',1,2400,'PO reagen RS',12000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  c := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',10000,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(a); perform kso.ajukan(b); perform kso.ajukan(c);
  insert into uji.d910 values ('a', a), ('b', b), ('c', c) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Sebelum verifikasi: zona dasar Forum, gerbang 2 belum → zona Direktur',
   (select zona_dasar = 'forum' and zona = 'direktur' and jalur = 'FORUM' from kso.rencana_kso where id = (select v from uji.d910 where k='a')));

set role wrg_app;
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000ab', false);
select set_config('wrg.kso_peran', 'sekretaris', false);
select set_config('wrg.kso_ref', '', false);
do $$ begin
  perform kso.app_verifikasi_volume((select v from uji.d910 where k='a'), true, 'Rekap LIS 6 bulan sesuai');
  perform kso.app_verifikasi_volume((select v from uji.d910 where k='b'), false, 'PO tidak mencantumkan jumlah tes');
  perform kso.app_verifikasi_volume((select v from uji.d910 where k='c'), true, null);
end $$;
reset role;
select uji.cek('Bukti disahkan → semua gerbang hijau, zona turun ke Forum, alasan forum kosong',
   (select r.zona = 'forum' and r.alasan_forum is null and r.status = 'JALUR_FORUM'
           and not exists (select 1 from kso.gerbang_hasil g where g.rencana_id = r.id and g.status <> 'hijau')
      from kso.rencana_kso r where r.id = (select v from uji.d910 where k='a')));
select uji.cek('Bukti ditolak → gerbang 2 merah, zona tetap Direktur, jalur tetap forum',
   (select r.zona = 'direktur' and r.jalur = 'FORUM' and g.status = 'merah'
      from kso.rencana_kso r join kso.gerbang_hasil g on g.rencana_id = r.id and g.no = 2
     where r.id = (select v from uji.d910 where k='b')));
select uji.cek('Jalur cepat tidak disentuh zona ulang (zona 2 HOD, status tetap)',
   (select zona = 'hod' and jalur = 'CEPAT' and status = 'JALUR_CEPAT' from kso.rencana_kso where id = (select v from uji.d910 where k='c')));
select uji.harus_gagal('Fungsi zona ulang tertutup untuk aplikasi',
   format('set local role wrg_app; select kso.zona_ulang(%s)', (select v from uji.d910 where k='a')), 'permission denied');

-- putusan Direksi: tiga harga. Biaya Z52 @2.400 = 6.583/tes → pembuka @55% = Rp 14.700
update kso.rencana_kso set status = 'DIREKOMENDASIKAN' where id in ((select v from uji.d910 where k='a'), (select v from uji.d910 where k='b'));
select uji.harus_gagal('Direksi: pembuka di bawah target ditolak',
   format('select kso.putus_direksi(%s,''SETUJU'',null,11000,12000,36,80000000,1900,''{}'',11500)', (select v from uji.d910 where k='b')), 'MANDAT_URUTAN_HARGA');
select uji.harus_gagal('Direksi: target di bawah lantai ditolak',
   format('select kso.putus_direksi(%s,''SETUJU'',null,13000,12000,36,80000000,1900)', (select v from uji.d910 where k='b')), 'MANDAT_URUTAN_HARGA');

set role wrg_app;
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000ac', false);
select set_config('wrg.kso_peran', 'direksi', false);
do $$ begin
  perform kso.app_putus_direksi((select v from uji.d910 where k='a'), 'SETUJU', null, 11000, 12000, 36, 80000000, 1900);
  perform kso.app_putus_direksi((select v from uji.d910 where k='b'), 'BERSYARAT', 'Volume diverifikasi ulang', 11000, 12000, 36, 80000000, 1900, '{}', 15000);
end $$;
reset role;
select uji.cek('Direksi tanpa pembuka → mandat pembuka @GPM 55% (Rp 14.700) + volume terbukti 2.400',
   (select harga_pembuka = 14700 and harga_target = 12000 and harga_lantai = 11000 and volume_terbukti = 2400 and sumber = 'direksi'
      from kso.mandat where rencana_id = (select v from uji.d910 where k='a')));
select uji.cek('Direksi dengan pembuka eksplisit → tersimpan apa adanya (Rp 15.000)',
   (select harga_pembuka = 15000 from kso.mandat where rencana_id = (select v from uji.d910 where k='b')));
select uji.cek('Penawaran default memakai pembuka mandat Direksi (bukan target)',
   (select coalesce(m.harga_pembuka, m.harga_target) = 14700 from kso.mandat m where m.rencana_id = (select v from uji.d910 where k='a')));
