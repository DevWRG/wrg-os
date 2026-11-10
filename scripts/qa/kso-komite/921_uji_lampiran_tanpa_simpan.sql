-- Uji migrasi 305: PDF lampiran Simulator tidak disimpan. dibaca_at (sudah diunggah & dibaca), berkas_dihapus_at,
-- bacaan final tidak ditimpa gagal teknis, penanda hanya lewat bot & hanya untuk lampiran milik AM yang sudah terbaca.
-- DB UJI saja, sesudah 900–920. Data fiktif.
\set ON_ERROR_STOP on
set timezone = 'UTC';
create table if not exists uji.d921 (k text primary key, v bigint);
grant all on uji.d921 to wrg_app;
do $$ declare x bigint; begin
  x := kso.buat_draft('AM-01','F04','Z3',1,900,null,18500,null,36,'{}','[]');
  insert into uji.d921 values ('x', x) on conflict (k) do update set v = excluded.v;
end $$;

-- 1. aturan terbaca
select uji.cek('lampiran_terbaca: ok & galat final → true; gagal teknis → false',
   kso.lampiran_terbaca('{"ok": true}') and kso.lampiran_terbaca('{"ok": false, "galat": "bukan-cprr"}')
   and kso.lampiran_terbaca('{"galat": "pdf-rusak"}') and kso.lampiran_terbaca('{"galat": "cprr-tidak-terbaca"}')
   and not kso.lampiran_terbaca('{"galat": "ocr-timeout"}') and not kso.lampiran_terbaca('{"galat": "dry-run"}')
   and not kso.lampiran_terbaca('{"galat": "ai-tak-terjangkau"}') and not kso.lampiran_terbaca('{"galat": "berkas-tidak-ada"}')
   and not kso.lampiran_terbaca('{}'));

set role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', false);

-- 2. gagal teknis → tercatat, belum terunggah; penanda hapus ditolak (berkas disimpan untuk dibaca ulang)
select kso.app_bot_catat_lampiran((select v from uji.d921 where k='x'), 'AM-01', 'WA-921-1', '/tmp/uji/921a.pdf', 'aaa',
   '{"ok": false, "galat": "ocr-timeout"}', '{}', false);
select uji.cek('Gagal teknis → baris ada, dibaca_at kosong',
   (select dibaca_at is null and berkas_dihapus_at is null from kso.rencana_lampiran where wa_message_id = 'WA-921-1'));
select uji.cek('Gagal teknis → tandai hapus menolak (false), berkas tetap dianggap ada',
   not kso.app_bot_tandai_berkas_dihapus((select id from kso.rencana_lampiran where wa_message_id = 'WA-921-1'), 'AM-01')
   and (select berkas_dihapus_at is null from kso.rencana_lampiran where wa_message_id = 'WA-921-1'));

-- 3. dibaca ulang (pesan sama) & berhasil → dibaca_at terisi
select kso.app_bot_catat_lampiran((select v from uji.d921 where k='x'), 'AM-01', 'WA-921-1', '/tmp/uji/921a.pdf', 'aaa',
   '{"ok": true, "isian": {"test_per_bulan": 900}}', '{"volume": {"status": "cocok"}}', false);
select uji.cek('Baca ulang berhasil → baris sama, dibaca_at terisi, hasil diganti',
   (select count(*) = 1 from kso.rencana_lampiran where wa_message_id = 'WA-921-1')
   and (select dibaca_at is not null and (hasil_ocr->>'ok')::boolean from kso.rencana_lampiran where wa_message_id = 'WA-921-1'));

-- 4. tandai dihapus → ada_berkas (ekspresi API) false, media_path tetap untuk audit, idempoten
select uji.cek('Tandai berkas dihapus → true',
   kso.app_bot_tandai_berkas_dihapus((select id from kso.rencana_lampiran where wa_message_id = 'WA-921-1'), 'AM-01'));
select uji.cek('Sesudah ditandai: berkas_dihapus_at terisi, media_path tetap, ada_berkas (API) = false',
   (select berkas_dihapus_at is not null and media_path = '/tmp/uji/921a.pdf'
           and not (media_path is not null and berkas_dihapus_at is null)
      from kso.rencana_lampiran where wa_message_id = 'WA-921-1'));
