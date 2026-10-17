-- 233 — F170 Komite KSO: tautan akun login → kursi HOD, KHUSUS Komite KSO
--
-- Tab HOD butuh tahu kursi HOD mana yang diwakili akun yang login (routing dua kursi, RLS
-- "HOD hanya wilayahnya"). Sumber biasanya app_user.hod_key — tapi di prod (17 Okt) keempat akun
-- HOD TIDAK punya hod_key, dan kolom itu juga menentukan cakupan data di SEMUA menu (resolveScope):
-- mengisinya akan diam-diam membatasi apa yang dilihat HOD di Sales Analytics, Visits, AR, dst.
-- Keputusan user 17 Okt: tautan terpisah yang hanya dibaca Komite KSO (repo/kso-komite.ts).
-- Urutan: app_user.hod_key bila ada → kso.hod_akun. Isinya data per lingkungan (id akun berbeda
-- antara dev dan prod) → TIDAK disemai di migrasi; diisi admin/owner langsung di database.

set search_path = kso, public;

create table if not exists kso.hod_akun (
  user_id    text primary key,                         -- app_user.id
  hod_id     text not null references kso.hod(id),     -- = master_hod.hod_key
  catatan    text,
  dibuat_at  timestamptz not null default now()
);
comment on table kso.hod_akun is
  'F170: akun login → kursi HOD, hanya untuk Komite KSO. Tidak mengubah cakupan data menu lain (app_user.hod_key). Diisi owner per lingkungan.';

-- Dibaca API di luar transaksi peran (saat menentukan tab) → tanpa RLS, baca-saja untuk aplikasi.
revoke all on kso.hod_akun from public;
grant select on kso.hod_akun to wrg_app;
