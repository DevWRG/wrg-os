-- Uji migrasi 302: FEE memotong harga untuk GPM, harga minimum per zona = harga KOTOR, lampiran PDF Simulator
-- (tulis lewat bot, baca ikut boleh_lihat), isian tertunda menunggu pilihan alat. DB UJI saja, sesudah 900–917.
-- Tiruan 005: Z3 vol 900 → biaya 4.666,67/tes (angka fiktif).
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d918 (k text primary key, v bigint);
grant all on uji.d918 to wrg_app;
do $$ declare x bigint; y bigint; begin
  x := kso.buat_draft('AM-01','F04','Z3',1,900,null,18500,null,36,'{}','[]');
  y := kso.buat_draft('AM-01','F04','Z3',1,900,null,18500,null,36,'{}','[]');
  insert into uji.d918 values ('x', x), ('y', y) on conflict (k) do update set v = excluded.v;
end $$;

-- 1. fee kosong = perilaku lama
select uji.cek('Fee kosong → GPM = 1 − biaya/harga (sama dengan 284)',
   (select round(gpm, 4) = round(1 - biaya_per_tes / 18500, 4) from kso.hitung_gpm((select v from uji.d918 where k='x'))));

-- 2. fee 10% → GPM dari harga bersih 16.650; harga minimum = harga kotor
select kso.lengkapi_draft((select v from uji.d918 where k='x'), '{"fee_persen": 10}');
select uji.cek('Fee tersimpan & tercatat dinyatakan',
   (select fee_persen = 10 and 'fee_persen' = any(kolom_dinyatakan) from kso.rencana_kso where id = (select v from uji.d918 where k='x')));
select uji.cek('Fee 10% → GPM = 1 − biaya/(harga × 0,9)',
   (select round(gpm, 4) = round(1 - biaya_per_tes / 16650, 4) from kso.hitung_gpm((select v from uji.d918 where k='x'))));
select uji.cek('Fee 10% → harga minimum AM/HOD/Forum = biaya ÷ (1 − g) ÷ 0,9 (harga kotor)',
   (select round(harga_am, 2) = round(biaya_per_tes / 0.45 / 0.9, 2) and round(harga_hod, 2) = round(biaya_per_tes / 0.50 / 0.9, 2)
       and round(harga_forum, 2) = round(biaya_per_tes / 0.55 / 0.9, 2)
      from kso.hitung_gpm((select v from uji.d918 where k='x'))));
select uji.cek('Harga minimum AM dengan fee → bersihnya tepat di GPM 55%',
   (select abs((1 - biaya_per_tes / (harga_am * 0.9)) - 0.55) < 0.000001 from kso.hitung_gpm((select v from uji.d918 where k='x'))));
select uji.cek('Fee menurunkan GPM yang tersimpan di rencana (gerbang dihitung ulang)',
   (select a.gpm_deal < b.gpm_deal from kso.rencana_kso a, kso.rencana_kso b
     where a.id = (select v from uji.d918 where k='x') and b.id = (select v from uji.d918 where k='y')));
select uji.cek('Catatan gerbang 1 menyebut harga bersih sesudah fee',
   (select nilai like '%sesudah fee 10%%' from kso.gerbang_hasil where rencana_id = (select v from uji.d918 where k='x') and no = 1));
select uji.cek('Volume minimum Forum memakai harga bersih (lebih besar dari tanpa fee)',
   (select a.volume_min_forum > b.volume_min_forum from kso.hitung_gpm((select v from uji.d918 where k='x')) a,
                                                       kso.hitung_gpm((select v from uji.d918 where k='y')) b));
select uji.harus_gagal('Fee 100% ditolak', format($q$select kso.lengkapi_draft(%s, '{"fee_persen": 100}')$q$, (select v from uji.d918 where k='x')), 'check');

-- 3. klausul ADA + detail → kode 'lainnya' tersedia, gerbang 7 merah
select kso.lengkapi_draft((select v from uji.d918 where k='x'),
   '{"klausul_ada": true, "klausul_detail": "minimal volume tertentu", "klausul": ["lainnya"]}');
select uji.cek('Klausul lain → detail tersimpan, gerbang 7 merah',
   (select klausul_ada and klausul_detail = 'minimal volume tertentu' from kso.rencana_kso where id = (select v from uji.d918 where k='x'))
   and (select status = 'merah' from kso.gerbang_hasil where rencana_id = (select v from uji.d918 where k='x') and no = 7));

-- 4. lampiran lewat bot
set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
select uji.harus_gagal('Aplikasi tak bisa menulis tabel lampiran langsung',
   format($q$insert into kso.rencana_lampiran (rencana_id) values (%s)$q$, (select v from uji.d918 where k='x')), 'permission denied');
