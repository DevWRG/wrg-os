-- 331 — F170 (issue #2388): isian teks Komite KSO kini markdown dari editor WYSIWYG (tabel, daftar, tautan). Catatan
-- "loloskan ke forum" (329) dibatasi 500 huruf — terlalu pendek untuk markdown bertabel. Batas jadi 5.000; isi lain = 329.
create or replace function kso.app_loloskan_ke_forum(p_id bigint, p_alasan text default null)
returns text language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('komite', 'sekretaris', 'direksi');
  if length(coalesce(p_alasan, '')) > 5000 then raise exception 'ALASAN_TERLALU_PANJANG'; end if;
  return kso.loloskan_ke_forum(p_id, p_alasan, kso.peran_saya() || ':' || coalesce(kso.uid_saya(), ''));
end $$;
revoke execute on function kso.app_loloskan_ke_forum(bigint, text) from public;
grant execute on function kso.app_loloskan_ke_forum(bigint, text) to wrg_app;
