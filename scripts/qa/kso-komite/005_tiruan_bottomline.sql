-- Tiruan tabel F172/F145 (public) untuk uji F170 v2 (migrasi 265/266). Angka FIKTIF — repo publik.
-- Di produksi sumbernya view kso_bottomline_model_v / kso_bottomline_unit_v (256/263) dan
-- kso_analyzer.model_key (264). DB uji hanya memuat skema kso, jadi bentuk kolomnya ditiru di sini.
--
-- Angka dipilih supaya contoh di 900 jatuh ke tiap zona (tenor 36):
--   Z3   reagen 3.000 + (200 rb + 300 rb)/vol + 36 jt/(36·vol) — vol 900: biaya 4.667/tes
--        → Rp 18.500 = GPM 74,8% (AM) · Rp 10.000 = 53,3% (2 HOD)
--   Z52  reagen 5.500 + 600 rb/vol + 72 jt/(36·vol) — vol 2.400 @ Rp 12.000 = 45,1% (Forum); 1 unit idle sejenis
--   EXZ  reagen 60.000 + 1 jt/vol + 270 jt/(36·vol) — vol 1.800 @ Rp 95.000 = 31,9% (Direktur)
--   HDX  satuan tindakan (Hemodialisa) — tanpa zona
set search_path = public;

create table if not exists public.kso_bottomline_parameter (
  id int primary key, bulan int not null, gpm_am numeric not null, gpm_hod numeric not null, gpm_forum numeric not null);
insert into public.kso_bottomline_parameter values (1, 36, 0.55, 0.50, 0.45) on conflict (id) do nothing;

-- bentuk mengikuti tabel prod (074 + 264); 902 memakai tabel yang sama untuk segarkan_referensi
create table if not exists public.kso_analyzer (
  id serial primary key, kode text not null, label text, kategori text, brand text, aktif boolean not null default true, model_key text);
insert into public.kso_analyzer (kode, label, kategori, aktif, model_key) values
  ('Z3', 'Z3', 'HEMATO', false, 'M-Z3'), ('Z52', 'Z52', 'CC', false, 'M-Z52'), ('EXZ8000', 'EXZ8000', 'HEMATO', false, 'M-EXZ'),
  ('HDX', 'HDX', 'HEMATO', false, 'M-HD'), ('TANPA', 'TANPA', 'HEMATO', false, null);
-- aktif = false: baris tiruan GPM tidak ikut disalin segarkan_referensi (902) ke kso.alat

create table if not exists public.kso_bottomline_model_v (
  model_key text primary key, hpp numeric, biaya_per_tes numeric, biaya_tetap_bulan numeric, qc_bulan numeric, satuan text);
insert into public.kso_bottomline_model_v values
  ('M-Z3',  36000000,   3000, 200000,  300000, 'tes'),
  ('M-Z52', 72000000,   5500,      0,  600000, 'tes'),
  ('M-EXZ', 270000000, 60000,      0, 1000000, 'tes'),
  ('M-HD',  150000000, 250000,     0,       0, 'tindakan');

create table if not exists public.kso_bottomline_unit_v (model_key text, account_id bigint, omzet_12 numeric);
insert into public.kso_bottomline_unit_v values
  ('M-Z3', 1, 30000000), ('M-Z3', null, 0),           -- unit tanpa faskes bukan idle
  ('M-Z52', 2, 0), ('M-Z52', 3, 50000000);             -- satu Z52 idle → gerbang relokasi merah

grant select on public.kso_bottomline_parameter, public.kso_analyzer, public.kso_bottomline_model_v,
                public.kso_bottomline_unit_v to wrg_app;

-- alat Hemodialisa + alat tanpa peta model (uji jalur data tak lengkap)
insert into kso.kategori (kode, label, harga_standar_per_test, kontribusi_asumsi, lini) values ('hemodialisa', 'Hemodialisa', null, null, 'non_ivd')
  on conflict do nothing;
insert into kso.alat values ('HDX', 'Mesin HD — hemodialisa', 'hemodialisa', 150000000), ('TANPA', 'Alat tanpa peta — hematologi', 'hematologi', 40000000)
  on conflict do nothing;
