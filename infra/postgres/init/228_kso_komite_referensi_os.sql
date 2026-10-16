-- 228 — F170 Komite KSO Tahap 2: isi tabel referensi kso.* dari data OS (pemetaan disetujui 16 Okt)
--
-- Tanpa menyalin aturan ke kode aplikasi: kso.segarkan_referensi() di-upsert tiap malam oleh scheduler
-- API (pengganti n8n di paket). Tidak pernah DELETE/DROP — tabel rencana bergantung lewat FK.
-- Kolom yang datanya belum ada di OS dibiarkan NULL → gerbangnya 'belum bisa dicek' (masuk forum):
--   * kategori.harga_standar_per_test (butir C10)   → gerbang 2
--   * kso.cabang_teknisi (register sertifikasi)     → gerbang 3
--   * kso.grup_mitra / faskes.grup                  → keputusan 16 Okt opsi (a): dibiarkan kosong,
--     dilaporkan ke Direktur (aturan grup SK Pasal 14/16 belum bisa berlaku tanpa data grup)
--
-- Pemetaan:
--   cabang   ← area_kota ∪ hod_territory ∪ cabang AM; wilayah = master_hod.peran pemegang hod_territory.
--              Cabang tanpa HOD Area (SBY 1 = office, keputusan 16 Okt) → wilayah 'OFFICE': routing hanya
--              menemukan HOD Bisnis → otomatis jalur forum. hod_territory OS TIDAK diubah.
--   hod      ← master_hod aktif: 'Sales …' = area, 'Business IVD' = bisnis ivd, 'Business …' lain = bisnis non_ivd
--   am       ← master_user aktif role AM (no WA dinormalkan 62…)
--   kategori ← kso_analyzer.kategori (lini ivd; harga standar tidak disentuh supaya isian C10 manual tak tertimpa)
--   alat     ← kso_analyzer × kso.alat_sumber (peta nama ke price book) × HPP product_pricelist_setup periode terbaru.
--              Analyzer tanpa padanan HPP tidak dimasukkan (harga_po wajib; tak boleh angka karangan).
--   faskes   ← crm_account × accurate_customer; cabang = area_customer(); piutang = faktur yang masih
--              bersisa (COALESCE(accurate_invoice.outstanding, ar_aging_mv.amount) > 0, basis termasuk PPN);
--              tagihan_bulanan = rata-rata faktur 12 bulan terakhir termasuk PPN.

set search_path = kso, public;

-- peta analyzer → nama produk di price book. DATA, bukan kode: tambah baris untuk analyzer baru.
create table if not exists kso.alat_sumber (
  alat_kode       text primary key,      -- kso_analyzer.kode
  nama_pricelist  text not null          -- product_pricelist_setup.nama_final
);
insert into kso.alat_sumber values
  ('Z3',      'ZYBIO HEMATOLOGY ANALYZER 3 DIFF Z3'),
  ('Z52',     'ZYBIO HEMATOLOGY ANALYZER 5 DIFF Z52'),
  ('Z50',     'ZYBIO HEMATOLOGY ANALYZER 5 DIFF Z50'),
  ('EXZ6000', 'ZYBIO HEMATOLOGY EXZ6000'),
  ('EXZ8000', 'ZYBIO HEMATOLOGY EXZ8000'),
  ('EXC200',  'ZYBIO CHEMISTRY ANALYZER EXC200'),
  ('EXC400',  'ZYBIO CHEMISTRY ANALYZER EXC400'),
  ('SNIBE',   'SNIBE MAGLUMI X3 FULLY AUTOMATIC CLIA SYSTEM'),
  ('DNX6',    'Easy Diagnosis DN-X6 (Na,Ka,Cl,Ca,PH,Li)')
on conflict (alat_kode) do nothing;
alter table kso.alat_sumber enable row level security;
drop policy if exists baca on kso.alat_sumber;
create policy baca on kso.alat_sumber for select to wrg_app using (kso.peran_saya() is not null);
grant select on kso.alat_sumber to wrg_app;

