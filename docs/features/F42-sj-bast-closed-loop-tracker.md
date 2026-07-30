# F42 — SJ → BAST Closed-Loop Tracker

| | |
|---|---|
| Domain | SHIPPING |
| FR | FR-ES-42 |
| Hashtag | #SJ #BAST #TTF (TTF diabaikan, lihat "Keputusan desain") |
| Tier | R2 |
| Prioritas | MUST |
| Sprint | B1 |
| Status | DRAFT-SB1 |
| Owner | Diana (Adm Shipping), Karib, Rizal, Kirim-Tagih |
| Branch | `feat/f42-sj-bast-closed-loop-tracker` (dibangun DI ATAS branch `feat/f12-tracking-pengiriman-digital`) |

## Ringkasan

Extend F12: tiap SJ punya status flow lebih detail — kirim → **terima**
(barang sampai di customer) → BAST sign. Deskripsi board asli sebut 5
langkah sampai "faktur titip → ttf cair", tapi **Direktur eksplisit
memutuskan (2026-07-30): "cukup sampai BAST aja, tidak pakai TTF"** — sama
seperti keputusan F12 sebelumnya, ternyata berlaku juga di F42.

## Dependensi ke F12

F42 nambah 1 state (`terima`) ke tabel `shipment_tracking` yang sama yang
dibuat F12 — karena itu branch ini di-*fork* dari branch F12, bukan dari
`dev`. **F12 harus di-merge ke `dev` duluan** sebelum F42 di-PR, supaya diff
PR F42 bersih (pola sama dgn F22→F24).

## Cara kerja

- **Migrasi**: `infra/postgres/init/069_shipment_tracking_terima.sql` —
  ALTER TABLE `shipment_tracking`, tambah kolom `terima_at`/`terima_by` +
  perluas CHECK constraint status jadi `('draft','dikirim','terima','bast')`.
- **State machine JADI**: `draft → dikirim → terima → bast` (4 langkah,
  sebelumnya F12 cuma 3).
- **API**: `apps/api/src/repo/shipment-tracking.ts` — fungsi baru
  `markTerima()` (guard: hanya dari status `dikirim`), `markBast()`
  di-update guard-nya (sebelumnya dari `dikirim`, SEKARANG WAJIB dari
  `terima` — tak bisa lompat BAST tanpa tandai terima dulu).
- **Web**: `shipment-tracking-row-actions.tsx` nambah step "Tandai Terima"
  di antara Dikirim dan BAST. Progress dots tabel jadi 3 titik.
- **WA hashtag**: `#KIRIM`/`#BAST` tetap dari F12 (tak berubah) — TAPI
  `#BAST` sekarang akan DITOLAK (balasan error, bukan crash) kalau langkah
  `terima` belum ditandai.

## Keputusan desain

1. **TTF diabaikan JUGA di F42** (bukan cuma F12) — konfirmasi eksplisit
   Direktur 2026-07-30. Langkah "faktur titip" & "ttf cair" dari deskripsi
   board asli **TIDAK diimplementasikan**.
2. **State "terima" MANUAL-ONLY via web** (Admin Shipping/Kirim-Tagih),
   **BUKAN** hashtag WA — board F42 cuma sebut hashtag `#SJ #BAST #TTF`,
   tak ada utk "terima". **Ini keputusan default engineer** (belum
   eksplisit ditanyakan/dikonfirmasi Direktur secara terpisah) — kalau
   nanti ternyata Direktur mau ada hashtag utk ini juga, tinggal tambah
   pattern serupa `#KIRIM`/`#BAST` di `inbound.ts`.
3. **Hashtag `#SJ`** dari deskripsi board TIDAK diimplementasikan sbg
   trigger WA — pembuatan record `shipment_tracking` (mulai dari SJ) sudah
   ditangani F12 lewat form web (pilih SJ dari mirror Accurate), bukan lewat
   hashtag. `#SJ` dianggap deskriptif (menandai titik awal alur), bukan
   hashtag actionable terpisah.

## Verifikasi (2026-07-30, lokal)

- `POST /shipment-tracking/:id/bast` langsung dari `draft` → ditolak
  (`"langkah terima belum ditandai"`).
- `kirim` → `bast` langsung tanpa `terima` → tetap ditolak.
- `kirim` → `terima` → `bast` berurutan → semua sukses, `terima_by` terisi.
- WA hashtag: `#KIRIM` sukses → `#BAST` (sebelum terima) → balasan error
  (bukan crash) → tandai `terima` via API → `#BAST` lagi → sukses.
- Data uji dihapus setelah verifikasi. Typecheck + lint (api & web) clean.

## Terkait

- [F12 — Tracking Pengiriman Digital](./F12-tracking-pengiriman-digital.md) — dependensi wajib, harus merge duluan.
- [F93 — Delivery Proof Capture](#) — akan extend F12+F42 dgn foto+e-signature formal (belum dikerjakan).
