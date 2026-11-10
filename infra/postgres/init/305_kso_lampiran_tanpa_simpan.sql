-- 305 — F170 Komite KSO: PDF lampiran Simulator TIDAK disimpan di server.
--
-- Keputusan product owner (10 Nov 2026): "untuk PDF lampiran simulator, lu gk perlu simpan, cukup baca aja pakai
-- tesseract, dan lu tandai kalo lampiran simulator udah di upload. biar server gk penuh".
--
-- Berkas PDF ditulis bridge openclaw ke MEDIA_ROOT (~/.openclaw/media/inbound/…, wa_message.media_path). Sesudah PDF
-- dibaca /kso/ocr-cprr dan hasilnya tercatat di kso.rencana_lampiran, API MENGHAPUS berkasnya bila:
--   * terbaca (ok = true), atau
--   * pasti tak bisa dipakai (galat pdf-rusak · bukan-cprr · cprr-tidak-terbaca) — kirim ulang PDF baru.
-- Kegagalan teknis (ocr-tidak-tersedia · render-tidak-tersedia · ocr-timeout · ocr-gagal · ai-tak-terjangkau · dry-run ·
-- berkas-tidak-ada) → berkas DISIMPAN supaya bisa dibaca ulang; lampiran belum dianggap terunggah.
--
--   dibaca_at          = lampiran sudah diunggah & dibaca (ok / pasti tak terpakai). Tak berubah saat dicocokkan ulang.
--   berkas_dihapus_at  = berkas PDF di MEDIA_ROOT sudah dihapus (atau memang sudah tak ada).
-- media_path DIBIARKAN (jejak audit: berkas capture mana yang dibaca; dipakai skrip bersih-bersih agar idempoten).
-- "Ada berkas" = media_path is not null and berkas_dihapus_at is null. wa_message.media_path juga dibiarkan: baris
-- PDF itu sudah diproses (processed_at) dan satu PDF dicatat sekali per wa_message_id, jadi tak ada pengambilan ulang.

set search_path = kso, public;

alter table kso.rencana_lampiran
  add column if not exists dibaca_at         timestamptz,
  add column if not exists berkas_dihapus_at timestamptz;
comment on column kso.rencana_lampiran.dibaca_at is
  '305: lampiran Simulator sudah diunggah & dibaca (OCR ok, atau pasti tak terpakai). NULL = gagal teknis, berkas disimpan untuk dibaca ulang.';
comment on column kso.rencana_lampiran.berkas_dihapus_at is
  '305: berkas PDF di MEDIA_ROOT sudah dihapus sesudah dibaca (server tidak menyimpan PDF Simulator). media_path tinggal jejak audit.';

-- Satu aturan "sudah terbaca" (cermin tindakanBerkas di apps/api/src/repo/kso-lampiran-berkas.ts).
create or replace function kso.lampiran_terbaca(p_hasil jsonb) returns boolean
language sql immutable as $$
  select coalesce((p_hasil->>'ok')::boolean, false)
      or coalesce(p_hasil->>'galat', '') in ('pdf-rusak', 'bukan-cprr', 'cprr-tidak-terbaca')
$$;
comment on function kso.lampiran_terbaca(jsonb) is '305: hasil /kso/ocr-cprr final (ok, atau dokumen pasti tak terpakai) → berkas boleh dihapus.';

-- lampiran lama: yang sudah terbaca dianggap diunggah pada saat dicatat
update kso.rencana_lampiran set dibaca_at = dibuat_at where dibaca_at is null and kso.lampiran_terbaca(hasil_ocr);

-- bot: catat satu lampiran (isi 302 + dibaca_at). Pesan PDF yang SUDAH terbaca tidak ditimpa hasil gagal teknis
-- (mis. berkasnya sudah dihapus lalu pesan yang sama diproses lagi) → kembalian NULL, baris lama utuh.
create or replace function kso.app_bot_catat_lampiran(
  p_id bigint, p_am text, p_wa text, p_media text, p_sha256 text, p_hasil jsonb, p_cocok jsonb, p_lolos boolean,
  p_hari_kerja int default null, p_sumber text default null)
returns bigint language plpgsql security definer set search_path = kso, public as $$
declare v_id bigint; v_status kso.status_rencana; v_terbaca boolean := kso.lampiran_terbaca(coalesce(p_hasil, '{}'));
begin
  perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am);
  select status into v_status from kso.rencana_kso where id = p_id for update;
  insert into kso.rencana_lampiran as l (rencana_id, wa_message_id, media_path, sha256, hasil_ocr, cocok, lolos, dibaca_at)
  values (p_id, p_wa, p_media, p_sha256, coalesce(p_hasil, '{}'), coalesce(p_cocok, '{}'), coalesce(p_lolos, false),
          case when v_terbaca then now() end)
  on conflict (rencana_id, wa_message_id) where wa_message_id is not null
  do update set media_path = coalesce(excluded.media_path, l.media_path), sha256 = coalesce(excluded.sha256, l.sha256),
                hasil_ocr = excluded.hasil_ocr, cocok = excluded.cocok, lolos = excluded.lolos, dibuat_at = now(),
                dibaca_at = coalesce(l.dibaca_at, excluded.dibaca_at)
          where v_terbaca or l.dibaca_at is null
  returning id into v_id;
  if v_id is null then return null; end if;
  if coalesce(p_lolos, false) and v_status in ('DRAFT','DITAHAN') then
    perform kso.lengkapi_draft(p_id, jsonb_strip_nulls(jsonb_build_object(
      'hari_kerja', case when p_hari_kerja between 1 and 31 then p_hari_kerja end,
      'volume_sumber', nullif(btrim(p_sumber), ''))), 'ai_wa');
    -- bukti = cetakan Simulator yang angkanya cocok dengan isian → 'data' (trigger 232 tak mengenali kalimat ini)
    if nullif(btrim(p_sumber), '') is not null then
      update kso.rencana_kso set volume_sumber_label = 'data' where id = p_id and not volume_sumber_label_manual;
      perform kso.hitung_gerbang(p_id);
    end if;
  end if;
  return v_id;
end $$;

-- bot: tandai berkas PDF lampiran sudah dihapus dari MEDIA_ROOT. Hanya lampiran yang sudah terbaca (berkas gagal
-- teknis tetap disimpan) dan milik AM itu. Idempoten: true = baris ditandai (atau sudah bertanda).
create or replace function kso.app_bot_tandai_berkas_dihapus(p_lampiran bigint, p_am text) returns boolean
language plpgsql security definer set search_path = kso, public as $$
declare v_rencana bigint; v_dibaca timestamptz;
begin
  perform kso.wajib_peran('bot_wa');
  select rencana_id, dibaca_at into v_rencana, v_dibaca from kso.rencana_lampiran where id = p_lampiran;
  if not found then raise exception 'LAMPIRAN_TIDAK_ADA: %', p_lampiran; end if;
  perform kso.wajib_milik(v_rencana, p_am);
  if v_dibaca is null then return false; end if;
  update kso.rencana_lampiran set berkas_dihapus_at = coalesce(berkas_dihapus_at, now()) where id = p_lampiran;
  return true;
end $$;

revoke execute on function kso.app_bot_catat_lampiran(bigint, text, text, text, text, jsonb, jsonb, boolean, int, text),
                           kso.app_bot_tandai_berkas_dihapus(bigint, text) from public;
grant execute on function kso.app_bot_catat_lampiran(bigint, text, text, text, text, jsonb, jsonb, boolean, int, text),
                          kso.app_bot_tandai_berkas_dihapus(bigint, text) to wrg_app;
