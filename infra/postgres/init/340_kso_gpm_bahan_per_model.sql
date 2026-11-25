-- 340 — F170 Komite KSO: angka GPM tanpa menghitung ulang seluruh Bottom Line Alat (laporan user 25 Nov 2026:
-- /kso-komite lambat — panel rincian "Memuat…" dan tab "Belum lengkap" lama tampil).
--
-- Akar masalah: kso.hitung_gpm (302) membaca public.kso_bottomline_model_v untuk SATU model alat. View itu
-- (256/286) memuat omzet 12 bulan (kso_revenue_jenis_v), pencocokan SN ke aset tetap per unit, window function
-- dan percentile per model — filter model_key tak bisa didorong ke dalamnya, jadi tiap panggilan menghitung
-- seluruh populasi KSO lalu membuang semua baris kecuali satu. Rincian usulan memanggilnya 2×, daftar
-- "Belum lengkap" 1× per baris (hanya untuk kolom hd).
--
-- Perbaikan (angka TIDAK berubah, tetap real-time — tanpa cache):
--   kso.jenis_model(model_key)      : jenis + apakah model punya unit terpasang (= baris mana dari model_v)
--   kso.bahan_gpm_model(model_key)  : hanya kolom yang dipakai hitung_gpm (hpp, biaya/tes, biaya tetap, QC,
--                                     satuan, tangga), dihitung untuk unit model itu saja; omzet tidak dihitung.
--                                     Rumus = salinan kso_bottomline_model_v (286) untuk kolom-kolom tersebut.
--   kso.hitung_gpm                  : DITAMBAL (pola 307) — hanya sumber bahan model yang diganti.
--   kso.satuan_model(model_key)     : tes/tindakan (null bila model tak ada) — dipakai app_hd.
--   kso.app_hd(id)                  : penanda Hemodialisa untuk daftar "Belum lengkap" (pagar sama dengan
--                                     app_angka_gpm 268), tanpa menghitung GPM.
-- Bila kso_bottomline_model_v berubah rumus, fungsi bahan_gpm_model wajib ikut diubah; cek kesetaraannya dengan
-- scripts/qa/kso-komite/cek_bahan_gpm_model.sql (baca saja, aman di prod).
-- Uji scripts/qa/kso-komite (DB tanpa tabel F172) meniru bahan_gpm_model & satuan_model di 005_tiruan_bottomline.sql.

set search_path = kso, public;

-- ---------- jenis model: satu baris bila model ada di kso_bottomline_model_v, nol baris bila tidak ----------
-- plpgsql (bukan sql): badan fungsi baru diperiksa saat dipanggil — DB uji kso-komite tak punya tabel F172.
create or replace function kso.jenis_model(p_model_key text)
returns table (jenis text, ada_unit boolean)
language plpgsql stable set search_path = kso, public as $$
begin
  return query
  with u as (
    select min(public.kso_jenis_kanonik(a.type_alat)) as jenis, count(*) as n
      from public.kso_asset a
     where a.aktif and a.in_populasi
       and public.kso_jenis_kanonik(a.type_alat) || '|' || coalesce(nullif(btrim(a.nama_alat), ''), '(tanpa nama)') = p_model_key
  )
  -- baris unit terpasang (model_v bagian pertama)
  select u.jenis, true from u where u.n > 0
  union all
  -- baris "alat baru" katalog Simulator tanpa unit terpasang (model_v bagian kedua, 286)
  select split_part(p_model_key, '|', 1), false from u
   where u.n = 0 and position('|' in p_model_key) > 0
     and exists (select 1 from public.kso_analyzer an where an.model_key = p_model_key);
end $$;
revoke execute on function kso.jenis_model(text) from public;

-- ---------- bahan GPM per model (kolom hitung_gpm dari kso_bottomline_model_v, satu model saja) ----------
create or replace function kso.bahan_gpm_model(p_model_key text)
returns table (hpp double precision, biaya_per_tes numeric, biaya_tetap_bulan numeric, biaya_tetap_harian numeric,
               qc_bulan numeric, satuan text, biaya_tangga jsonb)
