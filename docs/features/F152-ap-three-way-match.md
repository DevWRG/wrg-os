# F152 — 3-Way Match Faktur Pembelian (AP): Faktur vs PO vs Penerimaan

- **Domain**: Finance · Hashtag di kartu `#AP #3WAY` (tidak dibangun, lihat §6) · FR-FS-152 · R1 · MUST
- **Owner (board)**: HoD F&SC + Purchasing
- **Menu**: `/ap-three-way` (grup Finance), kunci izin `ap-three-way` (lihat saja), default **tertutup**
- **Migrasi**: `infra/postgres/init/240_ap_three_way_match.sql` — ⚠️ BUTUH MIGRASI DB

Faktur vendor dari Accurate dicocokkan ke PO dan penerimaan barang **per baris**, toleransi **0%**.
Fitur ini **read-only**: selisih hanya ditandai, penyelesaiannya di Accurate oleh admin.

## 1. Keputusan Direktur

| Pertanyaan | Jawaban |
|---|---|
| Sumber faktur vendor | Dari Accurate |
| Toleransi selisih qty & harga | Harus 0% (admin mencocokkan invoice dengan surat jalan) |
| Jadwal bayar | Manual — tidak dibuat di sini |

Default teknis (dikonfirmasi user): selisih hanya ditandai (tanpa catatan/ack), dashboard saja (tanpa hashtag
WA & cron reminder), akses lewat Akses Grup.

## 2. Sumber data (probe read-only Accurate, 19 Okt 2026)

Baris faktur (`purchase-invoice/detail.do` → `detailItem[]`) membawa id sampai tingkat BARIS, jadi join pasti:

| Faktur | Cermin lokal |
|---|---|
| `purchaseOrderDetailId` | `purchase_order_item.accurate_detail_id` (205) |
| `receiveItemDetailId` | `inbound_receiving_line.accurate_detail_id` (206) |

- Harga = `unitPrice` **sebelum** diskon & PPN; diskon di `itemDiscPercent` (string `''`/`'35'`/`'10+5'`) dan
  `itemCashDiscount`. Perbandingan memakai harga + diskon, **bukan** total ber-PPN.
- Nomor SJ vendor tidak ada di faktur → diambil dari penerimaan (`supplier_doc_number`).
- `detailExpense` (biaya/pembulatan, mis. −0,5) bukan bagian match.
- Retur = dokumen sendiri (`purchase-return`, tidak dicermin); faktur membawa `returnQuantity` per baris → qty netto.
- Probe: 33/312 baris tanpa PO, 3/312 tanpa penerimaan → ditampilkan apa adanya, **tidak** dianggap cocok.

## 3. Aturan evaluasi (`apps/api/src/repo/ap-three-way.ts`, logika murni)

Hasil **dihitung saat dibaca**, tak disimpan (tak basi saat PO/penerimaan/faktur berubah). Konstanta
`TOLERANSI_PERSEN = 0`; angka dibandingkan sebagai desimal tepat (bigint skala 1e9), bukan float.

Status baris (terburuk menang): `SELISIH_HARGA` > `SELISIH_QTY` > `SELISIH_SATUAN` > `TANPA_PO` > `TANPA_PENERIMAAN`
> `PENERIMAAN_BELUM_FINAL` > `BELUM_SINKRON` > `PARSIAL` > `MATCH`.

| Cek | Hasil bila gagal |
|---|---|
| Baris menaut ke PO / penerimaan | `TANPA_PO` / `TANPA_PENERIMAAN` |
| Baris PO / penerimaan ada di cermin | `BELUM_SINKRON` |
| Penerimaan final (APPROVED, bukan "Diajukan") | `PENERIMAAN_BELUM_FINAL` |
| Satuan faktur = PO = penerimaan | `SELISIH_SATUAN` (tak dikonversi diam-diam) |
| `unitPrice` faktur = PO | `SELISIH_HARGA` |
| Diskon faktur = PO (baku: `35` = `35.0`; `10+5` ≠ `15`); potongan nominal tanpa padanan PO | `SELISIH_HARGA` |
| Diskon PO belum tersinkron (NULL) | `BELUM_SINKRON` |
| Σ qty difakturkan ≤ qty PO | `SELISIH_QTY` |
| Σ qty difakturkan vs qty diterima: lebih → `SELISIH_QTY`, kurang → `PARSIAL`, sama → cocok | — |

Kumulatif (Σ) = qty netto faktur **final** lain pada baris PO/penerimaan yang sama + baris ini. Faktur final =
APPROVED, bukan `DFT.…`, bukan batal. Faktur draft tetap dievaluasi sebagai **pratinjau** ("kalau diposting").

Status faktur: `SELISIH` (ada baris selisih) · `BELUM_LENGKAP` (tautan hilang/belum final/sinkron) · `PARSIAL` ·
`MATCH` · `DRAFT` · `DIABAIKAN` (batal, atau tanpa baris barang).

