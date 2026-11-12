-- 312 — F170 Komite KSO: SPH KSO (Surat Penawaran Harga) dari aksi "Terbitkan penawaran" (issue #2297).
--
-- Keputusan product owner 12 Nov 2026:
--   - Setiap penawaran yang terbit (mandat Direksi, zona AM, zona HOD) menghasilkan SPH KSO bernomor.
--   - Penanda tangan Direktur (dipilih dari akun grup Direktur; default Direktur yang memutus).
--   - Masa berlaku penawaran 30 hari sejak terbit. Harga per test BELUM termasuk PPN 11%.
--   - Nomor memakai penghitung SPH yang sama (public.sph_pengaturan) — satu urutan surat penawaran perusahaan.
--
-- kso.sph = SNAPSHOT isi surat saat terbit (harga, masa KSO, volume minimum, klausul wajib, faskes, alat,
-- penanda tangan) supaya PDF yang dicetak ulang kapan pun identik dengan yang dikirim ke faskes, walau
-- rencana/mandat berubah sesudahnya. Satu rencana bisa punya >1 SPH (mis. ditarik ke forum lalu mandat baru).
-- Nomor diambil di API (lib/sph-cetak.ts ambilNomor, sama dengan SPH penjualan) di transaksi yang sama.

create table if not exists kso.sph (
  id              bigserial primary key,
  rencana_id      bigint not null references kso.rencana_kso(id) on delete cascade,
  nomor           text not null,
  harga_per_test  numeric(14,2) not null check (harga_per_test > 0),
  jumlah          int not null default 1 check (jumlah > 0),
  tenor_bulan     int not null check (tenor_bulan > 0),
  volume_minimum  int,
  klausul_wajib   text[] not null default '{}',
  faskes_nama     text not null,
  faskes_kota     text,
  alat_nama       text not null,
  berlaku_hari    int not null default 30 check (berlaku_hari between 1 and 180),
  terbit_at       timestamptz not null default now(),
  berlaku_sampai  date not null,
  ttd_user_id     text,
  ttd_nama        text not null,
  ttd_jabatan     text,
  dibuat_user     text,
  dibuat_peran    text
);
create unique index if not exists sph_nomor_uq on kso.sph (nomor);
create index if not exists sph_rencana_idx on kso.sph (rencana_id, terbit_at desc);
comment on table kso.sph is '312: SPH KSO — snapshot surat penawaran saat "Terbitkan penawaran". Tulis hanya lewat kso.app_catat_sph.';

-- RLS + hak (pola 227/302): baca untuk wrg_app sebatas rencana yang boleh dilihat; tulis lewat fungsi security definer
alter table kso.sph enable row level security;
drop policy if exists baca on kso.sph;
create policy baca on kso.sph for select to wrg_app using (kso.boleh_lihat(rencana_id));
revoke all on kso.sph from public;
revoke all on sequence kso.sph_id_seq from public;
do $$ declare r text; begin
  foreach r in array array['wrg_app','wrg_readonly','wrg_demo_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on kso.sph from %I', r);
      execute format('revoke all on sequence kso.sph_id_seq from %I', r);
    end if;
  end loop;
end $$;
grant select on kso.sph to wrg_app;

-- Catat SPH sesudah kso.app_terbitkan_penawaran (status PENAWARAN_TERBIT, harga ≥ lantai sudah dicek di sana).
-- Peran: Sekretaris atau Admin Sales (sama dengan aksi penawaran). Masa KSO = tenor usulan, dibatasi tenor
-- maksimal mandat; volume minimum & klausul wajib dari mandat.
create or replace function kso.app_catat_sph(
  p_id bigint, p_nomor text, p_harga numeric, p_ttd_user text, p_ttd_nama text, p_ttd_jabatan text,
  p_berlaku_hari int default 30)
returns bigint language plpgsql security definer set search_path = kso, public as $$
declare r kso.rencana_kso; m kso.mandat; v_faskes text; v_kota text; v_alat text; v_id bigint;
begin
  perform kso.wajib_peran('sekretaris', 'admin_sales');
  select * into r from kso.rencana_kso where id = p_id for update;
  if r.id is null then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if r.status <> 'PENAWARAN_TERBIT' then raise exception 'SPH_BELUM_BOLEH: status %', r.status; end if;
  select * into m from kso.mandat where rencana_id = p_id;
  if m.rencana_id is null then raise exception 'TIDAK_ADA_MANDAT'; end if;
  if p_harga is null or p_harga < m.harga_lantai then
    raise exception 'KELUAR_MANDAT: % di bawah lantai %', kso.rp(p_harga), kso.rp(m.harga_lantai);
  end if;
  if coalesce(trim(p_nomor), '') = '' then raise exception 'NOMOR_SPH_KOSONG'; end if;
  if coalesce(trim(p_ttd_nama), '') = '' then raise exception 'PENANDA_TANGAN_KOSONG'; end if;
  select f.nama, f.kota into v_faskes, v_kota from kso.faskes f where f.id = r.faskes_id;
  select coalesce(a.nama, a.kode) into v_alat from kso.alat a where a.kode = r.alat_kode;
  insert into kso.sph (rencana_id, nomor, harga_per_test, jumlah, tenor_bulan, volume_minimum, klausul_wajib,
                       faskes_nama, faskes_kota, alat_nama, berlaku_hari, berlaku_sampai,
                       ttd_user_id, ttd_nama, ttd_jabatan, dibuat_user, dibuat_peran)
  values (p_id, trim(p_nomor), p_harga, greatest(coalesce(r.jumlah, 1), 1),
          least(coalesce(r.tenor_bulan, m.tenor_maks_bulan), coalesce(m.tenor_maks_bulan, r.tenor_bulan)),
          m.volume_minimum, coalesce(m.klausul_wajib, '{}'), coalesce(v_faskes, r.faskes_id), v_kota,
          coalesce(v_alat, r.alat_kode), coalesce(p_berlaku_hari, 30), kso.hari_ini() + coalesce(p_berlaku_hari, 30),
          nullif(trim(p_ttd_user), ''), trim(p_ttd_nama), nullif(trim(p_ttd_jabatan), ''), kso.uid_saya(), kso.peran_saya())
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function kso.app_catat_sph(bigint, text, numeric, text, text, text, int) from public;
grant execute on function kso.app_catat_sph(bigint, text, numeric, text, text, text, int) to wrg_app;
