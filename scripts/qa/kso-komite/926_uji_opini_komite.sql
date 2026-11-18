-- Uji migrasi 338: Opini Komite untuk usulan Zona Direktur (permintaan user 18 Nov 2026).
-- DB UJI saja, dijalankan TERAKHIR (mengubah zona/status tiga rencana uji secara langsung). Nama & angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d926 (k text primary key, v text);
grant all on uji.d926 to wrg_app;

-- tiga rencana: zona Direktur terbuka, zona Forum, zona Direktur yang sudah diputus (terkunci)
insert into uji.d926 select 'r' || row_number() over (order by id), id::text from (select id from kso.rencana_kso order by id limit 3) x;
update kso.rencana_kso set zona = 'direktur', status = 'JALUR_FORUM' where id = (select v::bigint from uji.d926 where k = 'r1');
update kso.rencana_kso set zona = 'forum', status = 'JALUR_FORUM' where id = (select v::bigint from uji.d926 where k = 'r2');
update kso.rencana_kso set zona = 'direktur', status = 'MANDAT_TERBIT' where id = (select v::bigint from uji.d926 where k = 'r3');

set role wrg_app;
select set_config('wrg.kso_user', 'u-am', false), set_config('wrg.kso_peran', 'am', false), set_config('wrg.kso_ref', 'AM-01', false);
select uji.harus_gagal('AM tidak bisa mengisi opini Komite',
   format($q$select kso.app_isi_opini_komite(%s, 'opini')$q$, (select v from uji.d926 where k = 'r1')), 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_user', 'u-sek', false), set_config('wrg.kso_peran', 'sekretaris', false), set_config('wrg.kso_ref', '', false);
select uji.harus_gagal('Sekretariat tidak bisa mengisi opini Komite',
   format($q$select kso.app_isi_opini_komite(%s, 'opini')$q$, (select v from uji.d926 where k = 'r1')), 'PERAN_TIDAK_BERWENANG');

select set_config('wrg.kso_user', 'u-kom', false), set_config('wrg.kso_peran', 'komite', false);
select kso.app_isi_opini_komite((select v::bigint from uji.d926 where k = 'r1'),
   E'  **LAYAK, DISETUJUI DENGAN SYARAT**\n\n| Tahun | Arus kas |\n|---|---|\n| 1 | 10 |  ');
select uji.cek('Opini tersimpan (dirapikan, tabel markdown utuh) beserta pengisi dan waktunya',
   (select opini_komite like '**LAYAK%' and opini_komite like '%| 1 | 10 |' and opini_komite_oleh = 'komite:u-kom' and opini_komite_at is not null
      from kso.rencana_kso where id = (select v::bigint from uji.d926 where k = 'r1')));
select kso.app_isi_opini_komite((select v::bigint from uji.d926 where k = 'r1'), '   ');
select uji.cek('Opini kosong = dihapus',
   (select opini_komite is null from kso.rencana_kso where id = (select v::bigint from uji.d926 where k = 'r1')));
select uji.harus_gagal('Bukan Zona Direktur ditolak',
   format($q$select kso.app_isi_opini_komite(%s, 'opini')$q$, (select v from uji.d926 where k = 'r2')), 'OPINI_HANYA_ZONA_DIREKTUR');
select uji.harus_gagal('Sesudah Direksi memutus, opini terkunci',
   format($q$select kso.app_isi_opini_komite(%s, 'opini')$q$, (select v from uji.d926 where k = 'r3')), 'OPINI_TERKUNCI');
select uji.harus_gagal('Opini > 20.000 huruf ditolak',
   format($q$select kso.app_isi_opini_komite(%s, repeat('x', 20001))$q$, (select v from uji.d926 where k = 'r1')), 'OPINI_TERLALU_PANJANG');
select uji.harus_gagal('Aplikasi tak bisa memanggil fungsi inti langsung',
   format($q$select kso.isi_opini_komite(%s, 'x', 'x')$q$, (select v from uji.d926 where k = 'r1')), 'permission denied');
reset role;