select kso.app_bot_catat_lampiran((select v from uji.d918 where k='y'), 'AM-01', 'WA-UJI-1', '/tmp/uji/a.pdf', 'abc',
   '{"isian": {"test_per_bulan": 800}}', '{"volume": {"status": "beda"}}', false, 26, 'Lampiran Simulator CPRR 2026-11-10');
select uji.cek('Lampiran tidak cocok → tercatat, draft tidak berubah',
   (select count(*) = 1 from kso.rencana_lampiran where rencana_id = (select v from uji.d918 where k='y') and not lolos)
   and (select hari_kerja is null and volume_sumber is null from kso.rencana_kso where id = (select v from uji.d918 where k='y')));
select kso.app_bot_catat_lampiran((select v from uji.d918 where k='y'), 'AM-01', 'WA-UJI-2', '/tmp/uji/b.pdf', 'def',
   '{"isian": {"test_per_bulan": 900}}', '{"volume": {"status": "cocok"}}', true, 26, 'Lampiran Simulator CPRR 2026-11-10');
select uji.cek('Lampiran lolos → hari kerja & sumber volume dari PDF, label data',
   (select hari_kerja = 26 and volume_sumber = 'Lampiran Simulator CPRR 2026-11-10' and volume_sumber_label = 'data'
           and 'hari_kerja' = any(kolom_dinyatakan)
      from kso.rencana_kso where id = (select v from uji.d918 where k='y')));
select uji.cek('Gerbang 2 hijau sesudah lampiran lolos (zona AM, bukti tertulis)',
   (select status = 'hijau' from kso.gerbang_hasil where rencana_id = (select v from uji.d918 where k='y') and no = 2));
select kso.app_bot_catat_lampiran((select v from uji.d918 where k='y'), 'AM-01', 'WA-UJI-2', '/tmp/uji/b.pdf', 'def',
   '{}', '{}', true, null, null);
select uji.cek('Pesan PDF yang sama tidak menggandakan baris lampiran',
   (select count(*) = 2 from kso.rencana_lampiran where rencana_id = (select v from uji.d918 where k='y')));
select uji.harus_gagal('Bot tak bisa melampirkan ke rencana AM lain',
   format($q$select kso.app_bot_catat_lampiran(%s, 'AM-03', 'WA-X', null, null, '{}', '{}', false)$q$, (select v from uji.d918 where k='y')),
   'BUKAN_MILIK_PENGIRIM');

-- 5. isian tertunda (alat belum pasti)
select kso.app_bot_simpan_tertunda('AM-01', null, 'F04', '{"volume_estimasi": 700}', 'alat tak dikenal', '[{"kode":"Z3"}]', 'WA-UJI-3');
select kso.app_bot_simpan_tertunda('AM-01', null, 'F04', '{"volume_estimasi": 750}', 'alat tak dikenal 2', '[{"kode":"Z52"}]', 'WA-UJI-4');
select uji.cek('Satu pertanyaan alat terbuka per AM: yang lama ditutup',
   (select count(*) = 1 from kso.intake_tertunda where am_id = 'AM-01' and selesai_at is null and rencana_id is null));
reset role;

-- 6. baca: AM pemilik melihat lampirannya, AM lain tidak; sekretaris melihat
insert into kso.pengguna values ('u-am01-918','am','AM-01'), ('u-am02-918','am','AM-02'), ('u-sek-918','sekretaris',null)
on conflict (user_id) do nothing;
set role wrg_app;
select set_config('wrg.kso_user', 'u-am01-918', false);
select uji.cek('AM pemilik melihat lampiran usulannya',
   (select count(*) = 2 from kso.rencana_lampiran where rencana_id = (select v from uji.d918 where k='y')));
select uji.cek('AM pemilik melihat isian tertundanya', (select count(*) >= 1 from kso.intake_tertunda));
select set_config('wrg.kso_user', 'u-am02-918', false);
select uji.cek('AM lain tidak melihat lampiran (RLS boleh_lihat)', (select count(*) = 0 from kso.rencana_lampiran));
select uji.cek('AM lain tidak melihat isian tertunda AM lain', (select count(*) = 0 from kso.intake_tertunda));
select set_config('wrg.kso_user', 'u-sek-918', false);
select uji.cek('Sekretaris melihat lampiran', (select count(*) >= 2 from kso.rencana_lampiran));
select uji.harus_gagal('Akun web tak bisa memanggil fungsi tulis bot',
   format($q$select kso.app_bot_catat_lampiran(%s, 'AM-01', 'WA-Y', null, null, '{}', '{}', true)$q$, (select v from uji.d918 where k='y')),
   'PERAN_TIDAK_BERWENANG');
reset role;
select set_config('wrg.kso_user', '', false);
