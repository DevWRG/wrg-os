-- 288: F172 — biaya reagen otomatis DN-X6 (elektrolit) dari Price Book (lanjutan 284/286, permintaan user 7 Nov).
--
-- Simulator: reagen elektrolit habis 21 mL Cal A per hari kerja + 0,8 mL per tes (formula.ts elektroCost); harga paket
-- ada di kso_analyzer.meta.modes. Supaya tombol "Hitung ulang dari Price Book" punya harga beli, paket mode Cartridge
-- (Cal A 650 mL) dicatat sebagai baris reagen DN-X6 yang ditaut ke SKU Price Book "Easy Diagnosis Cartridge Reagen".
-- Panel elektrolit Simulator hanya membaca baris QC + meta.modes, jadi baris ini tidak mengubah layar Simulator.
-- Hanya nama SKU — TANPA harga (repo publik).

do $$
begin
  if to_regclass('public.kso_reagent') is null then return; end if;
  insert into public.kso_reagent (analyzer_id, kode, jenis, nama, pack, vol, flags, urutan, pricebook_nama, pricebook_faktor)
  select a.id, 'cart_reagen', 'reagent', 'Cartridge Reagen (Cal A 650 mL + Cal B 250 mL)', '650 mL + 250 mL', 650,
         '{"mode": "cartridge"}'::jsonb, 90, 'Easy Diagnosis Cartridge Reagen', 1
    from public.kso_analyzer a where a.kode = 'DNX6'
  on conflict (analyzer_id, jenis, kode) do nothing;
end $$;