-- tujuh klausul khusus (gerbang 7) = aturan bisnis paket, bukan data contoh (di rujukan ada di 004)
insert into kso.klausul_khusus values
  ('eksklusivitas', 'Eksklusivitas', 1),
  ('jaminan_volume', 'Jaminan volume', 2),
  ('alat_jatuh', 'Alat jatuh ke RS', 3),
  ('tanpa_eskalasi', 'Tanpa eskalasi harga', 4),
  ('tanpa_lapor', 'Tanpa lapor test', 5),
  ('tanpa_denda', 'Tanpa denda telat bayar', 6),
  ('draft_rs', 'Draft PKS dari RS', 7)
on conflict do nothing;

create or replace function kso.segarkan_referensi() returns jsonb
language plpgsql security definer set search_path = kso, public as $$
declare v jsonb := '{}';
begin
  -- cabang + wilayah
  insert into kso.cabang (nama, wilayah)
  select c.cabang, coalesce(max(h.peran), 'OFFICE')
    from (select cabang from public.area_kota
          union select cabang from public.hod_territory
          union select cabang from public.master_user where aktif and role = 'AM') c
    left join public.hod_territory t on t.cabang = c.cabang
    left join public.master_hod h on h.hod_key = t.hod_key and h.aktif
   where nullif(btrim(c.cabang), '') is not null
   group by c.cabang
  on conflict (nama) do update set wilayah = excluded.wilayah;
  v := v || jsonb_build_object('cabang', (select count(*) from kso.cabang));

  -- HOD
  insert into kso.hod (id, nama, jenis, cakupan)
  select h.hod_key, h.nama,
         case when h.peran ~* '^sales ' then 'area' else 'bisnis' end::kso.hod_jenis,
         case when h.peran ~* '^sales ' then h.peran when h.peran ~* 'business ivd' then 'ivd' else 'non_ivd' end
    from public.master_hod h
   where h.aktif and h.peran ~* '^(sales|business) '
  on conflict (id) do update set nama = excluded.nama, jenis = excluded.jenis, cakupan = excluded.cakupan;
  v := v || jsonb_build_object('hod', (select count(*) from kso.hod));

  -- AM
  insert into kso.am (id, nama, cabang, no_wa)
  select u.am_id, u.nama, c.nama,
         regexp_replace(regexp_replace(u.wa_number, '\D', '', 'g'), '^0', '62')
    from public.master_user u left join kso.cabang c on c.nama = u.cabang
   where u.aktif and u.role = 'AM' and nullif(u.am_id, '') is not null
     and nullif(regexp_replace(coalesce(u.wa_number, ''), '\D', '', 'g'), '') is not null
  on conflict (id) do update set nama = excluded.nama, cabang = excluded.cabang, no_wa = excluded.no_wa;
  v := v || jsonb_build_object('am', (select count(*) from kso.am));

  -- kategori (label & lini saja; harga standar C10 diisi manual, tak ditimpa)
  insert into kso.kategori (kode, label)
  select distinct a.kategori, a.kategori from public.kso_analyzer a where a.aktif
  on conflict (kode) do nothing;
  v := v || jsonb_build_object('kategori', (select count(*) from kso.kategori));

  -- alat: HPP price book periode terbaru per nama
  insert into kso.alat (kode, nama, kategori, harga_po)
  select a.kode, coalesce(nullif(a.brand, ''), a.label), a.kategori, p.hpp
    from public.kso_analyzer a
    join kso.alat_sumber s on s.alat_kode = a.kode
    join lateral (select hpp from public.product_pricelist_setup x
                   where x.nama_final = s.nama_pricelist and x.hpp > 0
                   order by x.periode desc limit 1) p on true
   where a.aktif
  on conflict (kode) do update set nama = excluded.nama, kategori = excluded.kategori, harga_po = excluded.harga_po;
  v := v || jsonb_build_object('alat', (select count(*) from kso.alat));

  -- faskes + piutang + tagihan bulanan
  insert into kso.faskes (id, nama, cabang, piutang_hari, piutang_nilai, tagihan_bulanan)
  select ca.account_id::text, ac.name, kc.nama,
         coalesce(ar.hari, 0), coalesce(ar.nilai, 0), round(coalesce(tg.total, 0) / 12)
    from public.crm_account ca
    join public.accurate_customer ac on ac.id = ca.account_id
    left join kso.cabang kc on kc.nama = public.area_customer(ca.account_id)
    left join lateral (
      select max(greatest(current_date - m.due_date, 0)) as hari,
             sum(coalesce(ai.outstanding, m.amount)) as nilai
        from public.ar_aging_mv m
        left join public.accurate_invoice ai on ai.number = m.invoice_no
       where m.customer_id = ca.account_id::text and coalesce(ai.outstanding, m.amount) > 0) ar on true
    left join lateral (
      select sum(i.total) as total from public.accurate_invoice i
       where i.customer_id = ca.account_id and i.tanggal > current_date - interval '12 months') tg on true
  on conflict (id) do update set nama = excluded.nama, cabang = excluded.cabang, piutang_hari = excluded.piutang_hari,
                                 piutang_nilai = excluded.piutang_nilai, tagihan_bulanan = excluded.tagihan_bulanan;
  v := v || jsonb_build_object('faskes', (select count(*) from kso.faskes));
  return v;
