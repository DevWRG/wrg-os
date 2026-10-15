# F6 — Product Performance Scorecard

Menu **Product Scorecard** (`/product-scorecard`, grup Sales) untuk HoD Business IVD & Medical + Direktur:
kinerja produk ditelusuri **kategori → lini → brand → item**. Issue #1753.

- **Izin**: fitur `product-scorecard` (tertutup default — Sync Fitur + centang). Sebelum matriks diatur:
  Direktur, HoD, admin. **Margin** murni jabatan: HoD Business / Purchasing / admin / Direktur.
- **Migrasi**: `221_product_scorecard.sql` — tabel peta `product_line_kompetitor` (lini → kategori kompetitor),
  isi awal 52 lini dari nama lini; boleh diedit tanpa deploy.

## Keputusan user (15 Okt 2026)

Menu baru dengan izin sendiri · margin hanya untuk pembaca HPP · metrik: revenue + tren, konsentrasi customer,
perputaran stok, kompetitor (F131).

## Isi per baris

| Kolom | Sumber / aturan |
|---|---|
| Revenue | netto faktur (tanpa PPN) **dialokasikan per baris** — pola `analyticsPerProduk`, Σ = netto faktur |
| vs periode lalu / tahun lalu | jendela panjang sama tepat sebelum `from`; tanggal sama tahun lalu (29 Feb → 28 Feb). Rentang maks 366 hari |
| Customer | jumlah customer, porsi terbesar (≥30% ditandai), porsi top-5 |
| Stok | median (stok Accurate ÷ rata kiriman DO 3 bulan tutup) item kelompok itu; **stok mati** = stok > 0 tanpa DO & faktur 90 hari |
| Kompetitor (kategori/lini) | faskes dengan `competitor_intel` 365 hari di kategori kompetitor yang dipetakan (`product_line_kompetitor`), 3 vendor teratas; brand sendiri (`brand_sendiri`) dikecualikan |
| GP% (khusus pembaca HPP) | HPP price book `INSENTIF_PERIODE_HPP` (default H2-2026), **hanya item dengan HPP tunggal** (pola insentif.ts — satu kode bisa Rp 665 rb s/d Rp 11,9 jt); cakupan HPP < 80% revenue ditandai |

Klasifikasi item = `product_code` lewat `accurate_item_id`, cadangan `kode_2025 = item.no`. Kunci lini =
(kategori_id, line_id) — id lini **tak unik** sendirian (line 11 = POCT Cholestrol di IVD, General Equipment di
NON IVD). Item tanpa kode = "Belum terklasifikasi".

## Fakta data (prod 15 Okt, Q3 2026)

- Rp 12,86 M netto; tahun lalu Rp 19,51 M — **penurunan nyata** (H2 2025 tinggi, sejalan temuan F72 e-katalog kolaps).
- 58 brand / 889 item terjual; ZYBIO Rp 4,0 M (GP 72,8%, 123 customer); "(tanpa brand)" Rp 3,3 M.
- Kompetitor: Hematology 25 faskes (Sysmex 11, Mindray 5), Clinical Chemistry 23 (Mindray 7), POCT ±31.
- Kueri 70–190 ms.

## API

`GET /product-scorecard?from&to&level=kategori|lini|brand|item&kategori=KK|__tanpa__&lini=KK.LL&brand=&margin=1`
— ber-scope x-user-id. BFF `/api/product-scorecard`: whitelist parameter, `margin=1` hanya dari jabatan sesi.

## Batasan

- Margin memakai satu periode HPP; HPP per satuan dasar × qty baris faktur (sama seperti insentif).
- Kompetitor hanya dari laporan kunjungan AM (bukan pangsa pasar) — konfirmasi HoD F131 belum dipakai.
- Peta lini → kompetitor belum punya layar edit (ubah lewat SQL).

## Berkas

`infra/postgres/init/221_product_scorecard.sql` · `apps/api/src/repo/product-scorecard.ts` (+ test) ·
`apps/api/src/index.ts` · `apps/web/src/lib/product-scorecard-access.ts` (+ test) · `apps/web/src/lib/nav.ts` ·
`apps/web/src/app/api/product-scorecard/route.ts` · `apps/web/src/app/(dashboard)/product-scorecard/page.tsx` ·
`apps/web/src/components/product-scorecard/scorecard-view.tsx`
