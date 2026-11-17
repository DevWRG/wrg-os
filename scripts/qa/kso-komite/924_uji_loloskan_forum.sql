-- Uji migrasi 329: usulan BELUM LENGKAP diloloskan ke agenda forum (putusan Direktur 17 Nov 2026, issue #2383).
-- DB UJI saja, sesudah 900–923. Nama & angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d924 (k text primary key, v text);
grant all on uji.d924 to wrg_app;

-- 1. draft yang isiannya kurang (tanpa harga, volume, tenor, pendukung) → ajukan biasa ditolak
set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false), set_config('wrg.kso_peran', '', false), set_config('wrg.kso_ref', '', false);
insert into uji.d924 select 'd', kso.app_bot_buat_draft('AM-01', 'F04', 'Z3', 1, null, 'belum ada', null, null, null, '{}', '[]')::text;
select kso.app_bot_lengkapi_draft((select v::bigint from uji.d924 where k = 'd'), 'AM-01', '{"klausul": []}');
select uji.harus_gagal('Ajukan biasa ditolak karena isian kurang',
   format($q$select kso.app_bot_ajukan(%s, 'AM-01')$q$, (select v from uji.d924 where k = 'd')), 'KOLOM_WAJIB_KOSONG');

-- 2. peran yang tidak berwenang
select set_config('wrg.kso_user', 'u-am', false), set_config('wrg.kso_peran', 'am', false), set_config('wrg.kso_ref', 'AM-01', false);
select uji.harus_gagal('AM tidak bisa meloloskan ke forum',
   format($q$select kso.app_loloskan_ke_forum(%s, null)$q$, (select v from uji.d924 where k = 'd')), 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_user', 'bot-wa', false), set_config('wrg.kso_peran', '', false), set_config('wrg.kso_ref', '', false);
select uji.harus_gagal('Bot WA tidak bisa meloloskan ke forum',
   format($q$select kso.app_loloskan_ke_forum(%s, null)$q$, (select v from uji.d924 where k = 'd')), 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('Aplikasi tak bisa memanggil fungsi inti langsung',
   format($q$select kso.loloskan_ke_forum(%s, null, 'x')$q$, (select v from uji.d924 where k = 'd')), 'permission denied');

-- 3. Komite meloloskan
select set_config('wrg.kso_user', 'u-kom', false), set_config('wrg.kso_peran', 'komite', false), set_config('wrg.kso_ref', '', false);
select uji.harus_gagal('Alasan > 500 huruf ditolak',
   format($q$select kso.app_loloskan_ke_forum(%s, repeat('x', 501))$q$, (select v from uji.d924 where k = 'd')), 'ALASAN_TERLALU_PANJANG');
insert into uji.d924 select 'n', kso.app_loloskan_ke_forum((select v::bigint from uji.d924 where k = 'd'), '  Putusan Direktur: lengkapi di forum  ');
reset role;
select uji.cek('Diloloskan: JALUR_FORUM, jalur FORUM, nomor KSO terbit, zona minimal Forum, jejak siapa/kapan/alasan',
   (select status = 'JALUR_FORUM' and jalur = 'FORUM' and nomor = (select v from uji.d924 where k = 'n') and nomor like 'KSO-%'
           and zona in ('forum','direktur') and diloloskan_at is not null and diloloskan_oleh = 'komite:u-kom'
           and diloloskan_alasan = 'Putusan Direktur: lengkapi di forum' and diajukan_at is not null
           and alasan_forum like 'Diloloskan ke forum walau isian belum lengkap — Putusan Direktur%'
      from kso.rencana_kso where id = (select v::bigint from uji.d924 where k = 'd')));
select uji.cek('Riwayat: DRAFT → DIAJUKAN → JALUR_FORUM oleh komite',
   (select array_agg(ke::text order by at, id) = array['DIAJUKAN','JALUR_FORUM'] and bool_and(oleh = 'komite:u-kom')
      from kso.riwayat_status where rencana_id = (select v::bigint from uji.d924 where k = 'd') and ke in ('DIAJUKAN','JALUR_FORUM')));
set role wrg_app;
select uji.harus_gagal('Usulan yang sudah di jalur forum tak bisa diloloskan lagi',
   format($q$select kso.app_loloskan_ke_forum(%s, null)$q$, (select v from uji.d924 where k = 'd')), 'TIDAK_BISA_DILOLOSKAN');
reset role;

-- 4. susun agenda: yang diloloskan didahulukan & tidak tertahan verifikasi volume (285), walau bukti "data" belum diperiksa
update kso.rencana_kso set volume_sumber_label = 'data', volume_terverifikasi = null, zona = 'forum'
 where id = (select v::bigint from uji.d924 where k = 'd');
insert into uji.d924 select 'tgl', (kso.hari_ini() + ((9 - extract(isodow from kso.hari_ini())::int) % 7 + 7) % 7 + 7)::text;  -- Selasa ≥ minggu depan
insert into uji.d924 select 'f', kso.susun_agenda((select v::date from uji.d924 where k = 'tgl'), clock_timestamp())::text;
select uji.cek('Agenda A memuat usulan yang diloloskan di urutan pertama, status DIAGENDAKAN',
   (select ai.jenis = 'A' and ai.urut = 1 and r.status = 'DIAGENDAKAN'
      from kso.agenda_item ai join kso.rencana_kso r on r.id = ai.rencana_id
     where ai.forum_id = (select v::bigint from uji.d924 where k = 'f') and ai.rencana_id = (select v::bigint from uji.d924 where k = 'd')));
select uji.cek('Batas Agenda A tetap berlaku', (select count(*) <= kso.param('agenda_a_maks') from kso.agenda_item
   where forum_id = (select v::bigint from uji.d924 where k = 'f') and jenis = 'A'));
select uji.cek('Tanpa diloloskan, aturan 285 tetap menahan bukti yang belum diverifikasi',
   (select position('diloloskan_at is not null' in d) > 0 and position('volume_terverifikasi is null' in d) > 0
      from (select pg_get_functiondef('kso.susun_agenda(date,timestamp with time zone)'::regprocedure) as d) x));

-- 5. dari DITAHAN (forum menahan karena data kurang) → Sekretaris meloloskan lagi ke forum
update kso.rencana_kso set status = 'DITAHAN' where id = (select v::bigint from uji.d924 where k = 'd');
set role wrg_app;
select set_config('wrg.kso_user', 'u-sek', false), set_config('wrg.kso_peran', 'sekretaris', false), set_config('wrg.kso_ref', '', false);
select kso.app_loloskan_ke_forum((select v::bigint from uji.d924 where k = 'd'), null);
reset role;
select uji.cek('DITAHAN → diloloskan lagi oleh Sekretaris: JALUR_FORUM, nomor tetap, alasan kosong boleh',
   (select status = 'JALUR_FORUM' and nomor = (select v from uji.d924 where k = 'n') and diloloskan_oleh = 'sekretaris:u-sek'
           and diloloskan_alasan is null
      from kso.rencana_kso where id = (select v::bigint from uji.d924 where k = 'd')));
select set_config('wrg.kso_user', '', false), set_config('wrg.kso_peran', '', false), set_config('wrg.kso_ref', '', false);