do $$ declare t1 timestamptz; t2 timestamptz; begin
  select berkas_dihapus_at into t1 from kso.rencana_lampiran where wa_message_id = 'WA-921-1';
  perform pg_sleep(0.01);
  perform kso.app_bot_tandai_berkas_dihapus((select id from kso.rencana_lampiran where wa_message_id = 'WA-921-1'), 'AM-01');
  select berkas_dihapus_at into t2 from kso.rencana_lampiran where wa_message_id = 'WA-921-1';
  if t1 is distinct from t2 then raise exception 'GAGAL: tandai dua kali mengubah waktu hapus'; end if;
  raise notice 'LULUS  Tandai dua kali idempoten (waktu hapus tak berubah)';
end $$;

-- 5. bacaan final tidak ditimpa gagal teknis (berkas sudah dihapus lalu pesan sama diproses lagi)
select uji.cek('Gagal teknis sesudah terbaca → kembalian NULL',
   kso.app_bot_catat_lampiran((select v from uji.d921 where k='x'), 'AM-01', 'WA-921-1', '/tmp/uji/921a.pdf', null,
     '{"ok": false, "galat": "berkas-tidak-ada"}', '{}', false) is null);
select uji.cek('…dan hasil baca lama utuh (ok, dibaca_at, berkas_dihapus_at)',
   (select (hasil_ocr->>'ok')::boolean and dibaca_at is not null and berkas_dihapus_at is not null and sha256 = 'aaa'
      from kso.rencana_lampiran where wa_message_id = 'WA-921-1'));

-- 6. dicocokkan ulang (hasil ok yang sama) → dibaca_at tidak bergeser
do $$ declare t1 timestamptz; t2 timestamptz; r bigint; begin
  select dibaca_at, rencana_id into t1, r from kso.rencana_lampiran where wa_message_id = 'WA-921-1';
  perform pg_sleep(0.01);
  perform kso.app_bot_catat_lampiran(r, 'AM-01', 'WA-921-1', '/tmp/uji/921a.pdf', 'aaa',
     '{"ok": true, "isian": {"test_per_bulan": 900}}', '{"volume": {"status": "beda"}}', false);
  select dibaca_at into t2 from kso.rencana_lampiran where wa_message_id = 'WA-921-1';
  if t1 is distinct from t2 then raise exception 'GAGAL: cocok ulang menggeser dibaca_at'; end if;
  raise notice 'LULUS  Cocok ulang tidak menggeser dibaca_at';
end $$;

-- 7. galat final (bukan cetakan Simulator) → langsung terbaca
select kso.app_bot_catat_lampiran((select v from uji.d921 where k='x'), 'AM-01', 'WA-921-2', '/tmp/uji/921b.pdf', 'bbb',
   '{"ok": false, "galat": "bukan-cprr"}', '{}', false);
select uji.cek('Galat final → dibaca_at terisi (sudah diunggah)',
   (select dibaca_at is not null from kso.rencana_lampiran where wa_message_id = 'WA-921-2'));

-- 8. pagar
select uji.harus_gagal('Bot tak bisa menandai lampiran usulan AM lain',
   format($q$select kso.app_bot_tandai_berkas_dihapus(%s, 'AM-03')$q$, (select id from kso.rencana_lampiran where wa_message_id = 'WA-921-2')),
   'BUKAN_MILIK_PENGIRIM');
select uji.harus_gagal('Lampiran tak ada → galat', $q$select kso.app_bot_tandai_berkas_dihapus(-1, 'AM-01')$q$, 'LAMPIRAN_TIDAK_ADA');
select uji.harus_gagal('Aplikasi tak bisa mengubah kolom penanda langsung',
   $q$update kso.rencana_lampiran set berkas_dihapus_at = now()$q$, 'permission denied');
reset role;

insert into kso.pengguna values ('u-sek-921','sekretaris',null) on conflict (user_id) do nothing;
set role wrg_app;
select set_config('wrg.kso_user', 'u-sek-921', false);
select uji.harus_gagal('Akun web tak bisa memanggil penanda bot',
   format($q$select kso.app_bot_tandai_berkas_dihapus(%s, 'AM-01')$q$, (select id from kso.rencana_lampiran where wa_message_id = 'WA-921-2')),
   'PERAN_TIDAK_BERWENANG');
reset role;
select set_config('wrg.kso_user', '', false);
