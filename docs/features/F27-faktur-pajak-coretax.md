# F27 — Faktur Pajak / CoreTax Workflow (FINANCE)

Tracker Faktur Pajak (FP) **per invoice**: `diminta → diinput_coretax → disetujui → selesai (bukti)`.
Pembuatan FP-nya tetap di **CoreTax (DJP)** — sistem ini hanya melacak langkah, nomor, dan bukti.

- **Domain**: FINANCE · Hashtag `#FP` · FR-ES-27 · R2 · MUST · Sprint B2 (`DRAFT-SB2`) · owner Fafa HoD · Putri Diana · Fanessa
- **Menu**: `/faktur-pajak` ("Faktur Pajak", grup Finance). Kunci izin `faktur-pajak` (view / create / edit).
- **Migrasi**: `215_faktur_pajak.sql` (2 tabel). **⚠️ BUTUH MIGRASI DB** (Direktur menerapkan ke prod).
  Nomor 215 karena 212–214 dipakai F58 / F56 / F74.
- **Setelah deploy**: klik **Sync Fitur** sekali agar `faktur-pajak` muncul di matriks Akses Grup (tertutup default).
- **Bukan** F91 (status invoice di WA), F149 Fakturis (penerbitan faktur penjualan), F31 Tukar Faktur.

Kartu board hanya satu kalimat ("Tracker FP per nomor (request → coretax input → approve → upload bukti)"),
jadi detail di bawah adalah keputusan teknis — **bisa diubah**, tidak ada yang dikonfirmasi Direktur/Finance.

## Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| 1 | **Fase 1 = tracker FP saja.** Kartu lanjutan (SPT Masa PPN, PPh 21, e-Bupot, ekualisasi — Issue "perlebar scope") **tidak** dikerjakan | itu DraftIssue usulan, bukan scope kartu F27; butuh SOP langkah 248–325 yang tidak ada di repo |
| 2 | Sumber = `accurate_invoice` dengan `tax_amount > 0`; DPP = `taxable_amount`, PPN = `tax_amount`, **disalin apa adanya** | selaras Price Book: angka pajak tak dihitung ulang |
| 3 | Data di-**snapshot** ke `faktur_pajak` (no. invoice, customer, NPWP, DPP, PPN) | invoice di mirror di-upsert berkala; angka yang sudah diajukan ke CoreTax tak boleh bergeser |
| 4 | Satu invoice = **satu FP aktif** (indeks unik parsial); `dibatalkan` boleh diminta ulang | cegah ganda; FP salah bisa diulang |
| 5 | Status satu langkah; **mundur & batal wajib beralasan**; `selesai`/`dibatalkan` final | tak ada langkah yang diam-diam hilang |
| 6 | `disetujui` wajib **nomor FP** (10–25 karakter angka/titik/strip, unik di antara FP aktif); `selesai` wajib **bukti** | format nomor CoreTax berbeda dari e-Faktur lama → regex longgar, keunikan dijaga indeks |
| 7 | **Bukti = tautan https** (Drive), bukan unggah berkas | belum ada penyimpanan berkas generik; lampiran F11 terikat tabel approval. Bisa fase 2 |
| 8 | **Batas terbit** = tgl 15 bulan sesudah masa pajak (masa = bulan tanggal invoice); **terlambat** = belum selesai/batal & hari ini (WIB) lewat batas | aturan PPN (UU PPN pasal 13); dihitung di aplikasi, bukan hardcode di UI |
| 9 | "Approve" = langkah yang dicatat oleh yang punya izin `edit`, **bukan** approval engine F11 (WA `#APPROVE`) | F11 butuh chain & kontak per approver yang belum diputuskan; fase 2 bila perlu |
| 10 | Izin lewat **matriks Akses Grup** kunci `faktur-pajak`: view = lihat, create = ajukan, edit = geser status. Default tertutup. Gerbang di BFF (pola F34) | datanya NPWP + PPN customer; pemisahan peran Finance vs HoD diatur di matriks, tanpa kode |
| 11 | Kandidat pengajuan dibatasi 4 bulan terakhir, maks 200 baris | lewat itu pasti sudah lewat batas terbit; cegah daftar 2000+ invoice |
| 12 | **Tanpa notifikasi WA & scheduler** | target broadcast harus ditentukan user (CLAUDE.md); terlambat ditandai di layar. Reminder = fase 2 |

## API (apps/api)

| Endpoint | Fungsi |
|---|---|
| `GET /faktur-pajak[?status=&masa=YYYY-MM&q=]` | daftar + ringkasan (per status, terlambat) |
| `GET /faktur-pajak/candidates[?q=]` | invoice ber-PPN yang belum punya FP aktif |
| `POST /faktur-pajak` | ajukan `{invoice_id, customer_npwp?, catatan?}` (transaksi: baris + event awal) |
| `GET /faktur-pajak/:id` | detail + riwayat |
| `PATCH /faktur-pajak/:id` | `{customer_npwp?, catatan?}` — hanya saat `diminta`/`diinput_coretax` |
| `POST /faktur-pajak/:id/status` | `{ke, nomor_fp?, bukti_url?, catatan?}` — baris dikunci `FOR UPDATE` |

Kode: 200/201 · 400 `{error,field}` · 404 · 409 (FP aktif ganda, langkah terlarang, nomor dobel, edit setelah disetujui) ·
422 (invoice tanpa PPN) · 503 `migration_pending`. Pelaku `oleh` dari sesi di BFF, bukan body.

## Edge case yang ditangani

Invoice tak ada (404) · invoice tanpa PPN/tanggal (422) · dua klik "Ajukan" bersamaan (409 via indeks unik) · loncat status (409) ·
dua orang menggeser status bersamaan (kunci baris → yang kedua 409) · nomor FP kosong/format salah/dobel (400/409) ·
bukti bukan https (`http:`, `javascript:`) (400) · mundur/batal tanpa alasan (400) · ubah data setelah disetujui (409) ·
FP dibatalkan lalu invoice diminta ulang (boleh) · masa pajak Desember → batas 15 Januari tahun berikutnya ·
tepat di batas belum terlambat · id non-numerik (400) · tabel belum dimigrasi (503, halaman menampilkan pesan).

## Batasan

- NPWP customer tidak selalu ada di mirror Accurate (`accurate_customer.raw.npwpNo`) — bisa dikoreksi manual sebelum disetujui.
- Tidak ada impor/ekspor CSV CoreTax, tidak ada unggah berkas, tidak ada pengingat otomatis (lihat keputusan 7, 12).
- Nota retur / pembatalan FP di CoreTax belum dimodelkan (cukup `dibatalkan` + alasan).

## Berkas

`infra/postgres/init/215_faktur_pajak.sql` · `apps/api/src/repo/faktur-pajak.ts` (+ `.test.ts`) · `apps/api/src/index.ts` (route) ·
`apps/web/src/lib/faktur-pajak-access.ts` · `apps/web/src/lib/nav.ts` · `apps/web/src/app/api/faktur-pajak/**` ·
`apps/web/src/components/faktur-pajak/*` · `apps/web/src/app/(dashboard)/faktur-pajak/page.tsx`
