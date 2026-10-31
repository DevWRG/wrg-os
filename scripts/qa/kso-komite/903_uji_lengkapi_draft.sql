-- Uji migrasi 229 (melengkapi draft lewat WA) dengan peran bot_wa yang sebenarnya.
-- Jalankan lewat jalankan_uji.sh SETELAH 900–902, di database UJI saja.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d903 (k text primary key, v bigint);
grant all on uji.d903 to wrg_app;

set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);

do $$ declare d bigint; begin
  -- draft dari pesan yang TIDAK menyebut tenor dan unit
  d := kso.app_bot_buat_draft('AM-01','F04','Z3',1,900,'data LIS 3 bulan',null,null,null,'{}',
                              '[{"nama":"dr. Rina SpPK","tipe":"kepala_instalasi"}]');
  insert into uji.d903 values ('d', d);
  perform uji.cek('Draft tanpa tenor: tenor tetap kosong, tidak diisi 36 sendiri',
     (select tenor_bulan is null and harga_per_test is null from kso.rencana_kso where id = d));
  perform uji.harus_gagal('Klausul belum dinyatakan → belum bisa dikirim walau gerbang 7 tampak hijau', format('select kso.app_bot_ajukan(%s,''AM-01'')', d), 'KOLOM_WAJIB_KOSONG: klausul');

  -- jawaban susulan: hanya tenor
  perform kso.app_bot_lengkapi_draft(d, 'AM-01', '{"tenor_bulan": 36}');
  perform uji.cek('Jawaban susulan mengisi tenor', (select tenor_bulan = 36 from kso.rencana_kso where id = d));
  perform uji.cek('Jawaban susulan tidak menghapus isian lain (volume & sumber tetap)',
     (select volume_estimasi = 900 and volume_sumber = 'data LIS 3 bulan' from kso.rencana_kso where id = d));
  perform kso.app_bot_lengkapi_draft(d, 'AM-01', '{"volume_sumber": null, "volume_estimasi": null, "harga_per_test": 18500}');
  perform uji.cek('Kunci bernilai null tidak mengosongkan kolom',
     (select volume_estimasi = 900 and volume_sumber = 'data LIS 3 bulan' and harga_per_test = 18500 from kso.rencana_kso where id = d));
  perform kso.app_bot_lengkapi_draft(d, 'AM-01', '{"pendukung": [{"nama":"Pak Budi","tipe":"pengadaan","cara":"telepon"}], "klausul": ["eksklusivitas"]}');
  perform uji.cek('Pendukung susulan ditambahkan, bukan menggantikan',
     (select count(*) = 2 from kso.rencana_pendukung where rencana_id = d));
  perform uji.cek('Klausul susulan ikut dihitung di gerbang 7',
     (select status = 'merah' from kso.gerbang_hasil where rencana_id = d and no = 7));
  perform kso.app_bot_lengkapi_draft(d, 'AM-01', '{"klausul": []}');
  perform uji.cek('"tanpa klausul" = daftar kosong → gerbang 7 hijau',
     (select status = 'hijau' from kso.gerbang_hasil where rencana_id = d and no = 7));
end $$;

select uji.harus_gagal('Bot tidak bisa melengkapi draft milik AM lain',
   format('select kso.app_bot_lengkapi_draft(%s,''AM-03'',''{"tenor_bulan":12}'')', (select v from uji.d903 where k='d')), 'BUKAN_MILIK_PENGIRIM');

select set_config('wrg.kso_user', 'u-am01', false);
select uji.harus_gagal('AM tidak bisa memanggil pembungkus bot langsung',
   format('select kso.app_bot_lengkapi_draft(%s,''AM-01'',''{"tenor_bulan":12}'')', (select v from uji.d903 where k='d')), 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('AM tidak bisa membaca angka GPM lewat pembungkus bot',
   format('select * from kso.app_bot_angka_gpm(%s)', (select v from uji.d903 where k='d')), 'PERAN_TIDAK_BERWENANG');
select uji.harus_gagal('Fungsi inti lengkapi_draft tidak bisa dipanggil aplikasi',
   format('select kso.lengkapi_draft(%s,''{"tenor_bulan":12}'')', (select v from uji.d903 where k='d')), 'permission denied');

select set_config('wrg.kso_user', 'bot-wa', false);
-- F170 v2 (267, keputusan 31 Okt): jumlah tak disebut = 1 unit, tidak lagi menghalangi pengiriman
select uji.cek('Jumlah tak disebut = 1 unit (bukan pertanyaan wajib)',
   (select jumlah = 1 and not ('jumlah' = any(kolom_dinyatakan)) from kso.rencana_kso where id=(select v from uji.d903 where k='d')));
select kso.app_bot_lengkapi_draft((select v from uji.d903 where k='d'), 'AM-01', '{"alasan_strategis": "Referensi wilayah", "harga_pesaing": 10500}');
select uji.cek('Isian 3 & 7 template Pedoman tersimpan: harga pesaing & alasan strategis',
   (select harga_pesaing = 10500 and alasan_strategis = 'Referensi wilayah' from kso.rencana_kso where id=(select v from uji.d903 where k='d')));
select uji.cek('Bot membaca angka GPM per zona untuk balasan sebelum kirim',
   (select gpm is not null and harga_forum > 0 from kso.app_bot_angka_gpm((select v from uji.d903 where k='d'))));
select uji.cek('Kolom yang dinyatakan tercatat', (select kolom_dinyatakan @> array['klausul','tenor_bulan','alasan_strategis'] from kso.rencana_kso where id=(select v from uji.d903 where k='d')));
select uji.cek('Kunci bernilai null tidak tercatat sebagai dinyatakan', (select not ('volume_sumber' = any(kolom_dinyatakan)) from kso.rencana_kso where id=(select v from uji.d903 where k='d')));
select uji.cek('Draft lengkap bisa dikirim', kso.app_bot_ajukan((select v from uji.d903 where k='d'), 'AM-01') is not null);
select uji.harus_gagal('Sesudah dikirim, isian terkunci',
   format('select kso.app_bot_lengkapi_draft(%s,''AM-01'',''{"tenor_bulan":12}'')', (select v from uji.d903 where k='d')), 'DRAFT_TERKUNCI');
reset role;
