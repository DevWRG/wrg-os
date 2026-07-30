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
estimasi seminggu kah??"). Multi-region. F12 bikin status kirim per SJ +
ETA dari jarak (km), dipicu WA hashtag dari kurir atau manual via web.

## Cara kerja

- **Tabel**: `shipment_tracking` (`infra/postgres/init/068_shipment_tracking.sql`)
  — self-contained, `sj_number` TEXT bebas (link "logical" ke
  `accurate_delivery_order` via nomor, bukan FK — pola sama dgn F22
  `installation_unit.sj_number`).
- **State machine SEDERHANA 3 langkah**: `draft → dikirim → bast`.
- **API**: `apps/api/src/repo/shipment-tracking.ts` — `createShipment`,
  `markKirim`, `markBast`, `findBySjNumber` (match WA hashtag), `computeEta`.
- **WA hashtag**: `apps/api/src/repo/inbound.ts` — `#KIRIM [SJ_no]` / `#BAST
  [SJ_no]` (opsional lampiran foto sbg caption), match ke `shipment_tracking`
  by `sj_number` (ILIKE, tanpa gate sender — kurir tak punya roster master
  data, sama filosofi self-contained spt F22). SJ tak ditemukan / format
  hashtag tak lengkap → balasan error, bukan silent-skip (beda dari
  unknown-sender AM yang silent, krn di sini masalahnya bukan identitas
  pengirim melainkan data SJ).
- **Web**: halaman `/shipment-tracking` (grup Operations) — tambah tracking
  (pilih SJ dari mirror Accurate via `/api/shipments`, isi cabang + jarak km),
  aksi manual "Tandai Dikirim"/"Tandai BAST" sbg override kalau WA gagal.

## Keputusan desain

1. **TTF diabaikan** — arahan langsung Direktur di rapat 2026-07-30: "hiraukan
   aja, pakai yang BAST aja." State machine cuma 2 transisi (bukan 3 spt
   rencana awal #BAST #TTF #KIRIM).
2. **ETA dihitung dari jarak (km), BUKAN integrasi Maps real-time** — arahan
   rapat: estimasi waktu dihitung LANGSUNG dari km (bukan input manual
   per-hari oleh driver). Formula: `computeEta()` — `eta_days =
   ceil(distance_km / SHIPPING_ETA_KM_PER_DAY)` (default 250 km/hari,
   env-override-able). **Ini ASUMSI ballpark** (rapat tidak kasih angka speed
   pasti) — tervalidasi kasar: Surabaya→NTT ±1400km → 6 hari, sejalan dgn
   keluhan "estimasi seminggu" di deskripsi fitur. Kalau Direktur/Biz Dev
   kasih angka speed resmi nanti, tinggal ubah `SHIPPING_ETA_KM_PER_DAY`.
3. **⚠️ `distance_km` SEHARUSNYA otomatis dari koordinat titik A (cabang) →
   titik B (customer), BUKAN diketik manual per shipment** — koreksi user
   2026-07-30 stlh transkrip rapat dibaca ulang: "ngambil starting point-nya
   di mana, terus ke mana, gitu. Dari situ aja" berarti km dihitung dari 2
   titik koordinat, bukan Admin Shipping mengetik angka km tiap kali bikin
   tracking. **BELUM diimplementasikan** — user memilih tanya dulu ke
   Direktur/Biz Dev sebelum coding, krn 2 pertanyaan sumber data ini belum
   ada jawaban:
   - Koordinat titik A (cabang/gudang asal) dari mana? Opsi: tabel referensi
     baru (isi manual sekali per cabang, jumlah sedikit) vs sudah ada di
     mirror Accurate (`accurate_branch` — perlu dicek apakah sudah simpan
     lat/lon).
   - Koordinat titik B (lokasi customer) dari mana? Opsi: reuse
     `sales_plan.visit_lat/visit_lon` (sudah ada dari fitur Visits, tapi cuma
     nutup customer yg pernah dikunjungi AM — gap utk customer baru) vs input
     sekali per customer (map picker) saat tracking pertama dibuat.
   **Status implementasi saat ini: `distance_km` MASIH input manual per
   shipment (lihat form `/shipment-tracking`) — INI PLACEHOLDER SEMENTARA**,
   bukan desain final. State machine kirim→BAST (bagian utama F12) sudah
   selesai & tidak terpengaruh perubahan ini — cuma cara isi `distance_km`
   yang perlu direvisi begitu sumber koordinat dikonfirmasi.
4. **`kirim_by`/`bast_by` = `sender_name` WA apa adanya** (bukan FK ke
   `master_user`) — kurir/driver tidak selalu karyawan terdaftar, sama
   prinsip self-contained dgn `teknisi_name` di F22.
5. **F45 (Pickup Pre-Visit Verification) belum dikerjakan** — Direktur ACC
   F12+F42+F93 duluan, F45 menyusul kalau ada waktu senggang (lihat memory
   roadmap jobdesk).

## Verifikasi (2026-07-30, lokal)

- `POST /shipment-tracking` (jarak 1400km) → `eta_days:6, eta_date` benar.
- `POST /shipment-tracking/:id/kirim` → `dikirim`; ulang → ditolak (guard
  status).
- `POST /shipment-tracking/:id/bast` → `bast`.
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
