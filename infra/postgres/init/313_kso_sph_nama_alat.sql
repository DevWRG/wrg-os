-- 313 — F170 SPH KSO (issue #2297): nama alat di surat dari katalog analyzer, bukan kode.
--
-- kso.alat.nama untuk alat katalog sering hanya kode ("Z3", "EXZ6000") — tak layak di surat ke faskes. Sumber nama
-- lengkap = public.kso_analyzer.model_key ("<jenis>|<merek model>", F145/F172) → "Zybio Z3 (Hematology 3Diff)".
-- Cadangan: kso.alat.nama (alat baru, 307: nama yang ditulis AM), lalu kode. Hanya isi kso.app_catat_sph yang diganti;
-- tanda tangan & hak sama dengan 312. SPH yang sudah tercatat (snapshot) tidak diubah.

-- plpgsql (bukan sql): badan tak divalidasi saat CREATE — DB uji membuat public.kso_analyzer sesudah migrasi.
create or replace function kso.nama_alat_surat(p_kode text)
returns text language plpgsql stable security definer set search_path = kso, public as $$
begin
  return coalesce(
    (select case when split_part(ka.model_key, '|', 2) <> ''
                 then trim(split_part(ka.model_key, '|', 2)) ||
                      case when trim(split_part(ka.model_key, '|', 1)) <> '' then ' (' || trim(split_part(ka.model_key, '|', 1)) || ')' else '' end
            end
       from public.kso_analyzer ka join kso.alat a on a.kode = ka.kode and not a.baru
      where ka.kode = p_kode and ka.model_key is not null
      order by ka.id limit 1),
    (select nullif(trim(a.nama), '') from kso.alat a where a.kode = p_kode),
    p_kode);
end $$;
revoke execute on function kso.nama_alat_surat(text) from public;
grant execute on function kso.nama_alat_surat(text) to wrg_app;

create or replace function kso.app_catat_sph(
  p_id bigint, p_nomor text, p_harga numeric, p_ttd_user text, p_ttd_nama text, p_ttd_jabatan text,
  p_berlaku_hari int default 30)
returns bigint language plpgsql security definer set search_path = kso, public as $$
declare r kso.rencana_kso; m kso.mandat; v_faskes text; v_kota text; v_id bigint;
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
  insert into kso.sph (rencana_id, nomor, harga_per_test, jumlah, tenor_bulan, volume_minimum, klausul_wajib,
                       faskes_nama, faskes_kota, alat_nama, berlaku_hari, berlaku_sampai,
                       ttd_user_id, ttd_nama, ttd_jabatan, dibuat_user, dibuat_peran)
  values (p_id, trim(p_nomor), p_harga, greatest(coalesce(r.jumlah, 1), 1),
          least(coalesce(r.tenor_bulan, m.tenor_maks_bulan), coalesce(m.tenor_maks_bulan, r.tenor_bulan)),
          m.volume_minimum, coalesce(m.klausul_wajib, '{}'), coalesce(v_faskes, r.faskes_id), v_kota,
          kso.nama_alat_surat(r.alat_kode), coalesce(p_berlaku_hari, 30), kso.hari_ini() + coalesce(p_berlaku_hari, 30),
          nullif(trim(p_ttd_user), ''), trim(p_ttd_nama), nullif(trim(p_ttd_jabatan), ''), kso.uid_saya(), kso.peran_saya())
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function kso.app_catat_sph(bigint, text, numeric, text, text, text, int) from public;
grant execute on function kso.app_catat_sph(bigint, text, numeric, text, text, text, int) to wrg_app;
