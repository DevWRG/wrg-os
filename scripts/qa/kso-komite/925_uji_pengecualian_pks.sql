-- Uji migrasi 337: PKS menyimpang dari putusan dimintakan restu Direktur (permintaan user 18 Nov 2026).
-- DB UJI saja, sesudah 900–924. Nama & angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d925 (k text primary key, v text);
grant all on uji.d925 to wrg_app;

-- rencana bermandat yang masih berlaku dan sedang di tahap PKS (penawaran terbit), atau terbitkan penawarannya dulu
insert into uji.d925
select 'r', r.id::text from kso.rencana_kso r join kso.mandat m on m.rencana_id = r.id
 where r.status in ('PENAWARAN_TERBIT','DIPUTUS_AM','DIPUTUS_HOD','MANDAT_TERBIT') and m.berlaku_sampai >= kso.hari_ini()
 order by (r.status = 'PENAWARAN_TERBIT') desc, r.id limit 1;
select uji.cek('Ada rencana bermandat untuk diuji', exists (select 1 from uji.d925 where k = 'r'));
insert into uji.d925 select 'lantai', harga_lantai::text from kso.mandat where rencana_id = (select v::bigint from uji.d925 where k = 'r');
insert into uji.d925 select 'tenor', tenor_maks_bulan::text from kso.mandat where rencana_id = (select v::bigint from uji.d925 where k = 'r');
insert into uji.d925 select 'vol', coalesce(volume_minimum, 0)::text from kso.mandat where rencana_id = (select v::bigint from uji.d925 where k = 'r');
insert into uji.d925 select 'wajib', array_to_string(klausul_wajib, ',') from kso.mandat where rencana_id = (select v::bigint from uji.d925 where k = 'r');

-- argumen PKS: harga, tenor, volume, klausul
create or replace function uji.pks925(p_tenor_tambah int, p_alasan text) returns text language sql as $$
  select format($q$select kso.app_minta_pengecualian_pks(%s, %s, %s, %s, string_to_array(%L, ','), %L)$q$,
    (select v from uji.d925 where k = 'r'), (select v::numeric + 500 from uji.d925 where k = 'lantai'),
    (select v::int + p_tenor_tambah from uji.d925 where k = 'tenor'), (select v from uji.d925 where k = 'vol'),
    (select v from uji.d925 where k = 'wajib'), p_alasan) $$;
grant execute on function uji.pks925(int, text) to wrg_app;

set role wrg_app;
select set_config('wrg.kso_user', 'u-sek', false), set_config('wrg.kso_peran', 'sekretaris', false), set_config('wrg.kso_ref', '', false);
do $$ begin
  if (select status from kso.rencana_kso where id = (select v::bigint from uji.d925 where k = 'r')) <> 'PENAWARAN_TERBIT' then
    perform kso.app_terbitkan_penawaran((select v::bigint from uji.d925 where k = 'r'), (select v::numeric + 500 from uji.d925 where k = 'lantai'));
  end if;
end $$;