language plpgsql stable set search_path = kso, public as $$
declare j record; b record; bj record; v_hpp_aset double precision; v_hpp_pb numeric; v_rp numeric;
begin
  select * into j from kso.jenis_model(p_model_key);
  if not found then return; end if;
  select x.hpp_standar, x.biaya_per_tes, x.biaya_tetap_bulan, x.biaya_tetap_harian, x.qc_bulan, x.biaya_tangga
    into b from public.kso_bottomline_biaya x where x.model_key = p_model_key;
  select x.satuan, x.rupiah_per_tes_manual, x.margin_kotor into bj from public.kso_bottomline_jenis x where x.jenis = j.jenis;

  satuan := coalesce(bj.satuan, 'tes');
  biaya_tetap_bulan := coalesce(b.biaya_tetap_bulan, 0);
  biaya_tetap_harian := b.biaya_tetap_harian;
  qc_bulan := coalesce(b.qc_bulan, 0);
  biaya_tangga := b.biaya_tangga;

  if j.ada_unit then
    -- HPP aset tetap cocok SN (256: perolehan terbaru, median bila terbaru menyimpang >40%) — hanya bila
    -- HPP standar Finance kosong, dan hanya untuk unit model ini.
    if b.hpp_standar is null then
      with u as (
        select a.id, a.sn_key from public.kso_asset a
         where a.aktif and a.in_populasi
           and public.kso_jenis_kanonik(a.type_alat) || '|' || coalesce(nullif(btrim(a.nama_alat), ''), '(tanpa nama)') = p_model_key
      ), fa as (
        select f.id, upper(coalesce(f.description, '') || ' ' || coalesce(f.notes, '')) as teks,
               coalesce(f.current_asset_cost, f.asset_cost) as biaya,
               coalesce(f.tgl_perolehan_asli, f.usage_date, f.trans_date) as tgl
          from public.fixed_asset_v f
         where f.fa_type_name ilike 'ALAT KSO%' and not f.disposed and coalesce(f.current_asset_cost, f.asset_cost) > 0
      ), s as (
        select h.biaya as hpp_sn, h.tgl as hpp_tgl
          from u left join lateral (
            select fa.biaya, fa.tgl from fa
             where length(u.sn_key) >= 5 and position(upper(u.sn_key) in fa.teks) > 0
             order by fa.tgl desc nulls last, fa.id desc limit 1
          ) h on true
      ), hp as (
        select (array_agg(hpp_sn order by hpp_tgl desc nulls last) filter (where hpp_sn is not null))[1] as terbaru,
               percentile_cont(0.5) within group (order by hpp_sn) filter (where hpp_sn is not null) as median
          from s
      )
      select case when hp.terbaru is null then null
                  when hp.median > 0 and abs(hp.terbaru - hp.median) / hp.median > 0.4 then hp.median
                  else hp.terbaru end
        into v_hpp_aset from hp;
    end if;
    hpp := coalesce(b.hpp_standar, v_hpp_aset);
    -- taksiran Rp/tes × (1 − margin kotor jenis) — acuan Rp/tes OS hanya dibaca bila memang dibutuhkan
    if b.biaya_per_tes is null and bj.margin_kotor is not null and bj.rupiah_per_tes_manual is null then
      select rj.rupiah_per_tes into v_rp from public.kso_jenis_ringkas_v rj where rj.jenis = j.jenis limit 1;
    end if;
    biaya_per_tes := coalesce(b.biaya_per_tes,
                              case when bj.margin_kotor is not null
                                   then round(coalesce(bj.rupiah_per_tes_manual, v_rp) * (1 - bj.margin_kotor)) end);
  else
    -- alat baru (286): HPP standar Finance, kalau kosong HPP Price Book unit alat
    if b.hpp_standar is null then
      select x.hpp into v_hpp_pb
        from (select an.pricebook_kode, an.pricebook_nama from public.kso_analyzer an
               where an.model_key = p_model_key order by an.id limit 1) an
        left join lateral (
          select ps.hpp from public.product_pricelist pl
            left join public.product_pricelist_setup ps on ps.periode = pl.periode and ps.row_no = pl.row_no
           where (an.pricebook_kode is not null and pl.kode = an.pricebook_kode)
              or (an.pricebook_kode is null and an.pricebook_nama is not null and coalesce(ps.nama_final, pl.nama) = an.pricebook_nama)
           order by pl.periode desc, ps.hpp is null, pl.row_no limit 1) x on true;
    end if;
    hpp := coalesce(b.hpp_standar, v_hpp_pb);
    biaya_per_tes := b.biaya_per_tes;
  end if;
  return next;
