-- Uji migrasi 307: ALAT BARU (belum ada di database) dari #KSO — dibuat lewat bot, gerbang GPM MERAH, zona Direktur,
-- boleh diajukan tanpa ALASAN strategis; usulan alat katalog dengan zona Direktur tetap wajib alasan.
-- DB UJI saja, sesudah 900–921. Nama & angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d922 (k text primary key, v text);
grant all on uji.d922 to wrg_app;

-- 1. bot membuat alat baru; nama sama dipakai ulang
set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
select set_config('wrg.kso_peran', '', false);
insert into uji.d922 select 'a', kso.app_bot_buat_alat_baru('AM-01', '  Merek  Fiktif cm 250 ');
select uji.cek('Alat baru: kode BARU-n, baru, kategori BARU, nama huruf besar, harga_po 0, pembuat tercatat',
   (select kode like 'BARU-%' and baru and kategori = 'BARU' and nama = 'MEREK FIKTIF CM 250' and harga_po = 0
           and dibuat_oleh_am = 'AM-01' and dibuat_at is not null
      from kso.alat where kode = (select v from uji.d922 where k = 'a')));
insert into uji.d922 select 'a2', kso.app_bot_buat_alat_baru('AM-02', 'merek fiktif CM 250');
select uji.cek('Nama sama (beda huruf besar/spasi) → alat yang sama, tidak digandakan',
   (select v from uji.d922 where k = 'a2') = (select v from uji.d922 where k = 'a')
   and (select count(*) = 1 from kso.alat where upper(nama) = 'MEREK FIKTIF CM 250'));
select uji.harus_gagal('Nama alat kosong ditolak', $q$select kso.app_bot_buat_alat_baru('AM-01', ' ')$q$, 'ALAT_NAMA_TIDAK_SAH');
select uji.harus_gagal('AM tak dikenal ditolak', $q$select kso.app_bot_buat_alat_baru('AM-TIDAK-ADA', 'Alat X')$q$, 'AM_TIDAK_ADA');
select uji.harus_gagal('Aplikasi tak bisa menulis kso.alat langsung',
   $q$insert into kso.alat (kode, nama, kategori, harga_po, baru) values ('BARU-X', 'x', 'BARU', 0, true)$q$, 'permission denied');
reset role;
select uji.harus_gagal('Kode katalog tak bisa ditandai baru (CHECK)',
   $q$update kso.alat set baru = true where kode = 'Z3'$q$, 'alat_baru_kode_ck');

-- 2. draft dengan alat baru: gerbang 1 merah, zona Direktur, angka GPM kosong
set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
insert into uji.d922 select 'd', kso.app_bot_buat_draft('AM-01', 'F04', (select v from uji.d922 where k = 'a'), 1, 900, 'data LIS 3 bulan',
   18500, null, 36, '{}', '[{"nama":"dr. Fiktif","tipe":"kepala_instalasi"}]')::text;
select kso.app_bot_lengkapi_draft((select v::bigint from uji.d922 where k = 'd'), 'AM-01', '{"klausul": []}');
select uji.cek('Gerbang 1 MERAH "Alat belum ada di database"',
   (select status = 'merah' and nilai like 'Alat belum ada di database%' from kso.gerbang_hasil
     where rencana_id = (select v::bigint from uji.d922 where k = 'd') and no = 1));
select uji.cek('Zona dasar Direktur, GPM kosong',
   (select zona_dasar = 'direktur' and gpm_deal is null from kso.rencana_kso where id = (select v::bigint from uji.d922 where k = 'd')));
select uji.cek('Usulan alat baru tampil di v_rencana dengan nama alatnya',
   (select alat_nama = 'MEREK FIKTIF CM 250' from kso.v_rencana where id = (select v::bigint from uji.d922 where k = 'd')));

-- 3. boleh diajukan tanpa ALASAN strategis → jalur forum, zona Direktur
select kso.app_bot_ajukan((select v::bigint from uji.d922 where k = 'd'), 'AM-01');
select uji.cek('Alat baru diajukan tanpa alasan strategis → zona Direktur, jalur FORUM',
   (select zona = 'direktur' and jalur = 'FORUM' and status = 'JALUR_FORUM' and nomor is not null
      from kso.rencana_kso where id = (select v::bigint from uji.d922 where k = 'd')));
reset role;

-- 4. alat katalog yang zonanya Direktur karena margin TETAP wajib alasan (tambalan hanya untuk alat baru)
select uji.cek('Tambalan ajukan memuat pengecualian alat baru dan syarat alasan lama tetap ada',
   (select position('307: alat baru' in d) > 0 and position('ALASAN_STRATEGIS_WAJIB' in d) > 0
      from (select pg_get_functiondef('kso.ajukan(bigint,text)'::regprocedure) as d) x));
select uji.cek('Alat sementara tidak ikut katalog segarkan_referensi (kode katalog tak berawalan BARU-)',
   not exists (select 1 from kso.alat where not baru and kode like 'BARU-%'));
select set_config('wrg.kso_user', '', false);
