# DOC — Document Tracker 7-state machine

| | |
|---|---|
| Domain | DOC (kartu board Todo, blueprint OPEN, S11–S12) |
| Menu | `/doc-tracker` (grup Shipping; kunci izin `doc-tracker`; butuh Sync Fitur + centang grup) |
| API | `GET /doc-tracker`, `GET /doc-tracker/:soId`, `POST /doc-tracker/:soId/{dokumen,faktur,faktur/lepas}` |
| Kode | `apps/api/src/repo/doc-tracker-state.ts` (murni), `doc-tracker.ts`, `apps/web/src/components/doc-tracker/` |
| Migrasi | 258 (`doc_tracker_dokumen`, `doc_tracker_faktur`; `doc_tracker_stamp` tak dipakai lagi), 296 (`accurate_invoice_so` + trigger) |
| Sumber lain (dibaca) | `installation_unit` (130/159, Instalasi Aftersales), `arsip_dokumen` (279, Arsip F156) — bila tabelnya belum ada, sumber itu dilewati |

## Apa ini
Rapat 2026-10-27: tracker ini **merekap dokumen tiap transaksi — sudah ada atau belum — untuk menyatakan statusnya**, dan inti manfaatnya
cross-check "sudah dikirim, sudah dibayar belum". Rapat memilih 9 state; **8 Nov 2026 Review & Approved dihapus** (keputusan user):
Accurate menandai semua SO `approvalStatus=APPROVED` (tak ada alur persetujuan), stempel manual hampir tak pernah dipakai, dan
persetujuan sebenarnya terjadi di hulu (SPH/pipeline). Kini 7 state:

**Draft → Sent → Received → Executed → Billed → Paid → Closed**

Unit = satu **Sales Order Accurate**. State **tidak disimpan**; dihitung dari data yang sudah ada.

