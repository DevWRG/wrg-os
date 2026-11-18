-- 338 — F170 Komite KSO: OPINI KOMITE untuk usulan Zona Direktur (permintaan user 18 Nov 2026).
--
-- Zona Direktur diputus Direktur. Komite menyiapkan bahan putusannya: opini kelayakan (NPV, IRR, payback, syarat
-- non-keuangan, reviu pasca implementasi, tabel arus kas, dst.) — teks berformat markdown dari editor (tabel didukung).
--   - Diisi/diubah oleh peran komite, hanya bila zona = 'direktur', sejak diajukan sampai sebelum Direksi memutus
--     (DIAJUKAN, JALUR_FORUM, DIAGENDAKAN, DITAHAN, DIREKOMENDASIKAN*, TIDAK_DIREKOMENDASIKAN). Sesudah putusan terkunci.
--   - Memuat angka keuangan → API membuangnya untuk tab yang disaring (AM, HOD Sales, Admin Sales, Sekretariat).
-- Terpisah dari usulan_komite_catatan.alasan (alasan rekomendasi per forum): opini boleh disiapkan sebelum forum.

alter table kso.rencana_kso
  add column if not exists opini_komite      text,
  add column if not exists opini_komite_oleh text,
  add column if not exists opini_komite_at   timestamptz;
comment on column kso.rencana_kso.opini_komite is '338: opini Komite (markdown) untuk usulan Zona Direktur — bahan putusan Direktur.';

create or replace function kso.isi_opini_komite(p_id bigint, p_opini text, p_oleh text)
returns void language plpgsql as $$
declare r kso.rencana_kso;
begin
  select * into r from kso.rencana_kso where id = p_id for update;
  if not found then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if r.zona is distinct from 'direktur' then raise exception 'OPINI_HANYA_ZONA_DIREKTUR'; end if;
  if r.status not in ('DIAJUKAN','JALUR_FORUM','DIAGENDAKAN','DITAHAN','DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN') then
    raise exception 'OPINI_TERKUNCI: status %', r.status; end if;
  if length(coalesce(p_opini, '')) > 20000 then raise exception 'OPINI_TERLALU_PANJANG'; end if;
  update kso.rencana_kso
     set opini_komite = nullif(btrim(coalesce(p_opini, '')), ''), opini_komite_oleh = p_oleh, opini_komite_at = now()
   where id = p_id;
end $$;

create or replace function kso.app_isi_opini_komite(p_id bigint, p_opini text)
returns void language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('komite');
  perform kso.isi_opini_komite(p_id, p_opini, 'komite:' || coalesce(kso.uid_saya(), ''));
end $$;

revoke execute on function kso.isi_opini_komite(bigint, text, text) from public;
revoke execute on function kso.app_isi_opini_komite(bigint, text) from public;
grant execute on function kso.app_isi_opini_komite(bigint, text) to wrg_app;
