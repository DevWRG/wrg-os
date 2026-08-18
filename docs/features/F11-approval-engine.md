# F11 — Approval Engine #APPROVE/#REJECT bot

Domain: OPS · Hashtag `#APPROVE #REJECT` · FR FR-SB2-11 · Owner: Direktur + all HoD.

## Ringkasan

**Base/generic approval engine** (arahan Direktur, meeting 2026-08-13) — bukan
fitur approval untuk 1 proses spesifik, tapi mesin dasar yang fitur lain ke
depan reuse. Chain SEKUENSIAL 5 tahap: **HoD Sales → HoD Bisnis → HoD After
Sales → HoD Supply Chain → Direktur**. Tiap tahap dinotifikasi via WA
**privat** (bukan grup) SATU PER SATU — tahap berikutnya baru dikirim setelah
tahap sekarang approve. Reject di tahap manapun langsung menghentikan chain.

## Keputusan penting dari meeting (override blueprint lama)

Blueprint asli menyebut "multi-tier **nominal-based**" (tersirat: jumlah
tahap tergantung besar nominal). Arahan Direktur di meeting: chain **SELALU
5 tahap tetap**, tidak berubah berdasarkan nominal. Kolom `nominal` tetap
disimpan (histori/tampilan), tapi TIDAK dipakai menentukan jumlah tahap.

## Kontak per tahap — BELUM DIKETAHUI saat fitur ini dibangun (2026-08-18)

User (magang) belum tahu nomor WA HoD Sales/Bisnis/Supply Chain — Direktur
akan kasih menyusul. Roster HoD sebenarnya ada **8 orang** (bukan 4),
sementara brief Direktur cuma sebut 4 label generik + Direktur:

| Label di brief | Kandidat di roster (`apps/api/src/hod-resolver.ts`) | Status |
|---|---|---|
| HoD Sales | Rocky (Sales East) atau Yogi (Sales West) | **Belum diputuskan** |
| HoD Bisnis | Mufid (Business IVD) atau Arman (Business Medical) | **Belum diputuskan** |
| HoD After Sales | Muhid (Aftersales) | ✅ Non-ambigu, sudah di-default |
| HoD Supply Chain | Ika (HoD Finance & SC) atau Pita (Leader SC, bukan level HoD) | **Belum diputuskan** |
| Direktur | — (resolve via `app_user.role='direktur'`) | Perlu akun app_user Direktur diisi |

**Keputusan desain (arahan user)**: bangun BASE ENGINE dulu tanpa hardcode
kontak — begitu Direktur kasih kontak, tinggal isi lewat halaman
`/approval-requests/config`, TANPA perlu ubah kode/migrasi/redeploy.

## Lampiran PDF/PNG (susulan, arahan user 2026-08-18)

- Upload via form web (`/approval-requests`), dikonversi ke base64 di
  browser, dikirim sekali bareng payload create request. **Ini upload
  browser PERTAMA di repo ini** — semua media lain (foto WA) datang dari WA
  bridge (`MEDIA_ROOT`), bukan form dashboard.
- Disimpan di disk lokal (`APPROVAL_UPLOAD_ROOT`, default
  `~/.wrg-os/approval-uploads/<request_id>/<uuid>.<ext>`), path relatif
  disimpan di `approval_attachment.file_path`. Mime dibatasi PERSIS
  `application/pdf` / `image/png` (sesuai yang diminta), validasi SEMUA file
  dulu (mime, base64 valid, ukuran ≤8MB) SEBELUM baris apa pun disimpan —
  cegah request kebentuk dgn lampiran cuma sebagian kalau 1 file di tengah
  gagal.
- **WA tidak mengirim file media** — gateway (`wasend.ts`) cuma terima
  `{to, message}` teks, tak ada kontrak kirim media. Pesan notifikasi
  menyisipkan **link** ke halaman detail (`/approval-requests/:id`, baru,
  dibuat khusus utk ini) yang menampilkan daftar lampiran + link unduh.
  Link ini lewat gerbang sesi dashboard (`middleware.ts`) yang sudah ada,
  jadi tetap butuh login — bukan link publik tanpa auth.
- `GET /approval-requests/:id/attachments/:attachmentId` — serve file,
  path-safe (baca `file_path` dari DB, di-join di dalam
  `APPROVAL_UPLOAD_ROOT`, tak ada input mentah dari user yang jadi path).

## Skema DB (migrasi 106_approval_engine.sql)

- `approval_chain_config` — 5 baris GLOBAL (1 chain untuk semua request
  sekarang), `hod_key` NULL = belum dikonfigurasi (state sah, bukan error).
  `wa_number_override` untuk orang yang belum punya akun `app_user` (mis.
  Pita kalau dipilih, karena dia bukan level HoD).
