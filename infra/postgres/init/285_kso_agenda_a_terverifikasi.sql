-- 285: F170 — Agenda A hanya memuat usulan yang bukti volumenya SUDAH diperiksa Sekretaris (keputusan user 7 Nov 2026).
-- Usulan zona Forum/Direktur dengan bukti volume tertulis (volume_sumber_label = 'data') yang volume_terverifikasi-nya
-- masih kosong tetap berstatus JALUR_FORUM dan menunggu di antrean Sekretariat · Verifikasi Volume; begitu diperiksa
-- (lolos atau tidak) ia ikut susun_agenda berikutnya. Bukti lisan/kosong tidak menunggu (gerbang 2 sudah merah/belum).
--
-- kso.susun_agenda sudah ditambal dinamis oleh 266 (Agenda B memuat DIPUTUS_AM) — maka di sini juga DITAMBAL pada
-- definisi yang berlaku (pg_get_functiondef), bukan ditulis ulang dari 225. Idempoten.

do $$
declare v_def text; v_baru text;
  v_jangkar constant text := $j$and (select max(s.at) from kso.riwayat_status s where s.rencana_id = r.id and s.ke = 'JALUR_FORUM') <= v_batas$j$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kso' and p.proname = 'susun_agenda';
  if v_def is null then raise exception 'kso.susun_agenda tidak ada'; end if;
  if position('volume_terverifikasi is null' in v_def) > 0 then return; end if;
  if position(v_jangkar in v_def) = 0 then raise exception 'jangkar susun_agenda tidak ditemukan — periksa definisi sebelum menambal'; end if;
  v_baru := replace(v_def, v_jangkar, v_jangkar || E'\n              -- 285: bukti tertulis belum diperiksa Sekretaris → ditahan sampai diverifikasi'
                                     || E'\n              and not (r.zona in (''forum'',''direktur'') and r.volume_sumber_label = ''data'' and r.volume_terverifikasi is null)');
  execute v_baru;
end $$;
