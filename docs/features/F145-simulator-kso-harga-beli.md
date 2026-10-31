# F145 — Simulator KSO: harga beli reagen & HPP alat (Fase B Pedoman)

Fase B **Pedoman Komite KSO Forum v01** (27 Okt 2026, tenggat 6 Nov). Celah yang ditutup: Simulator
memakai harga reagen **price list / distributor** dan harga alat **price list** (`kso_analyzer.default_capex`),
sehingga biaya per tes terlihat 2–4× di atas harga beli WRG.

## Yang berubah (migrasi 264)

| | Sebelum | Sesudah |
|---|---|---|
| Harga reagen/kit | `harga_pl` (Hemato, Crossmatch, parameter KK) atau `harga_dp` | `harga_beli` per kemasan (isian Finance); kosong → harga lama |
| Harga alat | `default_capex(_pl)` = price list | HPP model F172 (HPP standar Finance / aset tetap cocok SN) lewat `kso_analyzer.model_key`; diskon 0 |
| Saran harga | — | `kso_harga_po_v`: harga satuan PO Accurate terakhir per kode barang (cermin PO F13) |

Simulator punya pilihan **Basis harga**: *Harga beli (Finance)* (bawaan) atau *Harga daftar (lama)*.
Rumus `formula.ts` / `model.ts` **tidak berubah** — `lib/kso/basis.ts terapkanBasis()` hanya mengganti
nilai awal harga sebelum masuk panel, jadi paritas rumus dengan sumber tetap berlaku.
Layar menyebut berapa barang di kategori itu yang belum punya harga beli (memakai harga lama).

## Kelola harga beli (Finance)

Tombol **Kelola harga beli** di /kso-simulator (fitur `kso-simulator-hargabeli`):
- Tab Reagen / Parameter: harga distributor, price list, **kode barang Accurate**, saran PO terakhir
  (harga, satuan, nomor & tanggal PO — tombol *pakai*), **harga beli per kemasan**. Peringatan bila harga
  beli di atas harga distributor (biasanya salah satuan: PO per pcs vs kemasan simulator).
- Tab Alat (HPP): petakan analyzer simulator → model populasi KSO (F172). HPP-nya diubah di tab
  Bottom Line Alat (Komite KSO), bukan di sini.
- Pemetaan awal analyzer → model diisi migrasi untuk Zybio Z3/Z52/Z50/EXZ6000/EXZ8000/EXC200, Snibe X3,
  Ediagnosis PT1000 (dicocokkan per nama model; yang tak ketemu tetap kosong).

## Izin

`kso-simulator-hargabeli` — lihat = buka layar kelola, ubah = simpan. Default tertutup, tanpa gate lama;
role admin TIDAK otomatis (sama dengan F172). Centang: grup **Finance HOD** + **accounting** (lihat+ubah).
Finance juga perlu `kso-simulator` (lihat) untuk membuka menunya. API memeriksa sendiri (x-service-token).

## Belum

- Harga control/kalibrator di `kso_analyzer.meta` (`ctrlPl`, `calPl`, `xnCtrlPl`, `xrCtrlPl`) masih
  harga list — belum ada kolom harga beli untuk QC.
- Biaya reagen per tes hasil simulator belum dialirkan otomatis ke F172 (`kso_bottomline_biaya`) —
  Finance menyalinnya di tab Bottom Line Alat.
- Angka harga beli TIDAK di repo (repo publik): diisi lewat layar.