- `approval_request` — 1 baris per permintaan, `kode` (`APR-0001` dst, dari
  `SEQUENCE` biar atomik) dipakai di balasan WA.
- `approval_step` — snapshot per tahap SAAT request dibuat (label/hod_key),
  status pending/approved/rejected/skipped.

## Resolusi target notifikasi — LIVE, bukan snapshot statis

`hod_key`/`wa_number_override` di `approval_step` di-snapshot saat request
dibuat, TAPI kalau `hod_key` snapshot itu NULL (belum dikonfigurasi), sistem
tetap cek `approval_chain_config` LIVE tiap mau kirim & **backfill** snapshot
begitu ketemu. Ini penting: tanpa ini, endpoint retry-notify
(`POST /approval-requests/:id/notify`) percuma — request yang dibuat SEBELUM
kontak diisi tidak akan pernah bisa dikirim ulang. Nomor WA sendiri diambil
dari `app_user.wa_number` via `hod_key`/`role='direktur'` — bukan
disnapshot, supaya begitu app_user diisi otomatis kepakai.

## Alur API

```
POST /approval-requests              → buat request, notify tahap 1 otomatis
GET  /approval-requests               → list (filter ?status=)
GET  /approval-requests/:id           → detail + semua step
POST /approval-requests/:id/notify    → retry kirim notifikasi tahap current
GET  /approval-requests/config/chain  → lihat config 5 tahap
PATCH /approval-requests/config/chain/:urutan → isi hod_key / wa_number_override
```

## Hashtag WA `#APPROVE`/`#REJECT`

Format: `#APPROVE <kode>` / `#REJECT <kode> [alasan]`. Bisa dikirim dari
**pesan privat (DM)** — pipeline ingest (`wa.ts: chatJid = group_jid untuk
grup, sender untuk direct`) sudah generik jalur, TIDAK butuh kode baru
khusus DM. Approver diresolve dari `app_user.wa_number` (fungsi
`resolveApprover()`, BEDA dari `resolveSender()` yang dipakai fitur AM —
approver F11 itu akun dashboard HoD/Direktur, bukan roster AM).

**Guard penting**: approver harus PERSIS pemegang tahap `current_urutan`
request itu — HoD tahap lain yang coba approve/reject ditolak dengan pesan
"bukan giliran kamu approve/reject permintaan ini".

## UI

- `/approval-requests` — buat request baru (title/deskripsi/nominal/
  requestedBy/WA), list request dgn progress 5 tahap, tombol "Kirim Ulang
  Notifikasi" muncul otomatis kalau tahap current belum ternotifikasi
  (indikasi kontak belum dikonfigurasi).
- `/approval-requests/config` — pilih HoD per tahap (dropdown 8 opsi) +
  override nomor WA manual.

## Testing (lokal, data uji dihapus setelah verifikasi)

- Chain lengkap 5 tahap approve berturut-turut → status akhir `approved`. ✅
- Reject di tengah chain → status `rejected`, decision_note tersimpan,
  requester dinotifikasi (kalau `requestedByWa` diisi). ✅
- Guard: approver salah tahap ditolak jelas, tidak mengubah state. ✅
- Kontak belum dikonfigurasi → request tetap tersimpan, notify gagal dengan
  pesan jelas (bukan silent/crash). ✅
- Retry-notify setelah config diisi belakangan → berhasil kirim + snapshot
  ter-backfill (bug ditemukan & diperbaiki saat testing — awalnya snapshot
  NULL permanen, retry percuma). ✅
- `wa_number_override` menang duluan dari `app_user` lookup. ✅
- Upload PNG → tersimpan, di-download balik lewat API → ukuran byte identik
  dgn file asli. ✅
- Mime tak didukung (`application/x-msdownload`) → ditolak 400, tak ada
  baris tersimpan. ✅
- File >8MB → ditolak 400 dgn pesan ukuran jelas, tak ada baris tersimpan. ✅
- `pnpm typecheck`/`lint`/`build` (api+web) — semua clean.

## Yang SENGAJA di luar scope MVP ini

- Timeout/reminder otomatis kalau approver tidak respons — belum dibangun,
  bisa jadi enhancement (butuh cron + threshold waktu, belum diminta).
- UI khusus "approval saya" untuk HoD/Direktur (list pending assigned ke
  mereka) — interaksi utama sengaja lewat WA sesuai brief, halaman web
  sekarang fokus ke pembuat request + admin config.
- Multi-chain-type (beda proses butuh urutan tahap beda) — sekarang 1 chain
  global untuk semua request, sesuai arahan "base" dulu.
