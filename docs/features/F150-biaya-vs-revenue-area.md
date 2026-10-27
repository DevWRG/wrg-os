# F150 — Profitabilitas Area (tahap 1 revenue + tahap 2 biaya & laba kotor)

**Menu:** Finance → Profitabilitas Area (`/profitabilitas-area`) + tab "Revenue Area" di WatchPoint HoD (`/watchpoint`) · **Migrasi:** 257 (`biaya_area_baris`, `biaya_kamus_payee`, `biaya_kamus_alias_kota`) · **Kunci izin:** `profitabilitas-area` (view)

## Apa ini
Revenue netto (tanpa PPN) per **area** (cabang, dikelompokkan ke region East / West / Lainnya) dibandingkan periode sebelumnya: bulan ini, kuartal ini, atau tahun ini (awal periode → hari ini vs rentang hari yang sama pada periode lalu).

Keputusan Direktur (rapat 2026-10-19): tujuan akhirnya biaya operasional kantor vs revenue sales per area → biaya, pendapatan, profit/rugi (tahap 1: profit = revenue netto − biaya operasional; **diperbarui 2026-10-27**: HPP tampil terpisah sebagai Laba Kotor, profit = laba kotor − biaya operasional). Tahap 1 = dashboard saja; `#BIAYA` di WA = tahap 2.

## Status
- **Revenue: hidup.** Sumber `accurate_invoice` (`total − tax_amount`), atribusi cabang lewat `cabangEffSql` + `joinAmFromSalesman` (sama dengan Sales Performance): faktur ber-AM → cabang AM pada tanggal faktur; faktur tanpa AM → area lokasi customer.
- **Biaya & laba kotor: hidup (tahap 2).** Keputusan Direktur 2026-10-27:
  - Biaya operasional = akun **6200** saja. **6100** (gaji, dibayar gabungan) & **6300** (bunga bank, konsultan, bank charge) → baris **KANTOR PUSAT**, tidak dibagi. HPP **5100** bukan biaya: tampil sebagai **Laba Kotor = revenue netto − HPP** (HPP dari `product_pricelist_setup`, hanya item ber-HPP tak ambigu → kolom "HPP x% revenue"; angka parsial karena anomali HPP, lihat `revenue-stream.ts`). Profit = laba kotor − biaya operasional.
  - Area biaya ditentukan (a) aturan, (b) kolom **Departemen** Accurate bila terisi (menang). Aturan (`biaya-area-rules.ts`): akun 6100/6300 → Pusat; Departemen sah; override payee manual (`biaya_kamus_payee`); "ST <kota>"; payee = karyawan cabang (cabang PADA TANGGAL transaksi via `am_cabang_riwayat`; nama ambigu tak ditebak); kota di keterangan (`area_kota` + `biaya_kamus_alias_kota`; >1 area → dibagi rata); sisanya Kantor Pusat. Faktur pembelian: kota **tidak** dicari di nama vendor.
  - Dashboard menampilkan **% biaya tertandai area** + rincian per dasar. Awal Jul–Okt 2026: ±28% (marketing fee ±53% dari 6200, payee KARYA ANAK, menunggu peta INV→customer dari Finance — **tidak ditebak**, tampil sebagai "belum terpetakan").
  - Belum: penyusutan/amortisasi 6200-04..07 & 6200-24 (lewat journal-voucher; list.do tak bisa difilter per akun, ±11,6 rb jurnal) → sementara tak ikut. Probe #3 (`scripts/qa/probe-accurate-biaya-3.mjs`, read-only, per-bulan) menjawab jenis jurnal pemuat akun itu + nama field Departemen; puller jurnal dibangun SETELAH hasilnya ada (jangan menebak bentuk respons); Departemen = area baru diisi Accounting mulai 1 Nov 2026 (draf permintaan ada di folder Direktur).

## Akses
- Menu `/profitabilitas-area`: Direktur/admin/superuser = semua area + baris Kantor Pusat + kartu cakupan; HoD (punya `hod_key`) = hanya cabang di `hod_territory` miliknya, TANPA baris Kantor Pusat/cakupan perusahaan (BFF meneruskan `?hod=` dari **sesi**). Matriks Akses Grup menang begitu fitur diatur; default tertutup (butuh Sync Fitur + centang grup).
- Tab WatchPoint: ikut izin menu WatchPoint, menampilkan semua area (papan WatchPoint memang menampilkan semua HoD).

## Teknis
- API `GET /revenue-area?periode=bulan|kuartal|tahun&asOf=YYYY-MM-DD&hod=<hod_key>`; repo `apps/api/src/repo/revenue-area.ts` (logika murni `windowsFor`, `shiftMonths`, `susunRevenueArea` diuji di `revenue-area.test.ts`).
- Metric `revenue` per-HoD di `watchpoint.ts` memakai `mu.cabang` langsung sehingga melewatkan faktur tanpa AM — **tidak diubah**; angkanya bisa beda dengan tab ini.

## Operasi biaya (tahap 2)
- Puller read-only `apps/api/src/repo/biaya-area-sync.ts`: other-payment (`detailAccount`) + purchase-invoice (`detailExpense`), mulai `BIAYA_AREA_SINCE` (default 2026-07-01), N+1 detail.do berbatas (`detail_limit`, default 400/run), retry 3×, incremental by `lastUpdate`. Job `biaya-area-sync` (03:00, `BIAYA_AREA_SYNC_ENABLED=true`, default off). Manual: `POST /biaya-area/sync` (202, hasil di `accurate_sync_state` entity `biaya-area`).
- Kamus berubah (override payee / alias kota / master karyawan) → `POST /biaya-area/recompute` (tanpa Accurate).
- Data nyata & CSV Direktur **tidak di repo** (privat). Isi kamus lewat INSERT ke `biaya_kamus_payee` / `biaya_kamus_alias_kota`.

## Impor data Direktur (lokal)
`scripts/db/import_f150_biaya.mts <folder> [--apply]` (dry-run default; data **tidak di repo**): kamus kota (file 3) → `biaya_kamus_alias_kota`, payee terisi manual (file 4) → `biaya_kamus_payee`, baris biaya (file 2) → `biaya_area_baris` dengan area **dihitung ulang** pakai aturan repo (bukan `tebakan_area` CSV), HPP dilewati. Baris impor ber-`accurate_id` NEGATIF; hapus (`DELETE ... WHERE accurate_id < 0`) sebelum puller menarik periode yang sama. File 1 hanya diperiksa konsistensinya terhadap `kelompokAkun()`.
