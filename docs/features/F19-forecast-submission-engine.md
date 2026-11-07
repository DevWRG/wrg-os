# F19 — Forecast Submission Engine

Domain: CRM (label blueprint) · FR FR-ES-19 · Owner: Yogi, Mufid, Arman, semua AM KSO.

## Ringkasan

Hasil meeting Direktur 2026-08-18 **menggantikan total** desain lama
("form bulanan #FORECAST" via WA). Alur baru: sistem scan gudang otomatis
→ usulan forecast → **Supply Chain review/edit** → ajukan ke approval
berjenjang (reuse F11). **QC forecast diabaikan dulu** — hanya SALES
forecast. **Tidak ada hashtag WA** di fitur ini (beda dari blueprint & FR
awal) — QW1 (yang tadinya jadi entry point WA utk #FORECAST) di-skip
Direktur krn terlalu kompleks utk magang, dan alur hasil meeting 100%
sistem→Supply Chain→approval tanpa langkah WA.

## Dependency struktural (PENTING kalau lanjut sesi depan)

Branch `feat/f19-forecast-submission-engine` di-based dari
**`feat/f38-ed-watch-near-expiry`** (yang sendiri di atas
`feat/f37-cross-branch-stock-visibility`) — F19 butuh tabel stok (F37) dan
ED (F38). **Branch `feat/f11-approval-engine` di-MERGE (bukan rebase)**
ke branch ini — F19 butuh reuse `createApprovalRequest()` + tabel
`approval_request`/`approval_step`, tapi F11 lineage-nya beda (dari `dev`
langsung, bukan dari F37/F38). Konsekuensi: **3 PR harus di-merge sesuai
urutan dependency** (F37 → F38 → gabungan F11+F19, ATAU F11 duluan lalu
F19 di-rebase bersih di atas dev-yang-sudah-punya-F37+F38+F11). Migrasi
`154_forecast_submission.sql` mengasumsikan tabel dari migrasi 082 (F37),
083 (F38), dan 106 (F11) sudah ada.

## 3 sinyal pemicu usulan (dari brief meeting)

1. **Stok vs buffer** — `item_stock_buffer` (baru, migrasi 107): safety
   stock per item per gudang, **diisi manual Supply Chain**. Accurate
   KEMUNGKINAN punya field ini native, TAPI puller `accurateSync.ts
   syncItems()` cuma minta `fields=id,no,name,itemType,unitPrice,quantity,
   availableToSell,unit1` (dicek langsung ke kode) — nambah field baru ke
   situ = ubah puller mirror, masuk "ERP Postgres mirror tables" yang
   eksplisit GATED, bukan ranah magang. Jadi manual bukan krn data tak
   eksis, tapi krn narik dari Accurate di luar scope. Baris tak ada =
   belum dikonfigurasi, item itu tak pernah kena alert (bukan default 0).
2. **Tanggal ED** — reuse `item_stock_batch.ed_date` (F38), ambang 90 hari
   ke depan (bukan 3-tier 90/60/30/0 spt alert F38 — di sini cukup 1
   ambang "perlu diusulkan atau tidak").
3. **Rata-rata transaksi 6 bulan** — dihitung dari `accurate_invoice` +
   `accurate_invoice_item` (SUM qty per bulan, AVG 6 bulan terakhir),
   dipakai sbg komponen hitung `suggested_qty`.

## Sinyal "pipeline HOT" — SENGAJA cuma konteks, bukan pemicu presisi

`deal.product_ids` itu **teks bebas** (komentar `product.ts`: "belum ada
katalog produk") — TIDAK ada cara akurat mencocokkan "deal HOT butuh alat
apa" ke SKU gudang tertentu (mirip risiko nama-kembar SPH, tapi lebih
parah krn tak ada struktur sama sekali). Diputuskan (user, sesi ini):
`pipeline_hot_count` cuma angka GLOBAL (jumlah deal stage
Closing/Closing-Won saat itu), ditempel ke SETIAP usulan sbg info
tambahan — TIDAK dipakai menentukan usulan mana yang dibuat.

**Mapping stage**: brief meeting sebut "delivery" sbg status HOT, tapi
stage asli sistem (`deal.ts`) tak punya nama itu — dipetakan ke stage
`Closing`/`Closing-Won` yang SUDAH didefinisikan `prospect:"Hot"` di kode
(`STAGE_META`). Dikonfirmasi user, bukan tebakan sepihak.

## Skema DB (migrasi 154_forecast_submission.sql)

- `item_stock_buffer` (item_id, warehouse_kode, buffer_qty) — PK komposit,
  TIDAK di-pre-seed (beda dari `approval_chain_config` F11 yg cuma 5 baris
  tetap) krn kombinasi item×gudang bisa ribuan.
- `forecast_suggestion` — snapshot alasan/angka SAAT usulan dibuat sistem
  (`reasons` jsonb, `current_qty`, `buffer_qty`, `nearest_ed_date`,
  `avg_monthly_qty_6m`, `pipeline_hot_count`, `suggested_qty`), field yg
  diedit Supply Chain (`final_qty`, `notes`), `approval_request_id`
  (terisi setelah "ajukan"). **Partial unique index** `(item_id,
  warehouse_kode) WHERE status='draft'` — cegah generate ulang menumpuk
  duplikat draft utk kombinasi yang sama (submitted/dismissed boleh
  banyak, itu histori).

## Alur API

```
POST /forecast/generate                    → scan buffer+ED, buat draft baru (skip yg sudah ada draft aktif)
GET  /forecast/suggestions                  → list (filter ?status=draft|submitted|dismissed)
PATCH /forecast/suggestions/:id             → edit final_qty/notes (hanya saat draft)
POST /forecast/suggestions/:id/dismiss      → abaikan usulan
POST /forecast/suggestions/:id/submit       → ajukan ke approval F11 (createApprovalRequest reuse APA ADANYA)
GET  /forecast/buffer-config                → list buffer terkonfigurasi
POST /forecast/buffer-config                → set/update buffer 1 item+gudang
```
`generate` dipicu MANUAL (tombol "Generate Usulan"), **bukan cron** di
versi ini — base engine dulu sesuai arahan, otomatisasi jadwal bisa
menyusul (env-gated, pola sama fitur lain) kalau memang diminta.

## Heuristik `suggested_qty` (AWAL, WAJIB direview Supply Chain)

`suggested_qty = round(max(0, buffer_qty - current_qty) + avg_monthly_qty_6m)`
— tutup gap ke buffer (kalau ada) plus estimasi 1 bulan pemakaian. Kalau
trigger cuma dari ED (tak ada buffer dikonfigurasi), `suggested_qty` cuma
`avg_monthly_qty_6m` (rotasi stok, bukan nambah). Ini **bukan angka
final** — makanya UI selalu tampilkan field "Qty Final" terpisah yang
WAJIB diisi Supply Chain sebelum "Ajukan" (submit ditolak kalau qty
efektifnya 0).

## UI

- `/forecast-submission` — tombol "Generate Usulan", tab draft/submitted/
  dismissed, tiap kartu bisa edit qty+catatan, ajukan, atau abaikan. Kartu
  submitted linknya ke halaman detail approval F11.
- `/forecast-submission/config` — cari item (reuse `GET /stock/branch`
  F37, tak ada endpoint baru), pilih gudang, isi buffer. Baris yg stoknya
  sudah ≤ buffer ditandai merah.

## Testing (lokal, data uji dihapus setelah verifikasi)

- Set buffer 1 item+gudang (qty saat ini ≤ buffer) + insert 1 batch ED
  dekat → `generate` membuat 2 usulan draft dgn alasan & angka yang benar
  (dicek manual: gap-to-buffer + avg 6-bulan). ✅
- Re-generate tanpa perubahan kondisi → `skippedExisting` (tak duplikat). ✅
- Edit `final_qty`+`notes` → tersimpan; `submit` → `approval_request` F11
  baru dibuat dgn deskripsi lengkap (item/gudang/qty/alasan/catatan),
  `forecast_suggestion.status` → `submitted` + `approval_request_id`
  terisi. ✅
- `dismiss` → status `dismissed`, tak ikut daftar draft lagi. ✅
- Submit dgn qty efektif 0 → ditolak jelas ("isi final_qty dulu"). ✅
- Halaman list & config render normal; `pnpm typecheck`/`lint`/`build`
  (api+web) semua clean.

## Yang SENGAJA di luar scope

- QC forecast — diabaikan total per arahan Direktur, cuma sales forecast.
- Cron otomatis `generate` — manual dulu, bisa ditambah kalau diminta.
- Pipeline HOT sbg pemicu presisi per-item — structural gap (`product_ids`
  teks bebas), sengaja cuma jadi konteks (lihat bagian di atas).
- Multi-chain approval berbeda per jenis forecast — reuse chain global F11
  yang sama utk semua request, sesuai filosofi "base engine" F11.
- **Sync buffer dari Accurate** — kalau Accurate beneran punya field ini
  (belum diverifikasi field API-nya persis), narik otomatis via puller
  TETAP di luar scope magang (gated "ERP Postgres mirror tables"). Kalau
  suatu saat co-builder/Direktur nambah field itu ke `syncItems()`,
  `item_stock_buffer` di sini bisa di-refactor jadi read dari
  `accurate_item` langsung — skema sekarang sengaja dipisah tabel supaya
  migrasi itu gampang (tinggal ganti sumber baca, kontrak tabel
  `forecast_suggestion` tak perlu berubah).