end $$;
revoke execute on function kso.segarkan_referensi() from public;
grant execute on function kso.segarkan_referensi() to wrg_app;   -- dipanggil scheduler API

-- gerbang 3: register teknisi kosong = 'belum', bukan 'merah'
create or replace function kso.hitung_gerbang(p_id bigint, p_mode_hari_ini boolean default false)
returns table (no int, nama text, status kso.gerbang_status, nilai text)
language plpgsql as $$
declare
  r kso.rencana_kso; f kso.faskes; a kso.alat; k kso.kategori;
  v_capex numeric; v_gabung numeric; v_n_gabung int; v_tek boolean; v_kel numeric; v_kl text;
  g_status kso.gerbang_status; g_nilai text;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into f from kso.faskes   where id = r.faskes_id;
  select * into a from kso.alat     where kode = r.alat_kode;
  select * into k from kso.kategori where kode = a.kategori;
  delete from kso.gerbang_hasil where rencana_id = p_id;

  -- 1. capex (harga PO aktual + instalasi) + aturan anti-pemecahan paket
  v_capex := a.harga_po * r.jumlah + coalesce(r.biaya_instalasi, 0);
  select coalesce(sum(a2.harga_po * x.jumlah + coalesce(x.biaya_instalasi,0)),0), count(*) into v_gabung, v_n_gabung
    from kso.rencana_kso x join kso.alat a2 on a2.kode = x.alat_kode
   where x.id <> r.id and x.am_id = r.am_id and x.faskes_id = r.faskes_id
     and x.status not in ('DRAFT','DITOLAK_HOD','DITOLAK_DIREKSI','KALAH')
     and x.diajukan_at >= coalesce(r.diajukan_at, now()) - (kso.param('anti_pecah_hari') || ' days')::interval;
  update kso.rencana_kso set pecah_paket = (v_n_gabung > 0) where id = p_id;
  g_status := case when v_capex + v_gabung > kso.param('capex_maks') then 'merah'
                    when r.biaya_instalasi is null
                         and (v_capex + v_gabung) * (1 + kso.param('instalasi_cadangan_persen')/100) > kso.param('capex_maks') then 'belum'
                    else 'hijau' end;
  g_nilai  := kso.rp(v_capex)
              || case when r.biaya_instalasi is null then ' (instalasi belum diisi)' else '' end
              || case when v_n_gabung > 0
                      then ' + ' || v_n_gabung || ' usulan lain ke faskes ini dalam ' || kso.param('anti_pecah_hari') || ' hari = ' || kso.rp(v_capex + v_gabung)
                      else '' end;
  insert into kso.gerbang_hasil values (p_id, 1, 'Capex paket ≤ ' || kso.rp(kso.param('capex_maks')), g_status, g_nilai);

  -- 2. harga per test ≥ daftar standar
  if p_mode_hari_ini or k.harga_standar_per_test is null then
    g_status := 'belum'; g_nilai := 'Daftar harga standar belum ada di OS';
  elsif r.harga_per_test is null then
    g_status := 'belum'; g_nilai := 'Harga per test belum diisi';
  else
    g_status := case when r.harga_per_test >= k.harga_standar_per_test then 'hijau' else 'merah' end;
    g_nilai  := kso.rp(r.harga_per_test) || ' vs daftar ' || kso.rp(k.harga_standar_per_test);
  end if;
  insert into kso.gerbang_hasil values (p_id, 2, 'Harga per test ≥ daftar standar', g_status, g_nilai);

  -- 3. coverage cabang + teknisi tersertifikasi
  if p_mode_hari_ini then g_status := 'belum'; g_nilai := 'Register teknisi belum ada di OS';
  elsif f.cabang is null then g_status := 'merah'; g_nilai := 'Di luar coverage cabang';
  -- F170 (beda dari rujukan): register kosong untuk kategori ini = data belum ada → 'belum',
  -- bukan 'merah · tidak ada teknisi' (klaim yang tak bisa dibuktikan).
  elsif not exists (select 1 from kso.cabang_teknisi t where t.kategori = a.kategori) then
    g_status := 'belum'; g_nilai := 'Register teknisi ' || lower(k.label) || ' belum ada di OS';
  else
    v_tek := exists (select 1 from kso.cabang_teknisi t where t.cabang = f.cabang and t.kategori = a.kategori);
    g_status := case when v_tek then 'hijau' else 'merah' end;
    g_nilai  := 'Cabang ' || f.cabang || ' · ' || case when v_tek then 'teknisi ' else 'tidak ada teknisi ' end || lower(k.label);
  end if;
  insert into kso.gerbang_hasil values (p_id, 3, 'Coverage + teknisi tersertifikasi', g_status, g_nilai);

  -- 4. unit baru (status dari master aset OS; AM tidak mengisi)
  if p_mode_hari_ini or r.unit_status is null then g_status := 'belum'; g_nilai := 'Status unit belum ada di OS';
  else g_status := case when r.unit_status = 'baru' then 'hijau' else 'merah' end;
       g_nilai  := 'Unit ' || replace(r.unit_status::text,'_','-');
  end if;
  insert into kso.gerbang_hasil values (p_id, 4, 'Unit baru dari PO', g_status, g_nilai);

  -- 5. piutang faskes (seluruh tagihan faskes, bukan KSO ini saja)
  if p_mode_hari_ini or f.piutang_hari is null then
    g_status := 'belum'; g_nilai := 'AR aging belum ada di OS';
  elsif coalesce(f.tagihan_bulanan,0) = 0 and coalesce(f.piutang_nilai,0) = 0 then
    g_status := 'hijau'; g_nilai := 'Faskes baru — belum ada tagihan';
  else
    v_kel := case when coalesce(f.tagihan_bulanan,0) > 0 then f.piutang_nilai / f.tagihan_bulanan else 99 end;
    g_status := case when f.piutang_hari <= kso.param('piutang_hari_maks')
                      and v_kel <= kso.param('piutang_kelipatan_maks') then 'hijau' else 'merah' end;
    g_nilai  := f.piutang_hari || ' hari · '
                || case when v_kel >= 99 then 'ada piutang tanpa tagihan berjalan'
                        else replace(to_char(v_kel,'FM990.0'),'.',',') || '× tagihan bulanan' end;
  end if;
  insert into kso.gerbang_hasil values (p_id, 5,
    'Piutang ≤ ' || kso.param('piutang_hari_maks') || ' hari dan ≤ ' || kso.param('piutang_kelipatan_maks') || '× tagihan', g_status, g_nilai);

  -- 6. tenor sejak serah terima
  if p_mode_hari_ini or r.tenor_bulan is null then g_status := 'belum'; g_nilai := 'Tenor belum diisi';
  else g_status := case when r.tenor_bulan <= kso.param('tenor_maks_bulan') then 'hijau' else 'merah' end;
       g_nilai  := r.tenor_bulan || ' bulan sejak serah terima';
  end if;
  insert into kso.gerbang_hasil values (p_id, 6, 'Tenor ≤ ' || kso.param('tenor_maks_bulan') || ' bulan', g_status, g_nilai);

  -- 7. nol klausul khusus
  select string_agg(kk.label, ', ' order by kk.urut) into v_kl
    from kso.rencana_klausul rk join kso.klausul_khusus kk on kk.kode = rk.klausul_kode where rk.rencana_id = p_id;
  insert into kso.gerbang_hasil values (p_id, 7, 'Nol klausul khusus',
    (case when v_kl is null then 'hijau' else 'merah' end)::kso.gerbang_status, coalesce(v_kl,'Tidak ada'));

  return query select g.no, g.nama, g.status, g.nilai from kso.gerbang_hasil g where g.rencana_id = p_id order by g.no;
end $$;

revoke execute on function kso.hitung_gerbang(bigint, boolean) from public;
