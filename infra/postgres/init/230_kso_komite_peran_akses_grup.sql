-- 230 — F170 Komite KSO Tahap 4: peran pengguna web dari AKSES GRUP, bukan kso.pengguna
--
-- Keputusan 16 Okt: Komite/Direksi/Admin Sales/Teknik diatur pemilik lewat matriks Akses Grup
-- (satu menu "Komite KSO", satu fitur per tab). Satu orang bisa punya banyak centang, sedangkan
-- kso.pengguna rujukan = satu peran per orang. Jadi untuk pengguna web peran DITETAPKAN API per
-- transaksi, setelah API sendiri memeriksa izin tab di Akses Grup:
--   set_config('wrg.kso_user', <app_user.id>, true)   -- identitas (x-user-id / JWT sub)
--   set_config('wrg.kso_peran', <peran tab>, true)    -- 'am','hod','komite','direksi','admin_sales','teknik'
--   set_config('wrg.kso_ref',  <am_id | hod_key>, true)
-- kso.pengguna tetap dipakai untuk akun mesin (bot-wa). Model kepercayaannya sama dengan 227:
-- koneksi wrg_app dipercaya mengisi GUC; pagarnya = API hanya mengisinya dari sesi sah + izin tab.
-- Pagar peran (wajib_peran), RLS (boleh_lihat), dan pembungkus app_* TIDAK berubah.
--
-- Jejak pelaku: riwayat_status / usulan_komite_catatan / putusan_direksi_catatan dapat kolom
-- oleh_user + oleh_peran yang terisi OTOMATIS (default) dari identitas transaksi — rujukan hanya
-- mencatat label peran ("direksi"), tidak siapa orangnya.

set search_path = kso, public;

comment on table kso.pengguna is
  'Akun MESIN Komite KSO (bot-wa). Pengguna web: peran dari Akses Grup, diisi API lewat GUC wrg.kso_peran (migrasi 230).';

create or replace function kso.peran_saya() returns text language sql stable security definer
set search_path = kso, public as $$
  select case
    when kso.uid_saya() is null then null
    -- peran dari GUC hanya dari daftar peran web; bot_wa TIDAK bisa diklaim lewat GUC
    when nullif(current_setting('wrg.kso_peran', true), '') is not null
      then (select p from (values ('am'),('hod'),('komite'),('sekretaris'),('direksi'),('admin_sales'),('teknik')) v(p)
             where p = current_setting('wrg.kso_peran', true))
    else (select peran from kso.pengguna where user_id = kso.uid_saya())
  end $$;

create or replace function kso.ref_saya() returns text language sql stable security definer
set search_path = kso, public as $$
  select case
    when kso.uid_saya() is null then null
    when nullif(current_setting('wrg.kso_peran', true), '') is not null then nullif(current_setting('wrg.kso_ref', true), '')
    else (select ref_id from kso.pengguna where user_id = kso.uid_saya())
  end $$;

alter table kso.riwayat_status
  add column if not exists oleh_user  text default kso.uid_saya(),
  add column if not exists oleh_peran text default kso.peran_saya();
alter table kso.usulan_komite_catatan
  add column if not exists oleh_user  text default kso.uid_saya(),
  add column if not exists oleh_peran text default kso.peran_saya();
alter table kso.putusan_direksi_catatan
  add column if not exists oleh_user  text default kso.uid_saya(),
  add column if not exists oleh_peran text default kso.peran_saya();