| State | Bukti |
|---|---|
| Draft | SO ada di mirror Accurate |
| Sent | ada SJ/DO Accurate untuk SO itu (`accurate_delivery_order_item.sales_order_id`) — DO terbit = terkirim dari sudut pandang sistem; waktu = `kirim_at` (`shipment_tracking.sj_number` = nomor DO) bila ada, kalau tidak tanggal DO |
| Received | semua SJ punya `terima_at` |
| Executed | semua SJ ber-BAST: `shipment_tracking.bast_at` (WA #BAST) **atau** `installation_unit` dengan `sj_number` = nomor SJ (dipangkas, tak peka huruf) dan `bast_done = true` (BAST Instalasi Aftersales, waktu `bast_at`). Bila keduanya ada, yang lebih dulu; dialog menandai sumbernya ("BAST WA" / "BAST Instalasi") |
| Billed | ada faktur terkait (otomatis dari Accurate atau tautan manual) |
| Paid | semua faktur terkait lunas (`deriveInvoiceStatus`, satu definisi dengan F31/F91) |
| Closed | Paid **dan** dokumen wajib lengkap (PO customer, SJ ttd Gudang, Sales, Kepala Sales; ttd Teknisi hanya informasi) — centang manual **atau** otomatis dari Arsip (lihat bawah) |

## Aturan (revisi 8 Nov 2026)
Uji di data dev: 499/500 SO macet di Draft — stempel Review/Approved tak diisi, faktur hanya lewat tautan manual, dan terima/BAST dari WA kebanyakan kosong. Aturan diubah (keputusan user):
- State = tahap **terjauh** yang buktinya ada (Draft selalu). Tahap di antaranya yang tak berbukti **tidak menahan** SO — didaftar di `belum_tercatat` (mis. `received, executed`), tampil samar di daftar & dialog. Tidak lagi dihitung anomali.
- **Anomali "dokumen kurang"** = sudah Paid tetapi dokumen wajib belum lengkap (yang menahan Closed). Checklist kurang sebelum lunas bukan anomali.
- "Dikirim, belum dibayar" = Sent (SJ/DO terbit) dan belum Paid.
- Banyak SJ/faktur: Received/Executed butuh **semua** SJ; Paid = semua faktur lunas. Hitungan (SJ x, BAST y, faktur lunas z) ditampilkan.
- **Billing-at-risk** = Executed (BAST ada) **dan** belum ada faktur lebih dari N hari sejak BAST (`DOC_TRACKER_BILLING_HARI`, default 3). **Penanda saja** — tanpa HOLD/release, tanpa WA (keputusan user; definisi "Faktur HOLD" belum ditetapkan Direktur/Husni).
- TTF sengaja tidak dilacak (keputusan Direktur di F12/F42/F31). Kontrak customer (siklus lebih lebar) di luar scope v1; kontrak KSO sudah di F47.

## Checklist dokumen: manual + otomatis dari Arsip F156
Sumber otomatis = `arsip_dokumen` yang **belum dihapus** (`dihapus_at IS NULL`), dicocokkan dengan nomor SJ/faktur SO (tak peka huruf; `ref_*` arsip sudah dipangkas saat simpan):
- **SJ ttd Gudang / Sales / Kepala Sales**: arsip buku `SJ` dengan `ref_sj` = nomor SJ SO. Satu scan SJ bertanda tangan mewakili ketiganya. SO dengan beberapa SJ: **semua** SJ harus punya arsip SJ. SO tanpa SJ tak pernah tercentang otomatis.
- **PO customer**: arsip (buku apa pun) dengan `ref_po` terisi **dan** `ref_sj` = salah satu SJ SO **atau** `ref_faktur` = salah satu faktur SO.
- ttd Teknisi tidak pernah otomatis.
- Centang efektif = manual **atau** Arsip. Dialog menulis "dari Arsip &lt;nomor&gt;" dan kotaknya terkunci; toggle manual hanya mengubah `doc_tracker_dokumen`, tak bisa membatalkan bukti Arsip (hapus/koreksi arsipnya bila salah).
- Dimuat sekali per daftar SO (bukan per SO), sama seperti BAST Instalasi.

## Faktur ↔ SO: otomatis + manual
- **Otomatis** (migrasi 296): ±92% faktur Accurate membawa `raw->'detailItem'[*].salesOrderId`. Trigger `accurate_invoice_so_trg` (AFTER INSERT / UPDATE OF raw / DELETE pada `accurate_invoice`) menghapus lalu mengisi ulang pasangan (invoice_id, so_id) ke `accurate_invoice_so`; isi awal di-backfill sekali. Kueri tracker membaca tabel ini lewat indeks `so_id` — **tidak pernah** membaca `raw` (detoast jsonb = jebakan performa prod).
- **Manual** (`doc_tracker_faktur`): untuk faktur tanpa rujukan SO. Kandidat = faktur customer yang sama (180 hari) yang belum tertaut ke SO ini dan **tidak** punya rujukan SO otomatis; customer berbeda ditolak 409. Tautan tak pernah ditebak dari nama customer/tanggal.
- Bukti faktur = gabungan keduanya, unik per (SO, faktur); dialog menandai `otomatis`/`manual`. Tautan otomatis **tak bisa dilepas** (409 — koreksi di Accurate); menautkan manual faktur yang sudah otomatis → 409.

## Akses
`canViewDocTracker`: fallback Direktur/admin/superuser; matriks Akses Grup menang begitu diatur. Checklist dan tautan faktur = aksi `edit` (gerbang route `requireFeature("/doc-tracker","edit")`); pelaku `by` dari **sesi**, tak pernah dari body.

## Batasan
- Mirror SO ±500 terbaru (by design, sama dengan Orders/Shipments) → transaksi lama tak tampil.
- Checklist ttd wajib untuk Closed adalah asumsi — konfirmasi Husni.
- `doc_tracker_stamp` (migrasi 258) tak lagi dibaca/ditulis sejak Review/Approved dihapus; datanya dibiarkan dan tabelnya boleh di-drop di migrasi terpisah kelak.
- Pencocokan SJ ke pengiriman memakai nomor DO persis (tak peka huruf); pengiriman yang tercatat dengan nomor lain tak terhitung.
