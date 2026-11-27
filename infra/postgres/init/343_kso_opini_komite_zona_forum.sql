-- 343 — F170 Komite KSO: OPINI KOMITE dibuka juga untuk usulan Zona Forum (permintaan user 26 Nov 2026).
--
-- 338 membatasi opini ke zona = 'direktur'. Usulan Zona Forum (mis. yang diloloskan ke forum, 329) juga butuh
-- kajian tertulis Komite sebelum/selama forum. Jendela status & penguncian tetap sama dengan 338
-- (terkunci sesudah Direksi memutus). Zona AM/HOD tetap tidak bisa (diputus di jalur cepat, bukan Komite).
-- Kode galat lama OPINI_HANYA_ZONA_DIREKTUR diganti OPINI_HANYA_ZONA_FORUM_DIREKTUR.

create or replace function kso.isi_opini_komite(p_id bigint, p_opini text, p_oleh text)
returns void language plpgsql as $$
declare r kso.rencana_kso;
begin
  select * into r from kso.rencana_kso where id = p_id for update;
  if not found then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if r.zona is null or r.zona not in ('forum','direktur') then raise exception 'OPINI_HANYA_ZONA_FORUM_DIREKTUR'; end if;
  if r.status not in ('DIAJUKAN','JALUR_FORUM','DIAGENDAKAN','DITAHAN','DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN') then
    raise exception 'OPINI_TERKUNCI: status %', r.status; end if;
  if length(coalesce(p_opini, '')) > 20000 then raise exception 'OPINI_TERLALU_PANJANG'; end if;
  update kso.rencana_kso
     set opini_komite = nullif(btrim(coalesce(p_opini, '')), ''), opini_komite_oleh = p_oleh, opini_komite_at = now()
   where id = p_id;
end $$;

revoke execute on function kso.isi_opini_komite(bigint, text, text) from public;

comment on column kso.rencana_kso.opini_komite is '338/343: opini Komite (markdown) untuk usulan Zona Forum & Direktur — bahan forum/putusan Direksi.';
