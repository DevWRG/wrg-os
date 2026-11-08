# DOC — Document Tracker 9-state machine

| | |
|---|---|
| Domain | DOC (kartu board Todo, blueprint OPEN, S11–S12) |
| Menu | `/doc-tracker` (grup Shipping; kunci izin `doc-tracker`; butuh Sync Fitur + centang grup) |
| API | `GET /doc-tracker`, `GET /doc-tracker/:soId`, `POST /doc-tracker/:soId/{stamp,stamp/cabut,dokumen,faktur,faktur/lepas}` |
| Kode | `apps/api/src/repo/doc-tracker-state.ts` (murni), `doc-tracker.ts`, `apps/web/src/components/doc-tracker/` |
| Migrasi | 258 (`doc_tracker_stamp`, `doc_tracker_dokumen`, `doc_tracker_faktur`), 296 (`accurate_invoice_so` + trigger) |

## Apa ini
Rapat 2026-10-27: tracker ini **merekap dokumen tiap transaksi — sudah ada atau belum — untuk menyatakan statusnya**, dan inti manfaatnya
cross-check "sudah dikirim, sudah dibayar belum". 9 state (dari foto rapat, dipilih user):

**Draft → Review → Approved → Sent → Received → Executed → Billed → Paid → Closed**

Unit = satu **Sales Order Accurate**. State **tidak disimpan**; dihitung dari data yang sudah ada.

| State | Bukti |
|---|---|
| Draft | SO ada di mirror Accurate |
| Review / Approved | stempel manual di web (siapa & kapan) |
| Sent | ada SJ/DO Accurate untuk SO itu (`accurate_delivery_order_item.sales_order_id`) — DO terbit = terkirim dari sudut pandang sistem; waktu = `kirim_at` (`shipment_tracking.sj_number` = nomor DO) bila ada, kalau tidak tanggal DO |
| Received | semua SJ punya `terima_at` |
| Executed | semua SJ punya `bast_at` (BAST/penyerahan; alat: ttd teknisi) |
| Billed | ada faktur terkait (otomatis dari Accurate atau tautan manual) |
| Paid | semua faktur terkait lunas (`deriveInvoiceStatus`, satu definisi dengan F31/F91) |
| Closed | Paid **dan** dokumen wajib lengkap (PO customer, SJ ttd Gudang, Sales, Kepala Sales; ttd Teknisi hanya informasi) |

## Aturan (revisi 8 Nov 2026)
Uji di data dev: 499/500 SO macet di Draft — stempel Review/Approved tak diisi, faktur hanya lewat tautan manual, dan terima/BAST dari WA kebanyakan kosong. Aturan diubah (keputusan user):
- State = tahap **terjauh** yang buktinya ada (Draft selalu). Tahap di antaranya yang tak berbukti **tidak menahan** SO — didaftar di `belum_tercatat` (mis. `review, approved, received, executed`), tampil samar di daftar & dialog. Tidak lagi dihitung anomali.
- **Anomali "dokumen kurang"** = sudah Paid tetapi dokumen wajib belum lengkap (yang menahan Closed). Checklist kurang sebelum lunas bukan anomali.
- "Dikirim, belum dibayar" = Sent (SJ/DO terbit) dan belum Paid.
- Aturan stempel tetap: Approved butuh Review (SO baru, 409), Review tak bisa dicabut selama Approved ada.
- Banyak SJ/faktur: Received/Executed butuh **semua** SJ; Paid = semua faktur lunas. Hitungan (SJ x, BAST y, faktur lunas z) ditampilkan.
- **SO lama** (tanggal < `DOC_TRACKER_STEMPEL_MULAI`, default 2026-11-01): Review/Approved dianggap **tersirat** bila tahap hilir ada (Review juga tersirat bila Approved sudah distempel) sehingga tak masuk `belum_tercatat`. SO baru: hanya dari stempel.
- **Billing-at-risk** = Executed (BAST ada) **dan** belum ada faktur lebih dari N hari sejak BAST (`DOC_TRACKER_BILLING_HARI`, default 3). **Penanda saja** — tanpa HOLD/release, tanpa WA (keputusan user; definisi "Faktur HOLD" belum ditetapkan Direktur/Husni).
- TTF sengaja tidak dilacak (keputusan Direktur di F12/F42/F31). Kontrak customer (siklus lebih lebar) di luar scope v1; kontrak KSO sudah di F47.

## Faktur ↔ SO: otomatis + manual
- **Otomatis** (migrasi 296): ±92% faktur Accurate membawa `raw->'detailItem'[*].salesOrderId`. Trigger `accurate_invoice_so_trg` (AFTER INSERT / UPDATE OF raw / DELETE pada `accurate_invoice`) menghapus lalu mengisi ulang pasangan (invoice_id, so_id) ke `accurate_invoice_so`; isi awal di-backfill sekali. Kueri tracker membaca tabel ini lewat indeks `so_id` — **tidak pernah** membaca `raw` (detoast jsonb = jebakan performa prod).
- **Manual** (`doc_tracker_faktur`): untuk faktur tanpa rujukan SO. Kandidat = faktur customer yang sama (180 hari) yang belum tertaut ke SO ini dan **tidak** punya rujukan SO otomatis; customer berbeda ditolak 409. Tautan tak pernah ditebak dari nama customer/tanggal.
- Bukti faktur = gabungan keduanya, unik per (SO, faktur); dialog menandai `otomatis`/`manual`. Tautan otomatis **tak bisa dilepas** (409 — koreksi di Accurate); menautkan manual faktur yang sudah otomatis → 409.

## Akses
`canViewDocTracker`: fallback Direktur/admin/superuser; matriks Akses Grup menang begitu diatur. Stempel, checklist, dan tautan = aksi `edit` (gerbang route `requireFeature("/doc-tracker","edit")`); pelaku `by` dari **sesi**, tak pernah dari body.

## Batasan
- Mirror SO ±500 terbaru (by design, sama dengan Orders/Shipments) → transaksi lama tak tampil.
- Siapa yang berwenang Review/Approve belum didefinisikan (v1 = izin edit fitur). Checklist ttd wajib untuk Closed adalah asumsi — konfirmasi Husni.
- Pencocokan SJ ke pengiriman memakai nomor DO persis (tak peka huruf); pengiriman yang tercatat dengan nomor lain tak terhitung.
