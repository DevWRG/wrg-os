-- 301 — F15 SPH: diskon berjenjang per peran + diskon tambahan (total) SPH.
-- Lanjutan 152_sph_generator.sql & 300_sph_cetak.sql.
--
-- 1. BATAS DISKON EFEKTIF. Sejak migrasi ini batas diskon per SKU di SPH =
--    nilai TERBIT Setup Harga (077): bila baris product_pricelist_setup
--    berstatus 'published' → COALESCE(diskon_override, diskon_maks) dan
--    COALESCE(price_list_override, price_list); selain itu angka handover
--    product_pricelist apa adanya. Sama dengan yang dilihat AM di tab "Harga
--    per Produk" (repo/pricebook.ts hargaEfektif). Tak butuh kolom baru —
--    sph_line_item.diskon_maks_snapshot & price_list sudah menyimpan snapshot.
--
-- 2. DISKON BERJENJANG (sph_pengaturan, diatur admin di Pengaturan SPH):
--      diskon ≤ batas SKU                                → normal
--      ≤ batas + tambahan_hod_pp                         → perlu persetujuan HoD Business
--      ≤ batas + tambahan_hod_pp + tambahan_direktur_pp  → perlu persetujuan Direktur
--      lebih dari itu                                    → ditolak saat SPH dibuat
--    "pp" = poin persentase (5 = lima poin di atas batas SKU), bukan fraksi.
--    Tier per baris disimpan di sph_line_item.tier; tier dokumen (tertinggi
--    dari semua baris + diskon tambahan) di sales_doc.tier_persetujuan.
--    Aturan yang dipakai saat SPH dibuat disnapshot di sales_doc.aturan_tier
--    supaya mengubah pengaturan tak mengubah SPH yang sudah berjalan.
--
-- 3. DISKON TAMBAHAN (seluruh SPH): persen ATAU nominal Rp, dipotong dari
--    subtotal nett baris SEBELUM PPN. Diskon efektif keseluruhan =
--    1 − (nett akhir sebelum PPN / Σ price list × qty), diuji dengan aturan
--    tier yang sama memakai batas = diskon efektif baris + diskon_total_maks_pct
--    (default 0 → diskon tambahan berapa pun minimal perlu persetujuan HoD).
--
-- Persetujuan pengecualian: HoD Business mengakuinya saat review (tahap 1,
-- dicatat pengecualian_disetujui_by/at); tier 'direktur' butuh persetujuan
-- Direktur (direktur_approved_*) SEBELUM approve tahap 2 / pemberian nomor.
-- Status tetap draft → hod_review → approved; langkah Direktur = gerbang di
-- hod_review, bukan status baru (sales_doc.status dipakai doc_type lain juga).
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE sph_pengaturan ADD COLUMN IF NOT EXISTS tambahan_hod_pp numeric(5,2) NOT NULL DEFAULT 5;
ALTER TABLE sph_pengaturan ADD COLUMN IF NOT EXISTS tambahan_direktur_pp numeric(5,2) NOT NULL DEFAULT 10;
ALTER TABLE sph_pengaturan ADD COLUMN IF NOT EXISTS diskon_total_maks_pct numeric(5,2) NOT NULL DEFAULT 0;

ALTER TABLE sph_pengaturan DROP CONSTRAINT IF EXISTS sph_pengaturan_tier_ck;
ALTER TABLE sph_pengaturan ADD CONSTRAINT sph_pengaturan_tier_ck CHECK (
  tambahan_hod_pp >= 0 AND tambahan_hod_pp < 100
  AND tambahan_direktur_pp >= 0 AND tambahan_direktur_pp < 100
  AND diskon_total_maks_pct >= 0 AND diskon_total_maks_pct < 100
);

COMMENT ON COLUMN sph_pengaturan.tambahan_hod_pp IS
  'F15 — poin persentase di atas batas diskon SKU yang boleh disetujui HoD Business (default 5).';
COMMENT ON COLUMN sph_pengaturan.tambahan_direktur_pp IS
  'F15 — poin persentase SETELAH jatah HoD yang hanya boleh disetujui Direktur (default 10). Di atas itu SPH ditolak.';
COMMENT ON COLUMN sph_pengaturan.diskon_total_maks_pct IS
  'F15 — batas diskon tambahan SPH (poin di atas diskon efektif baris) tanpa persetujuan. Default 0 = selalu perlu HoD.';

ALTER TABLE sph_line_item ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'normal';
ALTER TABLE sph_line_item DROP CONSTRAINT IF EXISTS sph_line_item_tier_ck;
ALTER TABLE sph_line_item ADD CONSTRAINT sph_line_item_tier_ck CHECK (tier IN ('normal', 'hod', 'direktur'));
COMMENT ON COLUMN sph_line_item.tier IS
  'F15 — jenjang persetujuan diskon baris saat dibuat: normal (≤ batas SKU) | hod | direktur.';

ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS diskon_total_tipe text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS diskon_total_nilai numeric(16,4);
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS diskon_total_rp numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS diskon_total_tier text NOT NULL DEFAULT 'normal';
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS tier_persetujuan text NOT NULL DEFAULT 'normal';
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS aturan_tier jsonb;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS pengecualian_disetujui_by text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS pengecualian_disetujui_at timestamptz;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS direktur_approved_by text;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS direktur_approved_at timestamptz;
ALTER TABLE sales_doc ADD COLUMN IF NOT EXISTS direktur_approved_user_id uuid;

ALTER TABLE sales_doc DROP CONSTRAINT IF EXISTS sales_doc_diskon_total_ck;
ALTER TABLE sales_doc ADD CONSTRAINT sales_doc_diskon_total_ck CHECK (
  (diskon_total_tipe IS NULL OR diskon_total_tipe IN ('persen', 'nominal'))
  AND (diskon_total_nilai IS NULL OR diskon_total_nilai >= 0)
  AND diskon_total_rp >= 0
  AND diskon_total_tier IN ('normal', 'hod', 'direktur')
  AND tier_persetujuan IN ('normal', 'hod', 'direktur')
);

COMMENT ON COLUMN sales_doc.diskon_total_tipe IS
  'F15 — jenis diskon tambahan SPH: persen | nominal. NULL = tanpa diskon tambahan (dan doc_type selain sph).';
COMMENT ON COLUMN sales_doc.diskon_total_nilai IS
  'F15 — nilai yang diisi: persen (mis. 2.5) atau Rupiah. Hasil hitung di diskon_total_rp.';
COMMENT ON COLUMN sales_doc.diskon_total_rp IS
  'F15 — potongan Rupiah dari subtotal nett baris, sebelum PPN. 0 = tanpa diskon tambahan.';
COMMENT ON COLUMN sales_doc.tier_persetujuan IS
  'F15 — jenjang persetujuan SPH (tertinggi dari baris & diskon tambahan): normal | hod | direktur.';
COMMENT ON COLUMN sales_doc.aturan_tier IS
  'F15 — snapshot aturan saat dibuat {tambahanHodPp, tambahanDirekturPp, diskonTotalMaksPct}.';
COMMENT ON COLUMN sales_doc.pengecualian_disetujui_by IS
  'F15 — HoD Business yang menyetujui diskon di atas batas saat review tahap 1.';
COMMENT ON COLUMN sales_doc.direktur_approved_by IS
  'F15 — Direktur yang menyetujui diskon tier direktur. Wajib ada sebelum approve tahap 2 bila tier_persetujuan = direktur.';
