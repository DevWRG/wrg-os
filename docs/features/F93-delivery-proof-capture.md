# F93 — Delivery Proof Capture (photo + e-signature)

| | |
|---|---|
| Domain | OPS |
| FR | FR-KMP-93 |
| Hashtag | #KIRIM #BUKTI (lihat "Keputusan desain" poin 1 — bukan #KIRIM) |
| Tier | R1 |
| Prioritas | SHOULD |
| Sprint | B2 |
| Status | DRAFT-KMP |
| Owner | Kolis, Kurir, 12 AM |
| Branch | `feat/f93-delivery-proof-capture` (dibangun DI ATAS branch F42, yang DI ATAS branch F12) |

## Ringkasan

Extension dari F12 + F42. Kurir upload foto bukti terima + scan tanda
tangan customer via WhatsApp, jadi audit trail tambahan SETELAH BAST
selesai — bukan state baru di state machine (status tetap `bast`).

## Dependensi

F93 extend tabel `shipment_tracking` yang sama (kolom baru), dan
`markBukti()` butuh status sudah `bast` (hasil F42). Branch di-*fork* dari
`feat/f42-sj-bast-closed-loop-tracker`. **F12 dan F42 harus merge ke `dev`
duluan** sebelum PR ini di-merge (pola F22→F24→F8).

## ⚠️ Koreksi vs deskripsi board (dikonfirmasi user sebelum coding)

Deskripsi board tulis *"#KIRIM [SJ_no] + photo + signature scan"*, tapi
field Hashtag sebut `#KIRIM #BUKTI` (dua hashtag) dan konteks lain
("foto bukti **terima**", "audit trail utk **BAST** sign") jelas menunjuk
ke momen BAST, bukan KIRIM (baru berangkat dari gudang — kurir belum ketemu
customer, gak masuk akal "bukti terima" di titik itu). **Diputuskan: hashtag
aktual yang dipakai adalah `#BUKTI`, dipasang SETELAH status `bast`.**
`#KIRIM` di deskripsi board dianggap referensi ke F12 (existing), bukan
instruksi teknis literal.

## Cara kerja

- **Migrasi**: `infra/postgres/init/071_shipment_tracking_bukti.sql` — 4
  kolom baru di `shipment_tracking`: `bukti_photo_path`,
  `signature_photo_path`, `bukti_at`, `bukti_by`.
- **API**: `apps/api/src/repo/shipment-tracking.ts` — `markBukti()`, guard
  status harus `bast`. **2 slot foto**: kirim foto pertama → isi
  `bukti_photo_path`; foto kedua (scan tanda tangan) → isi
  `signature_photo_path`. Kurir yang cuma kirim 1 foto gabungan (barang +
  slip tanda tangan kelihatan sekaligus) tetap valid — slot signature boleh
  kosong, bukan error. Slot ketiga dst → ditolak ("slot bukti & signature
  sudah terisi keduanya").
- **WA hashtag**: `apps/api/src/repo/inbound.ts` — `#BUKTI [SJ_no]`
  (opsional foto), TANPA geo (bukan titik baru, cuma audit trail). Match by
  `sj_number` sama pola `#KIRIM`/`#BAST`.
- **Web**: halaman `/shipment-tracking` (sama dgn F12/F42) — kolom baru
  "Bukti (F93)" nunjukin status 2 slot (📷/✍️), + tombol "Tandai Bukti"
  (manual-only, override kalau WA gagal — TANPA upload foto di web, cuma
  re-confirm `bukti_by`).
- **"Auto-attach ke SJ record di Accurate mirror"** dari deskripsi board
  **TIDAK diartikan literal** — mirror Accurate READ-ONLY (lihat CLAUDE.md),
  gak bisa ditulisi balik. "Attach" di sini = nempel ke
  `shipment_tracking` yang sudah link "logical" ke SJ Accurate via
  `sj_number` (sama pola F12/F22).

## Keputusan desain

1. **Hashtag `#BUKTI`, bukan `#KIRIM`** — lihat bagian "Koreksi" di atas.
2. **2 slot foto (bukti + signature), diisi berurutan** — akomodir baik
   kurir yang kirim 2 foto terpisah maupun 1 foto gabungan.
3. **Tidak mengubah state machine** — `markBukti()` cuma nempel field, status
   tetap `bast`. Beda dari F42 yang nambah state `terima`.
4. **Tanpa geo** — foto bukti/signature gak perlu OCR geotag (beda dari
   foto `#KIRIM`/`#BAST` F12 yang geo-nya dipakai hitung jarak).

## Verifikasi (lokal)

- `POST /shipment-tracking/:id/bukti` sebelum status `bast` → ditolak.
- Kirim bukti 1 (foto) → `bukti_photo_path` terisi, status tetap `bast`.
- Kirim bukti 2 (foto lain) → `signature_photo_path` terisi.
- Kirim bukti 3 → ditolak, kedua slot sudah penuh.
- WA hashtag `#BUKTI [SJ_no]` + foto → slot pertama terisi, `bukti_by`
  terisi nama pengirim WA; ulang di shipment yang sudah penuh → balasan
  error (bukan crash).
- Typecheck + lint (api & web) + `next build` clean.

## Terkait
- [F12 — Tracking Pengiriman Digital](./F12-tracking-pengiriman-digital.md)
- [F42 — SJ→BAST Closed-Loop Tracker](./F42-sj-bast-closed-loop-tracker.md)
