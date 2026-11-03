-- 272 — F170 Komite KSO: harga pembuka mandat tak pernah di bawah harga usulan AM.
--
-- Keputusan user 3 Nov 2026 (temuan uji WA 2 Nov, D51): AM mengusulkan Rp 25.000, mandat
-- otomatis menyuruh membuka di Rp 20.300 (@GPM 55%) — margin dilepas sebelum negosiasi
-- mulai. Kini pembuka = MAX(@GPM 55%, harga usulan AM); @55% tetap batas bawah pembuka.
--   1) kso.mandat_otomatis (zona AM/HOD): pembuka = greatest(@55%, harga_per_test).
--   2) kso.putus_direksi: pembuka KOSONG = greatest(@55%, target, harga_per_test);
--      pembuka eksplisit Direksi tetap dipakai apa adanya (urutan pembuka ≥ target ≥ lantai tetap diperiksa).
-- Tanda tangan fungsi tak berubah → CREATE OR REPLACE mempertahankan hak eksekusi (269).
-- Mandat yang sudah terbit TIDAK diubah.

create or replace function kso.mandat_otomatis(p_id bigint) returns void language plpgsql as $$
declare r kso.rencana_kso; a kso.alat; k kso.kategori; g record; v_lantai numeric; v_target numeric; v_pembuka numeric;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into a from kso.alat where kode = r.alat_kode;
  select * into k from kso.kategori where kode = a.kategori;
  select * into g from kso.hitung_gpm(p_id);
  if g.harga_forum is not null then
    v_lantai  := ceil(g.harga_forum / 100) * 100;
    v_target  := ceil(g.harga_hod / 100) * 100;
    v_pembuka := greatest(ceil(g.harga_am / 100) * 100, r.harga_per_test);   -- 272: tak pernah di bawah usulan AM
  else                                            -- data GPM tak lengkap → perilaku v1
    v_lantai  := coalesce(k.harga_standar_per_test, r.harga_per_test);
    v_target  := greatest(r.harga_per_test, v_lantai);
    v_pembuka := null;
  end if;
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, harga_pembuka, volume_terbukti, tenor_maks_bulan, capex_maks,
                          volume_minimum, klausul_dilarang, berlaku_sampai, sumber)
  values (p_id, v_lantai, v_target, v_pembuka, r.volume_estimasi, r.tenor_bulan,
          a.harga_po * r.jumlah + coalesce(r.biaya_instalasi,0), floor(r.volume_estimasi * kso.param('volume_minimum_rasio')),
          array(select kode from kso.klausul_khusus where kode in ('eksklusivitas','jaminan_volume','alat_jatuh')),
          kso.hari_ini() + kso.param('mandat_berlaku_hari')::int, 'otomatis')
  on conflict (rencana_id) do nothing;
end $$;

create or replace function kso.putus_direksi(p_id bigint, p_putusan kso.putusan_direksi, p_catatan text default null,
  p_lantai numeric default null, p_target numeric default null, p_tenor_maks int default null,
  p_capex_maks numeric default null, p_volume_min int default null, p_klausul_dilarang text[] default '{}',
  p_pembuka numeric default null)
returns kso.status_rencana language plpgsql as $$
declare v_status kso.status_rencana; v_vol int; v_am numeric; v_pembuka numeric; v_usulan numeric;
begin
  select status, volume_estimasi, harga_per_test into v_status, v_vol, v_usulan from kso.rencana_kso where id = p_id for update;
  if v_status not in ('DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN') then
    raise exception 'BELUM_ADA_USULAN_KOMITE: status %', v_status; end if;
  if p_putusan <> 'TOLAK' and (p_lantai is null or p_target is null or p_tenor_maks is null
                               or p_capex_maks is null or p_volume_min is null) then
    raise exception 'MANDAT_TIDAK_LENGKAP' using hint =
      'Setuju atau Bersyarat wajib menetapkan lantai harga, harga pembuka, tenor maks, capex maks, dan volume minimum (SK Pasal 11 ayat 2).';
  end if;
  insert into kso.putusan_direksi_catatan values (p_id, p_putusan, p_catatan, now())
    on conflict (rencana_id) do update set putusan = excluded.putusan, catatan = excluded.catatan, at = now();
  if p_putusan = 'TOLAK' then perform kso.ubah_status(p_id, 'DITOLAK_DIREKSI', 'direksi'); return 'DITOLAK_DIREKSI'; end if;
  if exists (select 1 from kso.rencana_kso r join kso.faskes f on f.id = r.faskes_id join kso.grup_mitra g on g.grup = f.grup
              where r.id = p_id and (coalesce(g.rating_terburuk,1) >= 4 or g.pks_lengkap is false)) then
    raise exception 'GRUP_DIBEKUKAN' using hint = 'SK Pasal 14 ayat 2 dan Pasal 16 ayat 3: tidak ada belanja modal baru ke grup ini sampai perbaikan selesai.';
  end if;
  -- pembuka kosong = @GPM 55% di volume usulan, tak pernah di bawah target maupun di bawah harga usulan AM (272)
  select ceil(harga_am / 100) * 100 into v_am from kso.hitung_gpm(p_id);
  v_pembuka := coalesce(p_pembuka, greatest(v_am, p_target, v_usulan), p_target);
  if p_target < p_lantai or v_pembuka < p_target then
    raise exception 'MANDAT_URUTAN_HARGA' using hint = 'Harga pembuka ≥ target ≥ batas bawah (lantai).';
  end if;
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, harga_pembuka, volume_terbukti, tenor_maks_bulan, capex_maks,
                          volume_minimum, klausul_dilarang, berlaku_sampai, sumber)
  values (p_id, p_lantai, p_target, v_pembuka, v_vol, p_tenor_maks, p_capex_maks, p_volume_min, p_klausul_dilarang,
          kso.hari_ini() + kso.param('mandat_berlaku_hari')::int, 'direksi')
  on conflict (rencana_id) do update set harga_lantai = excluded.harga_lantai, harga_target = excluded.harga_target,
     harga_pembuka = excluded.harga_pembuka, volume_terbukti = excluded.volume_terbukti,
     tenor_maks_bulan = excluded.tenor_maks_bulan, capex_maks = excluded.capex_maks, volume_minimum = excluded.volume_minimum,
     klausul_dilarang = excluded.klausul_dilarang, berlaku_sampai = excluded.berlaku_sampai, sumber = 'direksi', terbit_at = now();
  perform kso.ubah_status(p_id, 'MANDAT_TERBIT', 'direksi'); return 'MANDAT_TERBIT';
end $$;

comment on column kso.mandat.harga_pembuka is
  'Pedoman v01: MAX(harga @ GPM 55%, harga usulan AM) — tak pernah di bawah usulan AM (272). harga_target = @ 50%, harga_lantai = @ 45% (batas bawah AM).';