end $$;
revoke execute on function kso.bahan_gpm_model(text) from public;

-- ---------- tambal hitung_gpm: sumber bahan model = kso.bahan_gpm_model (pola tambal 307) ----------
-- Definisi yang berlaku = 302 + tambalan 307 (alat baru → zona Direktur), jadi TIDAK ditulis ulang: hanya baris
-- sumber bahan yang diganti pada definisi aktif. Pilihan baris analyzer (where/order/limit) tetap sama.
do $$
declare v_def text;
  v_jangkar constant text := $j$from public.kso_analyzer a left join public.kso_bottomline_model_v b on b.model_key = a.model_key$j$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kso' and p.proname = 'hitung_gpm';
  if v_def is null then raise exception 'kso.hitung_gpm tidak ada'; end if;
  if position('kso.bahan_gpm_model' in v_def) > 0 then return; end if;
  if position(v_jangkar in v_def) = 0 then raise exception 'jangkar hitung_gpm tidak ditemukan — periksa definisi sebelum menambal'; end if;
  execute replace(v_def, v_jangkar,
    $j$from public.kso_analyzer a left join lateral kso.bahan_gpm_model(a.model_key) b on true  /* 340: bahan satu model, bukan model_v */$j$);
end $$;
revoke execute on function kso.hitung_gpm(bigint) from public;

-- ---------- satuan model (tes / tindakan), null bila model tak ada di kso_bottomline_model_v ----------
create or replace function kso.satuan_model(p_model_key text) returns text
language plpgsql stable set search_path = kso, public as $$
begin
  return (select coalesce(bj.satuan, 'tes') from kso.jenis_model(p_model_key) j
            left join public.kso_bottomline_jenis bj on bj.jenis = j.jenis);
end $$;
revoke execute on function kso.satuan_model(text) from public;

-- ---------- penanda Hemodialisa untuk layar (daftar "Belum lengkap") — pagar sama dengan app_angka_gpm (268) ----------
-- = kolom hd kso.hitung_gpm, tanpa menghitung HPP/GPM.
create or replace function kso.app_hd(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = kso, public as $$
declare v_mk text;
begin
  if kso.uid_saya() is null or not kso.boleh_lihat(p_id) then
    raise exception 'PERAN_TIDAK_BERWENANG: rencana % di luar akses', p_id;
  end if;
  -- 307: alat sementara (belum ada di database) → hitung_gpm memberi hd = false sebelum membaca model
  if exists (select 1 from kso.rencana_kso r join kso.alat x on x.kode = r.alat_kode where r.id = p_id and x.baru) then
    return false;
  end if;
  select a.model_key into v_mk
    from kso.rencana_kso r join public.kso_analyzer a on a.kode = r.alat_kode
   where r.id = p_id order by a.model_key is null, a.id limit 1;
  return coalesce(kso.satuan_model(v_mk) = 'tindakan', false);
end $$;
revoke execute on function kso.app_hd(bigint) from public;
grant execute on function kso.app_hd(bigint) to wrg_app;
