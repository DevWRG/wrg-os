# F12 — Tracking Pengiriman Digital

| | |
|---|---|
| Domain | SHIPPING |
| FR | FR-SB2-12 |
| Hashtag | #KIRIM #BAST (TTF diabaikan, lihat "Keputusan desain") |
| Tier | R2 |
| Prioritas | MUST |
| Sprint | S19-S21 |
| Status | DRAFT-SB2 |
| Owner | Diana (Admin Shipping) |
| Branch | `feat/f12-tracking-pengiriman-digital` (dari `dev`, standalone) |

## Ringkasan

1.407 mention "kirim" di grup WA, 47.7% pesan shipping pakai foto WhatsApp,
customer sering tanya estimasi waktu sampai ("Bu Luri NTT: Lion Parcel
estimasi seminggu kah??"). Multi-region. F12 bikin status kirim per SJ,
dipicu WA hashtag dari kurir atau manual via web, + analitik jarak/durasi
otomatis dari foto ber-geotag. **ETA upfront ke customer SENGAJA
dikosongkan dulu** (arahan Direktur 2026-07-30) — lihat "Keputusan desain"
poin 5.

## Cara kerja

- **Tabel**: `shipment_tracking` (`infra/postgres/init/138_shipment_tracking.sql`
  + `140_shipment_tracking_geo.sql`) — self-contained, `sj_number` TEXT bebas
  (link "logical" ke `accurate_delivery_order` via nomor, bukan FK — pola
  sama dgn F22 `installation_unit.sj_number`). Kolom geo:
  `kirim_lat/kirim_lon/bast_lat/bast_lon`.
- **State machine SEDERHANA 3 langkah**: `draft → dikirim → bast`.
- **API**: `apps/api/src/repo/shipment-tracking.ts` — `createShipment`,
  `markKirim`/`markBast` (terima `{lat, lon}` opsional dari foto ber-geotag),
  `findBySjNumber` (match WA hashtag), `haversineKm` (jarak dari 2 titik).
- **WA hashtag**: `apps/api/src/repo/inbound.ts` — `#KIRIM [SJ_no]` / `#BAST
  [SJ_no]` (foto ber-geotag → `row.geo_lat/geo_lon` diteruskan ke
  `markKirim`/`markBast`), match ke `shipment_tracking` by `sj_number`
  (ILIKE, tanpa gate sender — kurir tak punya roster master data, sama
  filosofi self-contained spt F22). SJ tak ditemukan / format hashtag tak
  lengkap → balasan error, bukan silent-skip (beda dari unknown-sender AM
  yang silent, krn di sini masalahnya bukan identitas pengirim melainkan
  data SJ).
- **Web**: halaman `/shipment-tracking` (grup Operations) — tambah tracking
  (pilih SJ dari mirror Accurate via `/api/shipments`, isi cabang sbg label
  saja — **tak ada input jarak lagi**), aksi manual "Tandai Dikirim"/"Tandai
  BAST" sbg override kalau WA gagal (tanpa geo, jadi `distance_km` tak
  ke-hitung kalau lewat jalur manual ini).

## Keputusan desain

1. **TTF diabaikan** — arahan langsung Direktur di rapat 2026-07-30: "hiraukan
   aja, pakai yang BAST aja." State machine cuma 2 transisi (bukan 3 spt
   rencana awal #BAST #TTF #KIRIM).
