-- 277: F170 Fase D — Tinjauan Portofolio KSO (Pedoman Komite KSO Forum v01, forum Kamis minggu ke-4).
--
-- Satu baris per unit KSO terpasang (populasi = public.kso_bottomline_unit_v, migrasi 256) dengan bahan
-- empat kondisi Pedoman:
--   * omzet tiga bulan penuh terakhir (b1 = bulan lalu, b2, b3) — omzet faskes × jenis DIBAGI RATA ke unit
--     sejenis di faskes itu, sama dengan Bottom Line Alat;
--   * bulan terakhir unit itu punya omzet (dasar "idle > 60 hari"; jendela 24 bulan);
--   * umur piutang faskes saat ini (hari lewat jatuh tempo terlama atas faktur yang masih bersisa) — dihitung
--     langsung dari AR, BUKAN dari kso.faskes yang hanya disegarkan job jadwal Komite KSO.
-- GPM per bulan sengaja TIDAK dihitung di sini: API memakai fungsi yang sama dengan tab Bottom Line
-- (apps/api/src/repo/kso-komite-bottomline.ts) supaya kedua layar tak pernah berselisih angka.
-- Semua rujukan bernama skema lengkap (pelajaran 276: pg_restore mengosongkan search_path).

create or replace view public.kso_portofolio_unit_v as
with b as (
  select date_trunc('month', now() at time zone 'Asia/Jakarta')::date as bln_ini
), bulanan as (
  select r.account_id, r.jenis, r.periode, sum(r.revenue_netto) as omzet
    from public.kso_revenue_jenis_v r cross join b
   where r.kategori in (select k.kategori from public.kso_kategori_skema k)
     and r.periode >= (b.bln_ini - interval '24 month')::date
   group by r.account_id, r.jenis, r.periode
)
select u.asset_id, u.account_id, u.faskes, u.sn_key, u.skema, u.jenis, u.model, u.model_key, u.mulai,
       u.unit_sejenis_di_faskes,
       case when u.account_id is not null then public.area_customer(u.account_id) end as cabang,
       (select mu.nama from public.crm_account ca join public.master_user mu on mu.am_id = ca.owner_am_id
         where ca.account_id = u.account_id limit 1) as am_nama,
       (b.bln_ini - interval '1 month')::date as bulan_1,
       (b.bln_ini - interval '2 month')::date as bulan_2,
       (b.bln_ini - interval '3 month')::date as bulan_3,
       case when u.account_id is not null then coalesce((select o.omzet from bulanan o where o.account_id = u.account_id and o.jenis = u.jenis
                and o.periode = (b.bln_ini - interval '1 month')::date), 0) / u.unit_sejenis_di_faskes end as omzet_1,
       case when u.account_id is not null then coalesce((select o.omzet from bulanan o where o.account_id = u.account_id and o.jenis = u.jenis
                and o.periode = (b.bln_ini - interval '2 month')::date), 0) / u.unit_sejenis_di_faskes end as omzet_2,
       case when u.account_id is not null then coalesce((select o.omzet from bulanan o where o.account_id = u.account_id and o.jenis = u.jenis
                and o.periode = (b.bln_ini - interval '3 month')::date), 0) / u.unit_sejenis_di_faskes end as omzet_3,
       (select max(o.periode) from bulanan o where o.account_id = u.account_id and o.jenis = u.jenis and o.omzet > 0) as omzet_terakhir,
       ar.hari as piutang_hari, ar.nilai as piutang_nilai
  from public.kso_bottomline_unit_v u
  cross join b
  left join lateral (
    select max(greatest(current_date - m.due_date, 0)) as hari, sum(coalesce(ai.outstanding, m.amount)) as nilai
      from public.ar_aging_mv m
      left join public.accurate_invoice ai on ai.number = m.invoice_no
     where u.account_id is not null and m.customer_id = u.account_id::text and coalesce(ai.outstanding, m.amount) > 0
  ) ar on true;

comment on view public.kso_portofolio_unit_v is
  'F170 Fase D (277): unit KSO terpasang + omzet 3 bulan penuh terakhir (dibagi rata per unit sejenis) + omzet terakhir + umur piutang faskes — bahan Tinjauan Portofolio.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant select on public.kso_portofolio_unit_v to wrg_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant select on public.kso_portofolio_unit_v to wrg_readonly;
  end if;
end $$;
