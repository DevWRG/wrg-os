-- Uji migrasi 278: "volume RS turun > 20% dari bukti → mandat dihitung ulang" (Pedoman Komite KSO Forum v01).
-- DB UJI saja, sesudah 900–911 (memakai rencana 'a' dari 910 = mandat Direksi Z52 @ 2.400 tes). Angka tiruan 005.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d912 (k text primary key, v bigint);
grant all on uji.d912 to wrg_app;

-- Z3 tiruan: reagen 3.000 + (200 rb + 300 rb)/vol + 36 jt/(36·vol). @ Rp 18.500 / 900 tes = zona AM.
do $$ declare a bigint; b bigint; d bigint; begin
  a := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  b := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',12000,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  d := kso.buat_draft('AM-02','F06','Z3',1,900,'data LIS',18500,'baru',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  perform kso.ajukan(a); perform kso.ajukan(b);
  insert into uji.d912 values ('a', a), ('b', b), ('d', d) on conflict (k) do update set v = excluded.v;
end $$;
select uji.cek('Prasyarat: dua usulan zona AM → Diputus AM, mandat volume terbukti 900',
   (select count(*) = 2 from kso.rencana_kso r join kso.mandat m on m.rencana_id = r.id
     where r.id in ((select v from uji.d912 where k='a'), (select v from uji.d912 where k='b')) and r.status = 'DIPUTUS_AM' and m.volume_terbukti = 900));

select uji.cek('Turun ≤ 20% (900 → 720) → toleransi, mandat tidak berubah',
   (select kso.volume_turun((select v from uji.d912 where k='a'), 720)->>'hasil' = 'toleransi'
       and (select harga_lantai = 8500 and volume_terbukti = 900 from kso.mandat where rencana_id = (select v from uji.d912 where k='a'))));

-- 900 → 600: biaya 5.500/tes, GPM 70,3% → tetap zona AM → tiga harga dihitung ulang di 600 tes
select uji.cek('Turun > 20% tetap zona AM → mandat dihitung ulang (target 11.000 · lantai 10.000; pembuka tetap ≥ usulan AM 18.500), status tetap',
   (select x->>'hasil' = 'dihitung_ulang' from (select kso.volume_turun((select v from uji.d912 where k='a'), 600) as x) t));
select uji.cek('Mandat sesudah hitung ulang: harga naik, volume terbukti 600, volume minimum 480',
   (select m.harga_pembuka = 18500 and m.harga_target = 11000 and m.harga_lantai = 10000 and m.volume_terbukti = 600 and m.volume_minimum = 480
           and r.status = 'DIPUTUS_AM' and r.volume_estimasi = 600
      from kso.mandat m join kso.rencana_kso r on r.id = m.rencana_id where m.rencana_id = (select v from uji.d912 where k='a')));

-- 900 → 300 @ Rp 12.000: biaya 8.000/tes, GPM 33% → zona Direktur → wewenang AM gugur → ke forum
select uji.cek('Turun > 20% dan zona naik → mandat AM gugur, usulan ditarik ke forum',
   (select kso.volume_turun((select v from uji.d912 where k='b'), 300)->>'hasil' = 'ke_forum'));
select uji.cek('Sesudah ditarik: Jalur forum, jalur FORUM, zona Direktur, alasan forum menyebut volume',
   (select status = 'JALUR_FORUM' and jalur = 'FORUM' and zona = 'direktur' and alasan_forum like 'Volume RS turun dari 900 ke 300%'
      from kso.rencana_kso where id = (select v from uji.d912 where k='b')));

-- mandat Direksi (910 'a': Z52 @ Rp 12.000, lantai 11.000 · target 12.000 · pembuka 14.700 di 2.400 tes) → 1.500 tes:
-- biaya 7.233/tes → harga @45/50/55% = 13.200 / 14.500 / 16.100; jalur forum → dihitung ulang, hanya boleh naik
update kso.rencana_kso set status = 'MANDAT_TERBIT' where id = (select v from uji.d910 where k='a') and status <> 'MANDAT_TERBIT';
select uji.cek('Mandat Direksi: turun > 20% → dihitung ulang, harga hanya naik (13.200 / 14.500 / 16.100)',
   (select x->>'hasil' = 'dihitung_ulang' and (x->>'lantai')::numeric = 13200 and (x->>'target')::numeric = 14500 and (x->>'pembuka')::numeric = 16100
      from (select kso.volume_turun((select v from uji.d910 where k='a'), 1500) as x) t));

select uji.harus_gagal('Usulan tanpa mandat (draft) ditolak',
   format('select kso.volume_turun(%s, 100)', (select v from uji.d912 where k='d')), 'BUKAN_TAHAP_MANDAT');
select uji.harus_gagal('Volume nol ditolak',
   format('select kso.volume_turun(%s, 0)', (select v from uji.d912 where k='a')), 'VOLUME_TIDAK_SAH');

set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);
select uji.harus_gagal('Bot: AM lain tidak bisa melaporkan volume rencana orang lain',
   format('select kso.app_bot_volume_turun(%s, ''AM-01'', 500)', (select v from uji.d912 where k='a')), 'BUKAN_MILIK_PENGIRIM');
select uji.cek('Bot: AM pemilik melapor lewat pembungkus → toleransi di 500 (≥ 480)',
   (select kso.app_bot_volume_turun((select v from uji.d912 where k='a'), 'AM-02', 500)->>'hasil' = 'toleransi'));
select uji.harus_gagal('Fungsi inti tertutup untuk aplikasi',
   format('select kso.volume_turun(%s, 500)', (select v from uji.d912 where k='a')), 'permission denied');
reset role;
