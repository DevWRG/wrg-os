-- Uji migrasi 303: faskes BARU (calon customer) dari #KSO — dibuat lewat bot, tak tersentuh segarkan_referensi,
-- gerbang 5 hijau, isian tertunda menampung alat + faskes, ditautkan Sekretariat ke akun master.
-- DB UJI saja, sesudah 900–918 (902 membuat tiruan tabel OS + faskes 9001/9002). Nama & angka fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d919 (k text primary key, v text);
grant all on uji.d919 to wrg_app;

-- 1. bot membuat faskes baru; nama sama dipakai ulang
set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
select set_config('wrg.kso_peran', '', false);
insert into uji.d919 select 'f', kso.app_bot_buat_faskes_baru('AM-01', '  RS  Uji Coba Fiktif ', null);
select uji.cek('Faskes baru: id BARU-n, baru, cabang = cabang AM, piutang/tagihan 0, pembuat tercatat',
   (select id like 'BARU-%' and baru and nama = 'RS Uji Coba Fiktif' and cabang = (select cabang from kso.am where id = 'AM-01')
           and piutang_hari = 0 and piutang_nilai = 0 and tagihan_bulanan = 0 and dibuat_oleh_am = 'AM-01' and dibuat_at is not null
      from kso.faskes where id = (select v from uji.d919 where k = 'f')));
insert into uji.d919 select 'f2', kso.app_bot_buat_faskes_baru('AM-02', 'rs uji coba fiktif', 'Kota Fiktif');
select uji.cek('Nama sama (beda huruf besar/spasi) → faskes yang sama, tidak digandakan; kota kosong terisi',
   (select v from uji.d919 where k = 'f2') = (select v from uji.d919 where k = 'f')
   and (select count(*) = 1 from kso.faskes where upper(nama) = 'RS UJI COBA FIKTIF')
   and (select kota = 'Kota Fiktif' from kso.faskes where id = (select v from uji.d919 where k = 'f')));
select uji.harus_gagal('Nama faskes kosong ditolak', $q$select kso.app_bot_buat_faskes_baru('AM-01', ' ', null)$q$, 'FASKES_NAMA_TIDAK_SAH');
select uji.harus_gagal('Aplikasi tak bisa menulis kso.faskes langsung',
   $q$insert into kso.faskes (id, nama, baru) values ('BARU-X', 'x', true)$q$, 'permission denied');
insert into uji.d919 select 'k', kso.app_bot_isi_kota_faskes('AM-01', (select v from uji.d919 where k = 'f'), 'Kota Lain')::text;
select uji.cek('Kota yang sudah terisi tidak ditimpa',
   (select v = 'false' from uji.d919 where k = 'k') and (select kota = 'Kota Fiktif' from kso.faskes where id = (select v from uji.d919 where k = 'f')));
select uji.cek('Kota faskes master tidak diubah lewat bot', not kso.app_bot_isi_kota_faskes('AM-01', '9001', 'Kota Lain'));

-- 2. draft dengan faskes baru: gerbang 5 hijau, coverage dari cabang AM, tampil di v_rencana
insert into uji.d919 select 'd', kso.app_bot_buat_draft('AM-01', (select v from uji.d919 where k = 'f'), 'Z3', 1, 700, null, 11800, null, 36,
                                                       '{}', '[]', 'WA-UJI-919', null, null)::text;
select uji.cek('Gerbang 5 hijau untuk faskes baru (belum ada tagihan)',
   (select status = 'hijau' and nilai = 'Faskes baru — belum ada tagihan' from kso.gerbang_hasil
     where rencana_id = (select v::bigint from uji.d919 where k = 'd') and no = 5));
select uji.cek('Gerbang 4 tidak "di luar coverage" (cabang AM)',
   (select coalesce(nilai, '') not like '%luar coverage%' from kso.gerbang_hasil where rencana_id = (select v::bigint from uji.d919 where k = 'd') and no = 4));
select uji.cek('v_rencana memuat usulan dengan faskes baru',
   (select faskes_nama = 'RS Uji Coba Fiktif' from kso.v_rencana where id = (select v::bigint from uji.d919 where k = 'd')));

-- 3. isian tertunda: alat DAN faskes belum pasti; dijawab satu per satu
insert into uji.d919 select 't', kso.app_bot_tertunda_simpan('AM-01', '{"volume_estimasi": 700}', 'WA-UJI-919B', null, 'RS MITRA KELURGA',
   '[{"id":"9001","nama":"x"},{"id":"9002","nama":"y"}]', null, null, 'Z5X', '[{"kode":"Z3"}]', 'WA-PDF-1', '/tmp/uji/919.pdf')::text;
select uji.cek('Tertunda menyimpan pilihan faskes, pilihan alat, dan PDF pesan asli',
   (select faskes_id is null and jsonb_array_length(faskes_saran) = 2 and alat_kode is null and jsonb_array_length(saran) = 1
           and lampiran_wa = 'WA-PDF-1' and lampiran_path = '/tmp/uji/919.pdf'
      from kso.intake_tertunda where id = (select v::bigint from uji.d919 where k = 't')));
select kso.app_bot_tertunda_isi((select v::bigint from uji.d919 where k = 't'), 'AM-01', '{"faskes_id": null, "faskes_teks": "RS MITRA KELURGA", "faskes_saran": [], "kota": "Kota Fiktif"}');
select uji.cek('FASKES BARU: pilihan faskes dikosongkan, faskes_id tetap kosong (dibuat saat draft jadi), kota tersimpan; alat masih terbuka',
   (select faskes_id is null and faskes_saran = '[]'::jsonb and kota = 'Kota Fiktif' and alat_kode is null and jsonb_array_length(saran) = 1
      from kso.intake_tertunda where id = (select v::bigint from uji.d919 where k = 't')));
