# F150 — Profitabilitas Area (tahap 1: sisi revenue)

**Menu:** Finance → Profitabilitas Area (`/profitabilitas-area`) + tab "Revenue Area" di WatchPoint HoD (`/watchpoint`) · **Migrasi:** tidak ada · **Kunci izin:** `profitabilitas-area` (view)

## Apa ini
Revenue netto (tanpa PPN) per **area** (cabang, dikelompokkan ke region East / West / Lainnya) dibandingkan periode sebelumnya: bulan ini, kuartal ini, atau tahun ini (awal periode → hari ini vs rentang hari yang sama pada periode lalu).

Keputusan Direktur (rapat 2026-10-19): tujuan akhirnya biaya operasional kantor vs revenue sales per area → biaya, pendapatan, profit/rugi (profit = revenue netto − biaya operasional, **tanpa HPP**). Tahap 1 = dashboard saja; `#BIAYA` di WA = tahap 2.

## Status
- **Revenue: hidup.** Sumber `accurate_invoice` (`total − tax_amount`), atribusi cabang lewat `cabangEffSql` + `joinAmFromSalesman` (sama dengan Sales Performance): faktur ber-AM → cabang AM pada tanggal faktur; faktur tanpa AM → area lokasi customer.
- **Biaya & profit/rugi: menunggu data Accurate.** Mirror Accurate tidak punya beban/jurnal. Kolom ditampilkan "—" (bukan nol). Brief untuk Direktur: `BRIEF-F150-DATA-BIAYA-ACCURATE.md`; skrip cek: `scripts/qa/probe-accurate-biaya.mjs` (belum pernah dijalankan di Mac mini).

## Akses
- Menu `/profitabilitas-area`: Direktur/admin/superuser = semua area; HoD (punya `hod_key`) = hanya cabang di `hod_territory` miliknya (BFF meneruskan `?hod=` dari **sesi**). Matriks Akses Grup menang begitu fitur diatur; default tertutup (butuh Sync Fitur + centang grup).
- Tab WatchPoint: ikut izin menu WatchPoint, menampilkan semua area (papan WatchPoint memang menampilkan semua HoD).

## Teknis
- API `GET /revenue-area?periode=bulan|kuartal|tahun&asOf=YYYY-MM-DD&hod=<hod_key>`; repo `apps/api/src/repo/revenue-area.ts` (logika murni `windowsFor`, `shiftMonths`, `susunRevenueArea` diuji di `revenue-area.test.ts`).
- Metric `revenue` per-HoD di `watchpoint.ts` memakai `mu.cabang` langsung sehingga melewatkan faktur tanpa AM — **tidak diubah**; angkanya bisa beda dengan tab ini.
