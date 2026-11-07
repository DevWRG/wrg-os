-- Uji migrasi 285: Agenda A hanya memuat usulan yang bukti volumenya sudah diperiksa Sekretaris (keputusan user 7 Nov).
-- DB UJI saja, sesudah 916. Angka dari tiruan 005 (Z52 @ Rp 12.000 / 2.400 tes = zona dasar Forum).
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d917 (k text primary key, v bigint);
grant all on uji.d917 to wrg_app;
update kso.parameter set nilai = 50 where kunci = 'agenda_a_maks';   -- sisa rencana uji lain tak boleh menyesaki agenda

do $$ declare x bigint; y bigint; begin
  x := kso.buat_draft('AM-02','F02','Z52',1,2400,'rekap LIS 6 bulan',12000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  y := kso.buat_draft('AM-02','F02','Z52',1,2400,'catatan lisan',12000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(x); perform kso.ajukan(y);
  insert into uji.d917 values ('x', x), ('y', y) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Prasyarat: x bukti tertulis belum diperiksa, y bukti lisan — keduanya jalur forum',
   (select bool_and(status = 'JALUR_FORUM') from kso.rencana_kso where id in (select v from uji.d917))
   and (select volume_sumber_label = 'data' and volume_terverifikasi is null from kso.rencana_kso where id = (select v from uji.d917 where k='x')));

do $$ declare f bigint; begin
  f := kso.susun_agenda('2026-12-01', clock_timestamp());
  insert into uji.d917 values ('f1', f) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Bukti tertulis belum diperiksa → TIDAK masuk Agenda A, status tetap jalur forum',
   not exists (select 1 from kso.agenda_item where forum_id = (select v from uji.d917 where k='f1') and rencana_id = (select v from uji.d917 where k='x'))
   and (select status = 'JALUR_FORUM' from kso.rencana_kso where id = (select v from uji.d917 where k='x')));
select uji.cek('Bukti lisan tidak menunggu verifikasi → masuk Agenda A',
   exists (select 1 from kso.agenda_item where forum_id = (select v from uji.d917 where k='f1') and rencana_id = (select v from uji.d917 where k='y') and jenis = 'A'));

set role wrg_app;
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000ab', false);
select set_config('wrg.kso_peran', 'sekretaris', false);
select set_config('wrg.kso_ref', '', false);
do $$ begin perform kso.app_verifikasi_volume((select v from uji.d917 where k='x'), true, 'Rekap LIS sesuai'); end $$;
reset role;

do $$ declare f bigint; begin
  f := kso.susun_agenda('2026-12-03', clock_timestamp());
  insert into uji.d917 values ('f2', f) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Sesudah diverifikasi → masuk Agenda A forum berikutnya',
   exists (select 1 from kso.agenda_item where forum_id = (select v from uji.d917 where k='f2') and rencana_id = (select v from uji.d917 where k='x') and jenis = 'A'));
update kso.parameter set nilai = 3 where kunci = 'agenda_a_maks';
