-- Uji migrasi 230 (peran pengguna web dari Akses Grup lewat GUC). DB UJI saja, sesudah 900–903.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d904 (k text primary key, v bigint);
grant all on uji.d904 to wrg_app;

-- satu rencana sampai PKS_TTD (jalur inti, sebagai owner) untuk uji Teknik + jejak pelaku
-- 902 memindahkan Z3 ke kategori HEMATO (refresh dari tabel OS tiruan) → beri register teknisinya
insert into kso.cabang_teknisi (cabang, kategori) values ('Jember', 'HEMATO') on conflict do nothing;
do $$ declare x bigint; begin
  -- F170 v2: zona 2 HOD (Rp 10.000 / 900 tes)
  x := kso.buat_draft('AM-03','F05','Z3',1,900,'data LIS',10000,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  -- semua kursi routing setuju (902 menambah HOD bisnis ivd 'mufid' di samping HB-IVD data contoh)
  perform kso.ajukan(x);
  perform kso.putus_hod(x, h.hod_id, 'setuju') from kso.hod_untuk(x) h;
  perform kso.terbitkan_penawaran(x,19000); perform kso.catat_pks(x,18500);
  insert into uji.d904 values ('pks', x) on conflict (k) do update set v = excluded.v;
end $$;

set role wrg_app;

-- 1. peran dari GUC berlaku, identitas wajib ada
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-00000000aaaa', false);
select set_config('wrg.kso_peran', 'teknik', false);
select set_config('wrg.kso_ref', '', false);
select uji.cek('Peran web dari GUC (teknik) dikenali', kso.peran_saya() = 'teknik');
do $$ begin perform kso.app_serah_terima((select v from uji.d904 where k='pks'), 'Z3-UJI-0904', '2026-11-02'); end $$;
select uji.cek('Teknik (peran dari Akses Grup) bisa mencatat serah terima', (select status = 'TERPASANG' from kso.v_rencana where id = (select v from uji.d904 where k='pks')));
select uji.cek('Jejak pelaku tercatat otomatis: orang + peran, bukan sekadar label',
   (select oleh_user = 'a1b2c3d4-0000-0000-0000-00000000aaaa' and oleh_peran = 'teknik'
      from kso.riwayat_status where rencana_id = (select v from uji.d904 where k='pks') and ke = 'TERPASANG'));

-- 2. GUC tidak bisa dipakai menyamar jadi bot atau peran karangan
select set_config('wrg.kso_peran', 'bot_wa', false);
select uji.cek('bot_wa tidak bisa diklaim lewat GUC', kso.peran_saya() is null);
select uji.harus_gagal('Klaim bot_wa lewat GUC tidak bisa membuat draft',
   'select kso.app_bot_buat_draft(''AM-01'',''F01'',''Z3'',1,900,''data'',18500,''baru'',36,''{}'',''[]'')', 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_peran', 'superadmin', false);
select uji.cek('Peran karangan = tanpa peran', kso.peran_saya() is null and (select count(*) = 0 from kso.rencana_kso));
select set_config('wrg.kso_user', '', false);
select set_config('wrg.kso_peran', 'direksi', false);
select uji.cek('Peran tanpa identitas = tanpa peran', kso.peran_saya() is null);
select uji.harus_gagal('Peran tanpa identitas tidak bisa memutus', 'select kso.app_putus_direksi(2,''SETUJU'')', 'PERAN_TIDAK_BERWENANG');

-- 3. AM & HOD: ref dari GUC membatasi baris
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-00000000bbbb', false);
select set_config('wrg.kso_peran', 'am', false);
select set_config('wrg.kso_ref', 'AM-01', false);
select uji.cek('AM dari Akses Grup hanya melihat rencananya sendiri', (select bool_and(am_id = 'AM-01') and count(*) > 0 from kso.v_rencana));
select uji.harus_gagal('AM web tidak bisa memutus atas nama Direksi', 'select kso.app_putus_direksi(2,''SETUJU'')', 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_peran', 'hod', false);
select set_config('wrg.kso_ref', 'HA-BAR', false);
select uji.cek('HOD dari Akses Grup hanya melihat wilayahnya', (select coalesce(bool_and(wilayah = 'Barat'), true) and count(*) > 0 from kso.v_rencana));

-- 4. bot tetap jalan lewat kso.pengguna (tanpa GUC peran)
select set_config('wrg.kso_user', 'bot-wa', false);
select set_config('wrg.kso_peran', '', false);
select set_config('wrg.kso_ref', '', false);
select uji.cek('Akun mesin bot-wa tetap berperan bot_wa dari kso.pengguna', kso.peran_saya() = 'bot_wa');
reset role;