## 4. Komponen

- `repo/ap-three-way.ts` — logika murni + query (`listFaktur`, `getFaktur`) + helper cermin; `ap-three-way.test.ts` (35 tes).
- `repo/accurateSync.ts` — `syncPurchaseInvoices` (inkremental `lastUpdate|desc` + watermark −1 jam, detail ditarik ulang
  hanya bila `lastUpdate` berubah, `laporBatasHalaman`, hasil di `accurate_sync_state` entity `purchase-invoice`).
  Juga `syncPurchaseOrders` kini menyimpan `itemDiscPercent` → `purchase_order_item.disc_raw`.
- **Prune faktur hantu**: faktur yang dihapus/dibatalkan permanen di Accurate tak muncul lagi di daftar, sehingga tersisa di cermin dan
  ikut hitungan kumulatif. Sapuan PENUH yang tuntas (`POST …/purchase-invoices?full=1`, halaman habis, tak terpotong) membuang faktur
  bertanggal ≥ `AP_ACCURATE_SINCE` yang tak ada di daftar. Pengaman: dilewati (`prune_skipped`) bila akan menghapus > 20% (respons
  Accurate mencurigakan/terpotong). Sinkron inkremental TIDAK prune — jalankan `?full=1` berkala (mis. mingguan) atau setelah koreksi besar.
- Kumulatif dihitung SEKALI per baris PO/penerimaan (CTE group-by + window), linear: 5.000 faktur ±1 dtk, juga bila 3.000 faktur
  menumpuk di satu baris (versi LATERAL awal 67 dtk). Draft ikut menghitung baris saudara di faktur yang sama.
- `scheduler.ts` — ikut job `accurate-po-sync` (`ACCURATE_PO_SYNC_ENABLED`), SESUDAH PO & penerimaan. Tidak ada job/env baru.
- API: `GET /ap/three-way` (filter `status,q,vendor_id,dari,sampai,limit,offset`), `GET /ap/three-way/:id`,
  `POST /accurate/sync/purchase-invoices[?full=1]` (202, latar).
- Web: `/ap-three-way` (kartu hasil; chip disaring di SERVER krn halaman awal hanya 500 faktur terbaru; tabel, rincian per baris, ekspor CSV mengikuti chip hasil, sel teks berawalan `= + - @` dinetralkan agar bukan rumus Excel), BFF
  `/api/ap-three-way[/:id]` (gerbang `requireFeature("/ap-three-way")`), `lib/ap-three-way-access.ts`.
- Env: `AP_ACCURATE_SINCE` (kosong = ikut `INBOUND_ACCURATE_SINCE`, default 2026-10-01).

## 5. Deploy (setelah merge dev → main; Direktur yang apply)

1. Terapkan migrasi **240** (backup dulu). Migrasi juga mengosongkan `items_last_update` PO Accurate supaya detail PO
   ditarik ulang (mengisi `disc_raw`); ±1.100 PO, 300 per siklus 30 menit.
2. Build api + web, restart pm2 (bentuk ecosystem).
3. Jalankan sinkron manual `POST /accurate/sync/purchase-invoices` (atau tunggu job), cek `GET /ap/three-way` → `sinkron`.
4. **Sync Fitur**, lalu centang `ap-three-way` untuk grup Finance & Purchasing. Sebelum itu hanya admin/superuser.

## 6. Di luar scope / catatan

- Tidak dibangun: jadwal bayar & pengajuan ke VP (Direktur: manual), hashtag `#AP`/`#3WAY`, reminder WA/cron,
  catatan/ack admin atas selisih, perubahan data di Accurate.
- **Cakupan sinkron = sejak `AP_ACCURATE_SINCE`** (default sama dengan penerimaan, 1 Okt 2026). Faktur atas PO/penerimaan
  yang lebih tua dari cakupan cermin tampil `BELUM_SINKRON`, bukan selisih.
- Qty dibandingkan per **satuan baris** (nama satuan); `unitRatio` tak dipakai untuk konversi.
- Belum terverifikasi: re-sync Accurate sungguhan (tak ada kredensial lokal; pemetaan diuji dengan bentuk sampel probe),
  nama field diskon PO `itemDiscPercent` (diasumsikan sama dengan faktur; bila tak ada → `disc_raw` NULL → `BELUM_SINKRON`,
  tidak salah-cocok), faktur batal (tak ada di 150 sampel; dideteksi lewat `statusName` ~ batal/cancel/void), edit faktur
  setelah approved (jawaban Finance C2 belum ada; hasil dihitung ulang tiap `lastUpdate` berubah).
- Sampel JSON probe berisi nama RS customer di `detailNotes` → **jangan di-commit** (repo PUBLIC); tes memakai fixture sintetis.
