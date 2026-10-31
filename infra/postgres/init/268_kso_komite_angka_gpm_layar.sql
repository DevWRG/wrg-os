-- 268 — F170 v2 Fase C3: angka GPM untuk layar Komite KSO (Pedoman Komite KSO Forum v01)
--
-- Layar (Direksi, Komite, Sekretariat, HOD, AM pemilik) menampilkan GPM deal + harga minimum per zona
-- dan memakai tiga harga sebagai nilai awal form Putusan Direksi. kso.hitung_gpm tetap tertutup untuk
-- aplikasi; pembungkus ini hanya memberi angka untuk rencana yang BOLEH DILIHAT peran pemanggil
-- (kso.boleh_lihat — aturan RLS yang sama dengan tabel rencana). Bot WA tetap memakai app_bot_angka_gpm (267).

set search_path = kso, public;

create or replace function kso.app_angka_gpm(p_id bigint)
returns table (gpm numeric, zona text, hd boolean, catatan text, biaya_per_tes numeric,
               harga_am numeric, harga_hod numeric, harga_forum numeric, volume_min_forum numeric)
language plpgsql stable security definer set search_path = kso, public as $$
begin
  if kso.uid_saya() is null or not kso.boleh_lihat(p_id) then
    raise exception 'PERAN_TIDAK_BERWENANG: rencana % di luar akses', p_id;
  end if;
  return query select g.gpm, g.zona, g.hd, g.catatan, g.biaya_per_tes, g.harga_am, g.harga_hod, g.harga_forum, g.volume_min_forum
                 from kso.hitung_gpm(p_id) g;
end $$;

revoke execute on function kso.app_angka_gpm(bigint) from public;
grant execute on function kso.app_angka_gpm(bigint) to wrg_app;