select kso.app_bot_tertunda_isi((select v::bigint from uji.d919 where k = 't'), 'AM-01', '{"alat_kode": "Z3"}');
select uji.cek('Alat dijawab → alat_kode terisi, isian lain utuh',
   (select alat_kode = 'Z3' and isian->>'volume_estimasi' = '700' from kso.intake_tertunda where id = (select v::bigint from uji.d919 where k = 't')));
select uji.harus_gagal('AM lain tak bisa mengubah isian tertunda milik AM-01',
   format($q$select kso.app_bot_tertunda_isi(%s, 'AM-02', '{"alat_kode": "Z3"}')$q$, (select v from uji.d919 where k = 't')), 'TERTUNDA_TIDAK_ADA');
select uji.harus_gagal('Tertunda tanpa faskes sama sekali ditolak',
   $q$select kso.app_bot_tertunda_simpan('AM-01', '{}', null, null, ' ', '[]', null, 'Z3', null, '[]')$q$, 'TERTUNDA_TANPA_FASKES');
select kso.app_bot_tertunda_simpan('AM-01', '{}', null, '9001', 'RS A', '[]', null, null, 'Z5X', '[]');
select uji.cek('Satu pertanyaan terbuka per AM: simpan baru menutup yang lama',
   (select count(*) = 1 from kso.intake_tertunda where am_id = 'AM-01' and selesai_at is null and rencana_id is null));

-- 4. hak: AM (web) tak bisa membuat faskes / menautkan
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000aa', false);
select set_config('wrg.kso_peran', 'am', false);
select set_config('wrg.kso_ref', 'AM-01', false);
select uji.harus_gagal('AM web tak bisa membuat faskes baru (khusus bot)',
   $q$select kso.app_bot_buat_faskes_baru('AM-01', 'RS Fiktif Lain', null)$q$, 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('AM tak bisa menautkan faskes',
   format($q$select kso.app_tautkan_faskes(%s, '9001')$q$, (select v from uji.d919 where k = 'd')), 'PERAN_TIDAK_BERWENANG');
reset role;

-- 5. penyegaran malam: faskes baru tidak dihapus / ditimpa
select kso.segarkan_referensi();
select uji.cek('segarkan_referensi tidak menyentuh faskes baru (nama, cabang, kota, penanda tetap)',
   (select baru and nama = 'RS Uji Coba Fiktif' and kota = 'Kota Fiktif' and cabang = (select cabang from kso.am where id = 'AM-01')
           and piutang_hari = 0 and ditautkan_ke is null
      from kso.faskes where id = (select v from uji.d919 where k = 'f')));
select uji.cek('Faskes master tetap disegarkan & bukan faskes baru', (select not baru from kso.faskes where id = '9001'));
select uji.harus_gagal('CHECK: id BARU-… wajib baru = true', $q$insert into kso.faskes (id, nama) values ('BARU-9999', 'x')$q$, 'check');
select uji.harus_gagal('CHECK: baris master (id angka) tak bisa ditandai baru', $q$update kso.faskes set baru = true where id = '9001'$q$, 'check');

-- 6. Sekretariat menautkan ke akun master → usulan pindah, gerbang draft dihitung ulang dengan data master
set role wrg_app;
select set_config('wrg.kso_user', 'a1b2c3d4-0000-0000-0000-0000000000ab', false);
select set_config('wrg.kso_peran', 'sekretaris', false);
select set_config('wrg.kso_ref', '', false);
select uji.harus_gagal('Tautkan ke akun yang tak ada di referensi → ditolak',
   format($q$select kso.app_tautkan_faskes(%s, '777777')$q$, (select v from uji.d919 where k = 'd')), 'AKUN_MASTER_TIDAK_ADA');
select uji.cek('Tautkan → satu usulan dipindah', (select kso.app_tautkan_faskes((select v::bigint from uji.d919 where k = 'd'), '9001') = 1));
select uji.harus_gagal('Tautkan dua kali → ditolak (sudah bukan faskes baru)',
   format($q$select kso.app_tautkan_faskes(%s, '9002')$q$, (select v from uji.d919 where k = 'd')), 'FASKES_BUKAN_BARU');
reset role;
select uji.cek('Usulan kini memakai akun master; faskes baru menyimpan jejak tautan',
   (select faskes_id = '9001' from kso.rencana_kso where id = (select v::bigint from uji.d919 where k = 'd'))
   and (select ditautkan_ke = '9001' and ditautkan_oleh = 'a1b2c3d4-0000-0000-0000-0000000000ab' and ditautkan_at is not null
          from kso.faskes where id = (select v from uji.d919 where k = 'f')));
select uji.cek('Gerbang 5 dihitung ulang dengan piutang akun master',
   (select nilai <> 'Faskes baru — belum ada tagihan' from kso.gerbang_hasil where rencana_id = (select v::bigint from uji.d919 where k = 'd') and no = 5));
set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
select set_config('wrg.kso_peran', '', false);
insert into uji.d919 select 'f3', kso.app_bot_buat_faskes_baru('AM-01', 'RS Uji Coba Fiktif', null);
reset role;
select uji.cek('Faskes baru yang sudah ditautkan tidak dipakai ulang untuk nama yang sama',
   (select v from uji.d919 where k = 'f3') <> (select v from uji.d919 where k = 'f'));
