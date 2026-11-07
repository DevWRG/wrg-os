# F53 — Stiker Aset & Asset Tagging Audit

| | |
|---|---|
| Domain | OPS |
| FR | FR-ES-53 |
| Tier | R0 |
| Prioritas | COULD |
| Sprint | Y2 |
| Status | DRAFT-Y2 |
| Owner | Dito, Husni, Fafa |
| Branch | `feat/f53-stiker-aset-tagging-audit` (dari `dev`, standalone) |

## Ringkasan

QR-code per aset + registry (bukan katalog aset lengkap — F132 masih
blocked, nunggu lokasi source sistem legacy "gais") + cetak stiker + audit
(riwayat verifikasi fisik berkala).

## Keputusan konsultasi Direktur (sebelum coding)

1. **F34 (aset penghasil revenue + rekonsiliasi Accurate, domain FINANCE)
   DIKONFIRMASI terpisah** — "kalo yg F34 itu asset yg menghasilkan revenue,
   perlu rekonsiliasi sama Accurate. jd terpisah gapapa mas." F53 tidak
   punya link/dependency ke F34 sama sekali (bukan stub, genuinely tak
   related).
2. **F53 tetap jalan, ranahnya GA/OPS** — tak perlu nunggu F132.
3. **Generate stiker WAJIB reuse tool yang sudah dibuat sebelumnya**:
   [github.com/DevWRG/label-asset](https://github.com/DevWRG/label-asset) —
   tool standalone HTML ("WRG LifeLine · Sticker Printer") yang sudah
   mengungkap skema kolom nyata yang dipakai tim GA di Excel (kode `WRG-
   <lokasi>-<kategori>-<urut>`, jenis kepemilikan Aset/Inventaris, kategori,
   lokasi cabang, letak) dan desain visual stiker ("Jurassic Park inspired":
   strip navy "Jangan Dicabut" + QR + badge ASSET/INV).
4. **Terintegrasi ke DB** (dikonfirmasi user) — bukan reuse tool lama apa
   adanya (copy-paste Excel manual tiap kali). Registry F53 tersimpan
   permanen, generate stiker dari situ.
5. **Mulai kosong** (dikonfirmasi user) — tidak ada file Excel data asli
   untuk diimpor sekarang, CRUD manual.

## Cara kerja

- **`asset_tag`** — registry aset yang ditag (bukan katalog lengkap). `kode`
  diisi MANUAL (bukan auto-generate) — skema penomoran per lokasi/kategori
  belum punya aturan resmi, menebak berisiko salah. CRUD via web (skala
  lebih dinamis drpd F50 vehicle, sama alasan F52 IT asset).
- **`asset_tag_audit_log`** — riwayat verifikasi fisik (`audited_by`,
  `found`, `note`). `found=false` = dilaporkan hilang/tak ketemu.
- **Cetak Stiker**: `apps/web/src/lib/asset-sticker.ts` — port layout dari
  `label-asset` (3 ukuran S/M/L, sama config `SIZES`), QR via npm `qrcode`
  (`QRCode.toDataURL`, client-side). **Barcode CODE128 dari tool asal
  SENGAJA di-drop** — blueprint F53 cuma minta QR-code, bukan barcode
  tambahan; scope dijaga minimal sesuai tier COULD/R0.
- Cetak pakai pola `window.open("", "_blank") + document.write(html)` yang
  sudah ada di codebase (`sales-analytics-dashboard.tsx`) — window terpisah
  dari app, jadi tak perlu CSS print khusus utk sembunyikan sidebar/layout
  dashboard.
- **Web**: `/asset-tag` (section Operations, domain OPS — sama keputusan
  F50/F52: OPS tetap gabung Operations, tak dapat section sendiri). 1
  halaman, 2 tab: **Aset** (registry CRUD + audit) dan **Cetak Stiker**
  (pilih aset aktif + ukuran → cetak).

## Verifikasi (2026-08-03, lokal)

- CRUD aset: create, kode duplikat ditolak, field wajib kosong ditolak.
- Audit: catat audit (found=true/false), `last_audit_at`/`last_audit_found`
  di listing ikut update ke entri TERBARU, riwayat penuh bisa diambil per aset.
- QR generation (`qrcode` npm package) diuji langsung — data URI valid.
- Typecheck + lint (api & web) bersih. Data uji dihapus.

## Belum/di luar scope

- Foto register (disebut di deskripsi board) — kolom `foto_path` disiapkan
  di skema, tapi UI upload foto BELUM dibangun (butuh infra upload file yang
  belum ada pola established-nya di web CRUD biasa — beda dari WA inbound
  photo). Bisa ditambah nanti tanpa migrasi baru.
- Import bulk dari Excel (importer CSV mirip F37) — belum dibutuhkan krn
  belum ada file data asli (dikonfirmasi user "mulai kosong").
