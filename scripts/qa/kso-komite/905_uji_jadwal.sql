-- Uji migrasi 231 (jadwal: batas hari kerja, job idempoten, notifikasi sekali). DB UJI saja, sesudah 900–904.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists public.master_holiday (tanggal date primary key, nama text);
insert into public.master_holiday values ('2026-10-26', 'Libur uji (Senin)') on conflict do nothing;
create table if not exists uji.d905 (k text primary key, v bigint);
grant all on uji.d905 to wrg_app;

-- 1. hari kerja: Jumat → Senin (akhir pekan dilewati); Jumat sebelum Senin libur → Selasa
select uji.cek('Batas HOD: Kamis 15.00 WIB → Jumat 15.00 WIB',
   kso.tambah_hari_kerja('2026-10-22 15:00+07', 1) = '2026-10-23 15:00+07');
select uji.cek('Batas HOD: Jumat 15.00 WIB → Senin 15.00 WIB (Sabtu/Minggu dilewati)',
   kso.tambah_hari_kerja('2026-10-16 15:00+07', 1) = '2026-10-19 15:00+07');
select uji.cek('Batas HOD: Jumat sebelum Senin libur → Selasa (master_holiday dilewati)',
   kso.tambah_hari_kerja('2026-10-23 15:00+07', 1) = '2026-10-27 15:00+07');
select uji.cek('Jam WIB tetap walau server UTC (Jumat 23.30 WIB → Senin 23.30 WIB)',
   kso.tambah_hari_kerja('2026-10-16 16:30+00', 1) = '2026-10-19 23:30+07');

-- 2. lewat batas memakai hari kerja: usulan Jumat yang "lewat 24 jam" di hari Minggu BELUM lewat batas
do $$ declare x bigint; begin
  insert into kso.cabang_teknisi (cabang, kategori) values ('Kediri', 'HEMATO') on conflict do nothing;
  x := kso.buat_draft('AM-02','F06','Z3',1,700,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(x);
  insert into uji.d905 values ('x', x) on conflict (k) do update set v = excluded.v;
end $$;
-- diajukan Jumat 16 Okt 10.00 WIB
update kso.rencana_kso set diajukan_at = '2026-10-16 10:00+07' where id = (select v from uji.d905 where k='x');
select uji.cek('Batas di antrean HOD = Senin 10.00 WIB (bukan Sabtu)',
   (select bool_and(batas = '2026-10-19 10:00+07') from kso.v_antrean where rencana_id = (select v from uji.d905 where k='x') and antrean = 'HOD · Minta Putusan'));
select uji.cek('Minggu (lewat 24 jam, belum lewat 1 hari kerja) → tidak dianggap setuju',
   (select count(*) = 0 from kso.rencana_kso r where r.id = (select v from uji.d905 where k='x')
      and kso.batas_putusan_hod(r.diajukan_at) < '2026-10-18 10:00+07'::timestamptz));

-- 3. pembungkus job: hanya akun mesin sekretaris; idempoten
set role wrg_app;
select set_config('wrg.kso_user', 'u-am01', false);
select uji.harus_gagal('AM tidak bisa menjalankan job agenda', 'select kso.app_job_susun_agenda(''2026-11-03'')', 'PERAN_TIDAK_BERWENANG');
select set_config('wrg.kso_user', 'job-jadwal', false);
select uji.cek('Akun mesin job-jadwal berperan sekretaris', kso.peran_saya() = 'sekretaris');
do $$ declare a bigint; b bigint; begin
  a := kso.app_job_susun_agenda('2026-11-03');
  b := kso.app_job_susun_agenda('2026-11-03');
  perform uji.cek('Job agenda dua kali (restart) → forum yang sama, tidak ganda', a = b and (select count(*) = 1 from kso.forum where tanggal = '2026-11-03'));
end $$;
select uji.cek('Job lewat batas berjalan lewat pembungkus', kso.app_job_lewat_batas_hod() >= 0);
select uji.cek('Notifikasi: kunci baru boleh kirim', kso.app_job_tandai_notif('uji:agenda:2026-11-03', 'agenda'));
select uji.cek('Notifikasi: kunci yang sama tidak dikirim dua kali', not kso.app_job_tandai_notif('uji:agenda:2026-11-03', 'agenda'));
select kso.app_job_batal_notif('uji:agenda:2026-11-03');
select uji.cek('Notifikasi gagal kirim → tanda dibatalkan, boleh dicoba lagi', kso.app_job_tandai_notif('uji:agenda:2026-11-03', 'agenda'));
select uji.harus_gagal('Tabel notifikasi tidak terbaca langsung oleh aplikasi', 'select count(*) from kso.notifikasi_terkirim', 'permission denied');
reset role;

-- 4. verifikasi bulan ke-6 dari laporan tes (tabel OS tiruan, angka fiktif)
create table if not exists public.kso_tes_faskes_v (account_id bigint, skema text, jenis text, periode date, jumlah_tes numeric, sumber text);
insert into kso.faskes (id, nama, cabang, piutang_hari, piutang_nilai, tagihan_bulanan) values
  ('9101','RS Uji Verifikasi Baru','Surabaya',0,0,0), ('9102','RS Uji Verifikasi Lama','Surabaya',0,0,0) on conflict do nothing;
do $$ declare a bigint; b bigint; begin
  a := kso.buat_draft('AM-01','9101','Z3',1,800,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  b := kso.buat_draft('AM-01','9102','Z3',1,800,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  insert into kso.verifikasi_bulan6 (rencana_id, serah_terima, volume_dijanjikan) values (a, '2026-03-10', 800), (b, '2026-03-10', 800);
  insert into uji.d905 values ('va', a), ('vb', b) on conflict (k) do update set v = excluded.v;
end $$;
insert into public.kso_tes_faskes_v values
  (9101, 'PER_TEST', 'Hematology 3Diff', '2026-09-01', 700, 'accurate'),   -- faskes baru: bulan ke-6 = Sep
  (9102, 'PER_TEST', 'Hematology 3Diff', '2026-01-01', 300, 'accurate'),   -- faskes lama: sudah ada tes sebelum serah terima
  (9102, 'PER_TEST', 'Hematology 3Diff', '2026-09-01', 900, 'accurate');
set role wrg_app;
select set_config('wrg.kso_user', 'job-jadwal', false);
select uji.cek('Verifikasi bulan-6: faskes tanpa tes jenis sama sebelumnya → aktual diisi dari laporan',
   (kso.app_job_verifikasi_bulan6('2026-10-06')->>'diisi')::int >= 1);
reset role;
select uji.cek('Rasio akurasi volume = aktual ÷ janji (700/800)', (select rasio = 0.875 from kso.verifikasi_bulan6 where rencana_id = (select v from uji.d905 where k='va')));
select uji.cek('Faskes yang sudah punya tes sebelum serah terima → TIDAK diisi (tes alat lama tercampur)',
   (select volume_aktual is null from kso.verifikasi_bulan6 where rencana_id = (select v from uji.d905 where k='vb')));
