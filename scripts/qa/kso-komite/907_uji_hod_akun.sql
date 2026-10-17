-- Uji migrasi 233 (tautan akun login → kursi HOD, khusus Komite KSO). DB UJI saja, sesudah 900–906.
\set ON_ERROR_STOP on
set timezone = 'UTC';
insert into kso.hod_akun (user_id, hod_id, catatan) values ('a1b2c3d4-0000-0000-0000-00000000c0de', 'HA-BAR', 'uji');
select uji.harus_gagal('Kursi HOD yang tidak ada ditolak', 'insert into kso.hod_akun values (''u-x'', ''HOD-KARANGAN'')', 'foreign key');
set role wrg_app;
select set_config('wrg.kso_user', '', false);
select uji.cek('Aplikasi membaca tautan TANPA identitas peran (dipakai saat menentukan tab)',
   (select hod_id = 'HA-BAR' from kso.hod_akun where user_id = 'a1b2c3d4-0000-0000-0000-00000000c0de'));
select uji.harus_gagal('Aplikasi tidak bisa menulis tautan (hanya owner)', 'insert into kso.hod_akun values (''u-y'', ''HA-TIM'')', 'permission denied');
select uji.harus_gagal('Aplikasi tidak bisa mengubah tautan', 'update kso.hod_akun set hod_id = ''HA-TIM''', 'permission denied');
reset role;
