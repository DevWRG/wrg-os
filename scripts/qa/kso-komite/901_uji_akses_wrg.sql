-- Uji hak akses versi WRG-OS — terjemahan 901_uji_akses.sql (Paket Komite KSO v1.0).
-- Jalankan lewat jalankan_uji.sh SETELAH 224–227 + 004 + 900, di database UJI saja.
-- Padanan peran: anon → wrg_readonly (akun tanpa hak), authenticated → wrg_app,
-- auth.uid() → GUC wrg.kso_user (diisi API dari JWT sub = master_user.id).
\set ON_ERROR_STOP on
set timezone = 'UTC';
-- seperti skenario "schema ter-expose" di rujukan: akun tanpa hak boleh melihat schema,
-- supaya uji membuktikan pagar FUNGSI & TABEL, bukan cuma pagar schema. Hanya di DB uji.
grant usage on schema kso to wrg_readonly;

insert into kso.pengguna values
 ('u-am01','am','AM-01'),
 ('u-am03','am','AM-03'),
 ('u-habar','hod','HA-BAR'),
 ('u-admin','admin_sales',null),
 ('u-bot','bot_wa',null),
 ('u-teknik','teknik',null);
-- siapkan satu rencana berstatus PKS_TTD untuk uji Teknik, dan angka pembanding untuk uji baca
do $$ declare x bigint; begin
  -- F170 v2: Rp 10.000 / 900 tes = zona 2 HOD (Rp 18.500 kini zona AM)
  x := kso.buat_draft('AM-04','F08','Z3',1,900,'data LIS',10000,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(x); perform kso.putus_hod(x,'HB-IVD','setuju'); perform kso.putus_hod(x,'HA-TIM','setuju');
  perform kso.terbitkan_penawaran(x,19000); perform kso.catat_pks(x,18500);
  insert into uji.id values ('pks', x) on conflict (k) do update set v = excluded.v;
  insert into uji.id values ('pendukung_am01', (select count(*) from kso.rencana_pendukung p join kso.rencana_kso r on r.id=p.rencana_id where r.am_id='AM-01'))
    on conflict (k) do update set v = excluded.v;
  insert into uji.id values ('pendukung_total', (select count(*) from kso.rencana_pendukung)) on conflict (k) do update set v = excluded.v;
end $$;
grant usage on schema uji to wrg_app, wrg_readonly; grant execute on all functions in schema uji to wrg_app, wrg_readonly;
grant select on uji.id to wrg_app;

-- 1. akun tanpa hak (padanan kunci publik anon) tidak bisa apa-apa
set role wrg_readonly;
select uji.harus_gagal('Akun tanpa hak (wrg_readonly) tidak bisa menerbitkan penawaran', 'select kso.app_terbitkan_penawaran(2, 999999)', 'permission denied');
select uji.harus_gagal('Akun tanpa hak (wrg_readonly) tidak bisa memutus atas nama Direksi', 'select kso.app_putus_direksi(2,''SETUJU'')', 'permission denied');
select uji.harus_gagal('Akun tanpa hak (wrg_readonly) tidak bisa membaca rencana', 'select count(*) from kso.rencana_kso', 'permission denied');
reset role;

-- 2. akun login tanpa peran tidak lolos pagar
set role wrg_app;
select set_config('wrg.kso_user','',false);
select uji.harus_gagal('Login tanpa akun peran tidak bisa memutus', 'select kso.app_putus_direksi(2,''SETUJU'')', 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('Fungsi inti tidak bisa dipanggil langsung', 'select kso.terbitkan_penawaran(2, 999999)', 'permission denied');

select set_config('wrg.kso_user','u-tanpa-peran',false);   -- login sah, belum diberi peran
select uji.cek('Akun login tanpa peran tidak bisa membaca nomor WA, faskes, atau piutang',
   (select count(*) from kso.am)=0 and (select count(*) from kso.faskes)=0 and (select count(*) from kso.hod)=0);

-- 3. AM
select set_config('wrg.kso_user','u-am01',false);
select uji.cek('AM-01 hanya melihat rencananya sendiri', (select bool_and(am_id='AM-01') and count(*)>0 from kso.v_rencana));
select uji.cek('AM-01 tidak bisa membaca nama pendukung milik AM lain',
   (select count(*) from kso.rencana_pendukung) = (select v from uji.id where k='pendukung_am01')
   and (select v from uji.id where k='pendukung_total') > (select v from uji.id where k='pendukung_am01'));
select uji.cek('AM-01 tidak bisa membaca nomor WA AM lain', (select count(*)=1 from kso.am));
select uji.cek('AM-01 tidak bisa membaca usulan komite atas rencana AM lain',
   not exists (select 1 from kso.usulan_komite_catatan u where u.rencana_id not in (select id from kso.rencana_kso)));
select uji.harus_gagal('AM tidak bisa mengubah status langsung', 'update kso.rencana_kso set status=''MANDAT_TERBIT''', 'permission denied');
select set_config('wrg.kso_user','u-am03',false);
select uji.cek('AM-03 tidak melihat rencana AM-01', not exists (select 1 from kso.v_rencana where am_id='AM-01'));

-- 4. HOD
select set_config('wrg.kso_user','u-habar',false);
select uji.cek('HOD Area Barat hanya melihat faskes wilayah Barat', (select coalesce(bool_and(wilayah='Barat'),true) and count(*)>0 from kso.v_rencana));
select uji.harus_gagal('HOD tidak bisa memutus atas nama Direksi', 'select kso.app_putus_direksi(2,''SETUJU'')', 'PERAN_TIDAK_BERWENANG');

-- 5. Admin sales
select set_config('wrg.kso_user','u-admin',false);
select uji.cek('Admin sales tidak melihat rencana yang belum punya putusan', not exists (select 1 from kso.v_rencana where status in ('JALUR_FORUM','DIAGENDAKAN','JALUR_CEPAT')));

-- 6. Bot WhatsApp: jalur tulisnya bekerja lewat pembungkus
select set_config('wrg.kso_user','u-bot',false);
-- sejak migrasi 229 jumlah & klausul wajib DINYATAKAN (lewat app_bot_lengkapi_draft) sebelum diajukan
select uji.cek('Bot WA bisa membuat draft, melengkapi, dan mengajukan lewat pembungkus',
   (select kso.app_bot_ajukan(x, 'AM-03') = 'CEPAT'
      from (select kso.app_bot_buat_draft('AM-03','F06','Z3',1,900,'data LIS 3 bulan',10000,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]') x) d,
           lateral (select kso.app_bot_lengkapi_draft(d.x, 'AM-03', '{"jumlah":1,"klausul":[]}')) l));
select uji.harus_gagal('Bot tidak bisa memindahkan usulan milik AM lain',
   format('select kso.app_bot_minta_kelonggaran(%s,''AM-03'',''x'')', (select id from kso.rencana_kso where am_id='AM-01' limit 1)), 'BUKAN_MILIK_PENGIRIM');
select uji.harus_gagal('Bot tidak bisa menandai kalah usulan milik AM lain',
   format('select kso.app_bot_catat_kalah(%s,''AM-03'',''x'')', (select id from kso.rencana_kso where am_id='AM-01' limit 1)), 'BUKAN_MILIK_PENGIRIM');

-- 7. Teknik
select set_config('wrg.kso_user','u-teknik',false);
select uji.cek('Teknik hanya melihat rencana yang PKS-nya sudah ada', (select bool_and(status in ('PKS_TTD','TERPASANG')) and count(*)>0 from kso.v_rencana));
do $$ begin perform kso.app_serah_terima((select v from uji.id where k='pks'), 'Z3-2610-0107', '2026-11-02'); end $$;
select uji.cek('Teknik bisa mencatat serah terima', (select status from kso.v_rencana where id=(select v from uji.id where k='pks'))='TERPASANG');
reset role;

-- 8. tambahan WRG-OS: tanpa celah "service_role"
set role wrg_app;
select set_config('wrg.kso_user','',false);
select uji.harus_gagal('Koneksi aplikasi tanpa identitas tidak bisa menerbitkan penawaran', 'select kso.app_terbitkan_penawaran(2, 999999)', 'PERAN_TIDAK_BERWENANG');
select uji.cek('Koneksi aplikasi tanpa identitas tidak membaca rencana apa pun', (select count(*)=0 from kso.rencana_kso));
reset role;