2. **✅ RESOLVED (2026-07-30, jawaban final Direktur): `distance_km` DIHITUNG
   OTOMATIS dari foto ber-geotag, BUKAN input manual, BUKAN estimasi
   sebelum-kirim.** Riwayat singkat keputusan (3 iterasi sebelum final):
   - Awalnya: `distance_km` input manual Admin Shipping saat create → ETA
     dihitung dari situ (`ceil(km / SHIPPING_ETA_KM_PER_DAY)`).
   - Koreksi #1: km harus otomatis dari 2 titik koordinat (cabang→customer),
     bukan diketik. Blocked — sumber koordinat cabang tak ada di sistem
     (`accurate_branch` dicek, tak ada lat/lon), koordinat WA cuma via OCR
     foto ber-geotag (`check_photo_geotag.py`, infra "Geo-Tagging Camera"
     AM, bukan native share-location).
   - Koreksi #2: Direktur konfirmasi customer ambil dari foto ber-geotag WA.
   - **Jawaban FINAL Direktur**: "#KIRIM itu posisinya start dari mana, biar
     kelihatan. Terus #BAST juga lokasi customernya. Biar nanti bisa dicek
     analitiknya sesuai jaraknya, kesesuaiannya." → **`#KIRIM` + foto
     ber-geotag capture titik AWAL (dinamis per shipment, TAK PERLU tabel
     referensi cabang lagi — otomatis jawab masalah "koordinat cabang dari
     mana"). `#BAST` + foto ber-geotag capture titik CUSTOMER.** Begitu
     KEDUANYA ada → `distance_km` (haversine) + `eta_days` (durasi AKTUAL
     `kirim_at`→`bast_at`, BUKAN estimasi) dihitung otomatis di
     `markBast()`. Tujuannya **analitik post-hoc** ("kesesuaian" jarak vs
     waktu tempuh), BUKAN kasih customer estimasi upfront sebelum kirim —
     beda total dari desain awal.
   - **Implikasi**: field `distance_km` di form create DIHAPUS (tak relevan
     lagi di awal). Kolom `eta_date` di-drop (redundan dgn `bast_at`).
     Kolom baru: `kirim_lat/kirim_lon/bast_lat/bast_lon`.
   - `SHIPPING_ETA_KM_PER_DAY`/`computeEta()` formula LAMA sudah tak dipakai
     (dihapus dari kode) — km sekarang murni hasil ukur (haversine), bukan
     hasil estimasi kecepatan tempuh.
3. **`kirim_by`/`bast_by` = `sender_name` WA apa adanya** (bukan FK ke
   `master_user`) — kurir/driver tidak selalu karyawan terdaftar, sama
   prinsip self-contained dgn `teknisi_name` di F22.
4. **F45 (Pickup Pre-Visit Verification) belum dikerjakan** — Direktur ACC
   F12+F42+F93 duluan, F45 menyusul kalau ada waktu senggang (lihat memory
   roadmap jobdesk).
5. **✅ ETA upfront ke customer SENGAJA dikosongkan dulu** — arahan Direktur
   eksplisit (2026-07-30): "kosongin ETA-nya dulu saja." Ini keputusan
   final, bukan gap yang perlu ditutup — meski deskripsi awal fitur sebut
   keluhan customer nanya estimasi SEBELUM kirim, sistem saat ini memang
   TIDAK menjawab itu (cuma kasih jarak/durasi AKTUAL setelah BAST). Kalau
   nanti dibutuhkan lagi (mis. estimasi dari data historis per customer),
   itu jadi fitur baru terpisah, bukan revisi F12 ini.

## Verifikasi (2026-07-30, lokal)

- `POST /shipment-tracking` (tanpa jarak, sesuai desain baru) → `distance_km`
  NULL sampai BAST.
- `POST /shipment-tracking/:id/kirim` dgn `{lat, lon}` → `dikirim`, `kirim_lat`/
  `kirim_lon` tersimpan; ulang → ditolak (guard status).
- `POST /shipment-tracking/:id/bast` dgn `{lat, lon}` (titik Malang, ±90km dari
  titik kirim Surabaya) → `bast_lat`/`bast_lon` tersimpan, `distance_km`
  auto-computed **79.9 km** (haversine, cocok jarak lurus Surabaya↔Malang),
  `eta_days` = durasi aktual kirim→bast.
- WA hashtag: insert `wa_message` body `#KIRIM SJ-TEST-002` →
  `POST /wa/inbound/process` → `kind:"kirim"`, `shipment_id` ter-match,
  `kirim_by` terisi nama pengirim WA, balasan stub terkirim. Lanjut `#BAST`
  SJ sama → `status:"bast"`. SJ tak dikenal (`#KIRIM SJ-TIDAK-ADA`) →
  `error:"sj-not-found"`, balasan error terkirim (bukan silent).
- Data uji dihapus setelah verifikasi (`SJ-TEST-001`, `SJ-TEST-002`).

## Terkait

- [F42 — SJ→BAST→TTF Closed-Loop Tracker](#) — akan extend state machine ini
  (belum dikerjakan, next in queue).
- [F93 — Delivery Proof Capture](#) — extend F12+F42 dgn foto+e-signature
  formal via `#KIRIM` (audit trail BAST sign), belum dikerjakan.
