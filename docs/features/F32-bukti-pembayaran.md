# F32 — Bukti Pembayaran

**Menu:** Finance → Bukti Pembayaran (`/bukti-pembayaran`) · **Migrasi:** 238 · **Kunci izin:** `bukti-pembayaran` (view / create)

## Apa ini
Arsip foto bukti pembayaran yang ditandai **kode pengajuan**. Admin mengunggah foto + kode di dashboard;
**tim accounting yang mencocokkan sendiri** ke pengajuan/Accurate. Sistem hanya menyimpan dan menyajikan bukti.

Keputusan Direktur (rapat 2026-10-19), menggantikan brief awal "Auto-Reconcile (OCR)":
- tanpa WhatsApp (unggah langsung di dashboard, penggunanya admin),
- tanpa OCR / Tesseract / LLM vision,
- tanpa pencocokan ke Accurate (accounting yang mengerjakannya).

## Cara kerja
1. Admin/Finance membuka menu, mengetik **kode pengajuan** (mis. `CN-00012`), memilih foto, catatan opsional, **Simpan bukti**.
2. Kode dinormalkan (spasi pinggir dibuang, huruf besar) dan harus `2–40` karakter `A-Z 0-9 . _ / -`, diawali huruf/angka.
   Spasi **di tengah** kode ditolak (bukan dibuang) supaya `CN 00012` tak diam-diam menjadi `CN00012`.
3. Tipe berkas dibaca dari **isinya** (magic bytes): JPG, PNG, WebP, PDF; maks. **8 MB**. Label MIME/ekstensi dari browser tidak dipercaya.
4. Berkas disimpan di disk (`BUKTI_PEMBAYARAN_UPLOAD_DIR`, default `~/.wrg-os/uploads/bukti-pembayaran`) dengan nama acak;
   metadata di tabel `bukti_pembayaran`. Pengunggah & waktu dicatat dari **sesi**, bukan dari body.
5. Riwayat bisa dicari (kode, nama berkas, catatan, pengunggah) dan dibuka/diunduh dari tabel.

Satu kode boleh punya beberapa bukti (tiap unggahan = satu baris).

## Keputusan desain
- **Kode pengajuan = teks bebas, tanpa FK.** Tak ada kode pengajuan seragam di repo (`OT-0001`, `APR-0001`, `CN-00001`;
  fund_request tak punya kode). Menautkan ke satu tabel akan menyisihkan jenis pengajuan lain.
- **Append-only.** Tak ada ubah/hapus lewat aplikasi, dan role `wrg_app` hanya diberi `SELECT, INSERT` — ini bukti.
  Konsekuensinya salah unggah tidak bisa dibatalkan dari UI; koreksi = unggah bukti yang benar + catatan.
- **Berkas di luar allow-list `/api/media`**: hanya bisa diunduh lewat `/api/bukti-pembayaran/:id/file` yang dijaga izin.
- Pola unggah mengikuti F47 (KSO kontrak dokumen).

## Akses
Kunci `bukti-pembayaran`: **view** = lihat & unduh, **create** = unggah. Tertutup default setelah deploy:
jalankan **Sync Fitur** lalu centang grup di Akses Grup. Fallback sebelum matriks diatur (admin/superuser selalu lolos):
- lihat: Direktur + Finance (`hod_key='ika'` / title finance),
- unggah: Finance (Direktur hanya membaca).

## Endpoint
| API (apps/api) | BFF (apps/web) | Izin |
|---|---|---|
| `POST /bukti-pembayaran` (multipart `file`, `kode`, `catatan?`, `oleh`) | `POST /api/bukti-pembayaran` | create |
| `GET /bukti-pembayaran?kode=&q=&limit=&offset=` | `GET /api/bukti-pembayaran` | view |
| `GET /bukti-pembayaran/:id/file` | `GET /api/bukti-pembayaran/:id/file` | view |

## Setelah deploy
1. Terapkan migrasi 238 ke dev + prod (manual).
2. Pastikan folder unggahan bisa ditulis proses API, dan **ikut dicadangkan** (berkasnya tidak ada di DB).
3. Sync Fitur + centang grup (admin/Finance: lihat+unggah; Direktur: lihat).

## Di luar cakupan
OCR, pencocokan otomatis ke Accurate/pengajuan lain, WA, edit/hapus, notifikasi.
