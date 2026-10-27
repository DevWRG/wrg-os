# DOC — Document Tracker 9-state machine

| | |
|---|---|
| Domain | DOC (kartu board Todo, blueprint OPEN, S11–S12) |
| Menu | `/doc-tracker` (grup Shipping; kunci izin `doc-tracker`; butuh Sync Fitur + centang grup) |
| API | `GET /doc-tracker`, `GET /doc-tracker/:soId`, `POST /doc-tracker/:soId/{stamp,stamp/cabut,dokumen,faktur,faktur/lepas}` |
| Kode | `apps/api/src/repo/doc-tracker-state.ts` (murni), `doc-tracker.ts`, `apps/web/src/components/doc-tracker/` |
| Migrasi | 258 (`doc_tracker_stamp`, `doc_tracker_dokumen`, `doc_tracker_faktur`) |

## Apa ini
Rapat 2026-10-27: tracker ini **merekap dokumen tiap transaksi — sudah ada atau belum — untuk menyatakan statusnya**, dan inti manfaatnya
cross-check "sudah dikirim, sudah dibayar belum". 9 state (dari foto rapat, dipilih user):

**Draft → Review → Approved → Sent → Received → Executed → Billed → Paid → Closed**

Unit = satu **Sales Order Accurate**. State **tidak disimpan**; dihitung dari data yang sudah ada.

| State | Bukti |
|---|---|
| Draft | SO ada di mirror Accurate |
| Review / Approved | stempel manual di web (siapa & kapan) |
| Sent | semua SJ SO itu punya `kirim_at` (SJ via `accurate_delivery_order_item.sales_order_id`; pengiriman via `shipment_tracking.sj_number` = nomor DO) |
| Received | semua SJ punya `terima_at` |
| Executed | semua SJ punya `bast_at` (BAST/penyerahan; alat: ttd teknisi) |
| Billed | ada faktur terkait |
| Paid | semua faktur terkait lunas (`deriveInvoiceStatus`, satu definisi dengan F31/F91) |
| Closed | Paid **dan** dokumen wajib lengkap (PO customer, SJ ttd Gudang, Sales, Kepala Sales; ttd Teknisi hanya informasi) |

## Aturan
- State = tahap **berurutan** terjauh yang buktinya lengkap. Bukti di tahap lebih jauh tanpa tahap sebelumnya = **anomali "dokumen kurang"** (mis. Billed tanpa BAST).
- Kirim bertahap (banyak SJ/faktur): tahap pengiriman = yang **terendah** di antara semua SJ; Paid = semua faktur lunas. Hitungan (SJ x, BAST y, faktur lunas z) ditampilkan.
- **SO lama** (tanggal < `DOC_TRACKER_STEMPEL_MULAI`, default 2026-11-01): Review/Approved dianggap **tersirat** bila tahap hilir ada — kalau tidak, semua SO lama tampil "Draft" dengan anomali palsu. SO baru: stempel wajib; Approved butuh Review (409 bila tidak).
- **Billing-at-risk** = Executed (BAST ada) **dan** belum ada faktur lebih dari N hari sejak BAST (`DOC_TRACKER_BILLING_HARI`, default 3). **Penanda saja** — tanpa HOLD/release, tanpa WA (keputusan user; definisi "Faktur HOLD" belum ditetapkan Direktur/Husni).
- TTF sengaja tidak dilacak (keputusan Direktur di F12/F42/F31). Kontrak customer (siklus lebih lebar) di luar scope v1; kontrak KSO sudah di F47.

## Faktur ↔ SO: tautan MANUAL (sementara)
Mirror faktur belum terverifikasi membawa referensi SO/SJ (`accurate_invoice_item.raw` = detailItem Accurate utuh; di dev isinya seed). Sampai diverifikasi di data prod, faktur **dipilih manual** per SO lewat dialog detail (kandidat: faktur customer yang sama, 180 hari; customer berbeda ditolak 409). Tautan **tidak pernah ditebak** dari nama customer/tanggal, dan puller/mirror Accurate tidak diubah.
Cek yang diperlukan (read-only, DB prod): `SELECT DISTINCT jsonb_object_keys(raw) FROM accurate_invoice_item` — bila ada kunci rujukan SO/SJ, tautan otomatis bisa ditambahkan (tabel manual tetap sebagai cadangan).

## Akses
`canViewDocTracker`: fallback Direktur/admin/superuser; matriks Akses Grup menang begitu diatur. Stempel, checklist, dan tautan = aksi `edit` (gerbang route `requireFeature("/doc-tracker","edit")`); pelaku `by` dari **sesi**, tak pernah dari body.

## Batasan
- Mirror SO ±500 terbaru (by design, sama dengan Orders/Shipments) → transaksi lama tak tampil.
- Siapa yang berwenang Review/Approve belum didefinisikan (v1 = izin edit fitur). Checklist ttd wajib untuk Closed adalah asumsi — konfirmasi Husni.
- Pencocokan SJ ke pengiriman memakai nomor DO persis (tak peka huruf); pengiriman yang tercatat dengan nomor lain tak terhitung.