-- 1. peran & isian
select set_config('wrg.kso_peran', 'am', false);
select uji.harus_gagal('AM tidak bisa meminta restu PKS', uji.pks925(12, 'RS minta tenor lebih panjang'), 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_peran', 'sekretaris', false);
select uji.harus_gagal('Alasan wajib diisi', uji.pks925(12, '   '), 'ALASAN_WAJIB');
select uji.harus_gagal('PKS yang cocok tidak perlu restu — catat langsung', uji.pks925(0, 'cocok'), 'PKS_SUDAH_COCOK');
select uji.cek('PKS cocok yang diuji tidak ikut tercatat (status tetap Penawaran terbit)',
   (select status = 'PENAWARAN_TERBIT' from kso.rencana_kso where id = (select v::bigint from uji.d925 where k = 'r')));

-- 2. permintaan tercatat MENUNGGU dengan selisihnya; permintaan baru membatalkan yang lama
select kso.app_minta_pengecualian_pks((select v::bigint from uji.d925 where k = 'r'), (select v::numeric + 500 from uji.d925 where k = 'lantai'),
   (select v::int + 12 from uji.d925 where k = 'tenor'), (select v::int from uji.d925 where k = 'vol'),
   string_to_array((select v from uji.d925 where k = 'wajib'), ','), 'RS minta tenor lebih panjang');
insert into uji.d925 select 'e1', max(id)::text from kso.pengecualian_pks where rencana_id = (select v::bigint from uji.d925 where k = 'r');
select uji.cek('Permintaan MENUNGGU: angka PKS, selisih dari pagar, peminta tercatat; status rencana tidak berubah',
   (select e.status = 'MENUNGGU' and e.tenor_bulan = (select v::int + 12 from uji.d925 where k = 'tenor') and e.selisih like 'PKS_TIDAK_COCOK: tenor%'
           and e.diminta_oleh = 'sekretaris:u-sek' and r.status = 'PENAWARAN_TERBIT'
      from kso.pengecualian_pks e join kso.rencana_kso r on r.id = e.rencana_id where e.id = (select v::bigint from uji.d925 where k = 'e1')));
select kso.app_minta_pengecualian_pks((select v::bigint from uji.d925 where k = 'r'), (select v::numeric + 500 from uji.d925 where k = 'lantai'),
   (select v::int + 24 from uji.d925 where k = 'tenor'), (select v::int from uji.d925 where k = 'vol'),
   string_to_array((select v from uji.d925 where k = 'wajib'), ','), 'RS minta 24 bulan lebih');
insert into uji.d925 select 'e2', max(id)::text from kso.pengecualian_pks where rencana_id = (select v::bigint from uji.d925 where k = 'r');
select uji.cek('Permintaan baru membatalkan yang lama; hanya satu yang menunggu',
   (select status = 'DIBATALKAN' from kso.pengecualian_pks where id = (select v::bigint from uji.d925 where k = 'e1'))
   and (select count(*) = 1 from kso.pengecualian_pks where rencana_id = (select v::bigint from uji.d925 where k = 'r') and status = 'MENUNGGU'));

-- 3. Direksi memutus
select uji.harus_gagal('Sekretaris tidak bisa merestui sendiri',
   format($q$select kso.app_putus_pengecualian_pks(%s, true, null)$q$, (select v from uji.d925 where k = 'e2')), 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_user', 'u-dir', false), set_config('wrg.kso_peran', 'direksi', false);
select uji.harus_gagal('Menolak wajib alasan',
   format($q$select kso.app_putus_pengecualian_pks(%s, false, ' ')$q$, (select v from uji.d925 where k = 'e2')), 'ALASAN_WAJIB');
select kso.app_putus_pengecualian_pks((select v::bigint from uji.d925 where k = 'e2'), false, 'Tenor terlalu panjang, negosiasi ulang');
select uji.cek('Ditolak: status permintaan DITOLAK + catatan, rencana tetap Penawaran terbit',
   (select e.status = 'DITOLAK' and e.catatan_direksi = 'Tenor terlalu panjang, negosiasi ulang' and e.diputus_oleh = 'direksi:u-dir'
           and r.status = 'PENAWARAN_TERBIT'
      from kso.pengecualian_pks e join kso.rencana_kso r on r.id = e.rencana_id where e.id = (select v::bigint from uji.d925 where k = 'e2')));
select uji.harus_gagal('Permintaan yang sudah diputus tidak bisa diputus lagi',
   format($q$select kso.app_putus_pengecualian_pks(%s, true, null)$q$, (select v from uji.d925 where k = 'e2')), 'PENGECUALIAN_SUDAH_DIPUTUS');

select set_config('wrg.kso_user', 'u-sek', false), set_config('wrg.kso_peran', 'sekretaris', false);
select kso.app_minta_pengecualian_pks((select v::bigint from uji.d925 where k = 'r'), (select v::numeric + 500 from uji.d925 where k = 'lantai'),
   (select v::int + 12 from uji.d925 where k = 'tenor'), (select v::int from uji.d925 where k = 'vol'),
   string_to_array((select v from uji.d925 where k = 'wajib'), ','), 'RS tetap minta tenor lebih panjang');
insert into uji.d925 select 'e3', max(id)::text from kso.pengecualian_pks where rencana_id = (select v::bigint from uji.d925 where k = 'r');
select set_config('wrg.kso_user', 'u-dir', false), set_config('wrg.kso_peran', 'direksi', false);
select kso.app_putus_pengecualian_pks((select v::bigint from uji.d925 where k = 'e3'), true, 'Setuju, faskes strategis');
select uji.cek('Disetujui: PKS tercatat persis seperti yang diajukan, status PKS ditandatangani, jejak restu di riwayat',
   (select e.status = 'DISETUJUI' and r.status = 'PKS_TTD' and r.harga_deal = e.harga_deal and r.pks_tenor_bulan = e.tenor_bulan
           and r.pks_volume_minimum = e.volume_minimum and r.pks_klausul = e.klausul
           and exists (select 1 from kso.riwayat_status s where s.rencana_id = r.id and s.ke = 'PKS_TTD' and s.oleh like '%restu Direktur%')
      from kso.pengecualian_pks e join kso.rencana_kso r on r.id = e.rencana_id where e.id = (select v::bigint from uji.d925 where k = 'e3')));
select set_config('wrg.kso_user', 'u-sek', false), set_config('wrg.kso_peran', 'sekretaris', false);
select uji.harus_gagal('Sesudah PKS tercatat, permintaan baru ditolak (bukan tahap PKS)', uji.pks925(12, 'lagi'), 'BUKAN_TAHAP_PKS');

-- 4. jalan pintas tertutup
select uji.harus_gagal('Aplikasi tak bisa memanggil fungsi inti langsung',
   format($q$select kso.putus_pengecualian_pks(%s, true, null, 'x')$q$, (select v from uji.d925 where k = 'e3')), 'permission denied');
select uji.harus_gagal('Aplikasi tak bisa menulis kso.pengecualian_pks langsung',
   format($q$update kso.pengecualian_pks set status = 'DISETUJUI' where id = %s$q$, (select v from uji.d925 where k = 'e2')), 'permission denied');
reset role;
