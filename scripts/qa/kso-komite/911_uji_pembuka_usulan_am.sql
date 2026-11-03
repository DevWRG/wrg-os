-- Uji migrasi 272 (keputusan user 3 Nov): harga pembuka mandat tak pernah di bawah harga usulan AM.
-- DB UJI saja, sesudah 900–910. Angka dari tiruan 005: Z52 @2.400 tes → pembuka @55% = Rp 14.700.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d911 (k text primary key, v bigint);
grant all on uji.d911 to wrg_app;

-- a: usulan AM di atas @55% (zona AM) → mandat otomatis membuka di harga usulan AM
-- b: usulan AM di atas @55% yang sampai ke Direksi (status dipasang langsung, seperti 910) → putusan tanpa pembuka
do $$ declare a bigint; b bigint; begin
  a := kso.buat_draft('AM-02','F02','Z52',1,2400,'rekap LIS 6 bulan',16000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  b := kso.buat_draft('AM-02','F02','Z52',1,2400,'PO reagen RS',16000,'idle',36,'{}','[{"nama":"Kepala lab","tipe":"kepala_instalasi"}]');
  insert into uji.d911 values ('a', a), ('b', b) on conflict (k) do update set v = excluded.v;
end $$;
select kso.ajukan((select v from uji.d911 where k='a'));

select uji.cek('Usulan AM Rp 16.000 > @55% Rp 14.700, diputus AM → mandat otomatis pembuka Rp 16.000 (bukan 14.700)',
   (select m.harga_pembuka = 16000 and m.sumber = 'otomatis' and m.harga_pembuka >= m.harga_target and m.harga_target >= m.harga_lantai
      from kso.mandat m join kso.rencana_kso r on r.id = m.rencana_id
     where r.id = (select v from uji.d911 where k='a') and r.status = 'DIPUTUS_AM'));

update kso.rencana_kso set status = 'DIREKOMENDASIKAN' where id = (select v from uji.d911 where k='b');
select kso.putus_direksi((select v from uji.d911 where k='b'), 'SETUJU', null, 11000, 12000, 36, 80000000, 1900);
select uji.cek('Direksi tanpa pembuka, usulan AM Rp 16.000 > @55% → pembuka Rp 16.000',
   (select harga_pembuka = 16000 and harga_target = 12000 and sumber = 'direksi' from kso.mandat where rencana_id = (select v from uji.d911 where k='b')));
update kso.rencana_kso set status = 'DIREKOMENDASIKAN' where id = (select v from uji.d911 where k='b');
select kso.putus_direksi((select v from uji.d911 where k='b'), 'SETUJU', null, 11000, 12000, 36, 80000000, 1900, '{}', 13000);
select uji.cek('Direksi dengan pembuka eksplisit di bawah usulan AM → tetap dipakai apa adanya (Rp 13.000)',
   (select harga_pembuka = 13000 from kso.mandat where rencana_id = (select v from uji.d911 where k='b')));
