-- 342 — F172 Bottom Line Alat: tombol "Hitung ulang biaya" lambat (permintaan user 25 Nov 2026, lanjutan 340/341).
--
-- kso_parameter_mix_v (330) memakai kso_bottomline_unit_v hanya untuk pasangan (alat kimia klinik, faskes). unit_v
-- ikut mencocokkan SN tiap unit ke aset tetap (position() atas ±1.400 aset) dan menghitung omzet — keduanya tak
-- dipakai di sini. Populasi diambil langsung dari kso_asset dengan syarat & model_key yang sama dengan unit_v
-- (aktif, in_populasi, kso_jenis_kanonik(type_alat) || '|' || model). Isi view lain = 330, kolom & tipe tak berubah.
-- Pasangan simpanBiayaOtomatis (API): cek model 1 kueri, bukan 1 kueri view per model.
-- Dicek di prod 25 Nov (transaksi + ROLLBACK): 0 beda (34 baris); 633 → 9,5 ms. Simpan 9 model: ±3,2 → 0,35 dtk.

set search_path = public;

do $do$
begin
  if to_regclass('public.kso_parameter_sku') is null or to_regclass('public.accurate_delivery_order') is null
     or to_regclass('public.kso_asset') is null or to_regclass('public.product_pricelist') is null
     or to_regclass('public.kso_parameter_mix_v') is null then return; end if;
  execute $v$
  create or replace view public.kso_parameter_mix_v as
  with f as (
    -- 342: pasangan alat × faskes langsung dari kso_asset (populasi & model_key = kso_bottomline_unit_v, 256) —
    -- unit_v ikut mencocokkan SN ke aset tetap & menghitung omzet yang tak dipakai di sini.
    select distinct a.kode as analyzer, u.account_id
      from public.kso_analyzer a
      join public.kso_asset u
        on public.kso_jenis_kanonik(u.type_alat) || '|' || coalesce(nullif(btrim(u.nama_alat), ''), '(tanpa nama)') = a.model_key
     where a.kategori = 'CC' and u.aktif and u.in_populasi and u.account_id is not null
  ), kirim as (
    select f.analyzer, i.item_no, sum(i.qty) as kit
      from f join public.accurate_delivery_order d on d.customer_id = f.account_id
      join public.accurate_delivery_order_item i on i.delivery_id = d.id
     where d.trans_date >= current_date - 365
     group by 1, 2
  )
  select a.kode as analyzer, s.parameter, s.sku_kode, p.tests_per_kit * s.faktor as tes_per_kemasan,
         coalesce(k.kit, 0) as kit_12bln, coalesce(b.harga_rata, x.hpp)::numeric(16,2) as hpp,
         x.hpp as hpp_pb, b.harga_rata as hpp_beli,
         case when b.harga_rata is not null then 'rata-rata beli 12 bln'
              when x.hpp is not null then 'Price Book' end as hpp_sumber
    from public.kso_analyzer a
    join public.kso_parameter p on p.grup = a.kategori
    join public.kso_parameter_sku s on s.grup = p.grup and s.parameter = p.nama
    left join kirim k on k.analyzer = a.kode and k.item_no = s.sku_kode
    left join lateral (
      select ps.hpp from public.product_pricelist pl
        left join public.product_pricelist_setup ps on ps.periode = pl.periode and ps.row_no = pl.row_no
       where pl.kode = s.sku_kode
       order by pl.periode desc, ps.hpp is null, pl.row_no limit 1) x on true
    left join public.harga_beli_rata_v b on b.item_no = s.sku_kode
   where a.kategori = 'CC' and a.model_key is not null
  $v$;
end $do$;
