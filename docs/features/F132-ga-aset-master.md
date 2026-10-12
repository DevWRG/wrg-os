# F132 — Aset Master GA (General Affairs)

| | |
|---|---|
| Domain | GA |
| FR | FR-GA-132 |
| Tier | R1 |
| Prioritas | MUST |
| Sprint | S10 |
| Owner | Husni (A), Dito Anggara (R) |
| Branch | `feat/f132-ga-aset-master` (dari `dev`, root — F52/F133/F137 depend ke sini) |

## Ringkasan

Katalog inventaris kantor (laptop, HP, kendaraan, mebel, license software) —
single source of truth SEMUA aset kantor. Menyerap rencana F52 (IT Asset
Tracker) yang tadinya mau bikin tabel `it_asset` sendiri — arahan Direktur:
F132 jadi satu-satunya sumber data aset, F52 cukup FK ke sini (PR terpisah,
lihat branch `feat/f52-it-asset-issue-tracker` di atas branch ini).

## Cara kerja

- **Skema diadaptasi dari repo `gais`** (github.com/ditoanggara919-lang/gais
  — prototipe internal GA sebelumnya), diterjemahkan ke konvensi wrg-os
  (uuid, `app_user`). Termasuk formula `asset_code` & pola hybrid PIC (lihat
  di bawah) — bukan tebakan, dibaca langsung dari source.
- **`ga_asset_categories`**: kode, nama, `depreciation_years`, ikon
  (kosmetik), `is_shared` (kategori boleh multi-PIC aktif sekaligus, mis.
  ATK/perkakas bersama — tambahan wrg-os, dipakai F133).
- **`ga_assets`**: `asset_code` auto-gen `AST-YYYY-NNNN` (basis TAHUN INPUT,
  bukan tanggal beli — formula eksak dari source), brand/model/serial,
  purchase_date/price/current_value, warranty_expiry, lokasi, `condition`
  (baik/rusak/kurang_layak_pakai) **terpisah** dari `status` (lifecycle:
  active/in_maintenance/damaged/lost/disposed — ada di source, tidak
  disebut di brief tapi jelas dibutuhkan), `is_critical` (diserap dari
  rencana F52 — flag SLA tiket 2 jam), foto & dokumen (lihat upload).
- **Pola hybrid PIC** (diadopsi persis dari source): `current_pic_user_id`
  (FK `app_user.id`) DAN `pic_name_override` (teks bebas) SEKALIGUS —
  kalau override diisi, itu yang ditampilkan. Solusi utk staf yang belum
  punya akun `app_user`. Endpoint PATCH aset cuma boleh ubah
  `pic_name_override` (koreksi cepat, TANPA histori) — assign resmi via
  `current_pic_user_id` + histori jadi tugas F133 (branch di atas ini).
- **Upload foto/dokumen sungguhan** — `POST /ga-assets/:id/upload`
  (multipart, field `kind` foto|dokumen + `file`, validasi tipe
  jpg/png/webp/pdf + maks 10MB). Disimpan di `GA_UPLOAD_ROOT`
  (`~/.wrg-os/uploads/ga-assets`, default — **beda root** dari `MEDIA_ROOT`
  openclaw yang dipakai foto kunjungan WA, beda sumber & siklus hidup).
  Serve balik lewat endpoint `/media?p=` yang sudah ada (root-list
  diperluas).
- **1 halaman, 2 tab** (Aset, Kategori) — `/ga-aset`, CRUD via web (bukan
  seed, populasi dinamis sama pola F52).

## Keputusan desain

- **Migrasi data dari `gais` TIDAK dilakukan** — dikonfirmasi user: repo
  `gais` cuma pernah jadi prototipe/demo, tidak pernah ada data asli WRG
  yang masuk ke sana. `ga_assets` mulai KOSONG (sama resolusi F53).
- **Hashtag `#ASET #GA` (WA inbound) SKIP** — dikonfirmasi Direktur, tidak
  dikerjakan sekarang. Kalau diaktifkan nanti, jadi fitur terpisah.
- **`department`** disimpan TEXT bebas, bukan FK — wrg-os tidak punya tabel
  "department" generik lintas-domain (yang ada khusus Employee Spine HR).

## Bug ketemu & diperbaiki (bukan cuma F132 — shared component/util)

1. **`/media` path-check gagal total di Windows** — cek "di luar root"
   pakai `abs.startsWith(root + "/")`, tapi path Windows pakai backslash →
   SEMUA file (termasuk foto kunjungan WA yang sudah lama ada) selalu 403
   di dev Windows. Diganti `path.relative()` (benar lintas-platform).
2. **`DialogBody` (shared UI) motong footer di dialog panjang** — kurang
   `flex-1 min-h-0`, jadi `overflow-hidden` milik `DialogContent`
   (`max-h-90vh`) yang menang & memotong tombol Simpan/Batal alih-alih body
   yang scroll. Berpotensi kena dialog manapun yang kontennya panjang.
3. **`SelectValue` (Base UI) tampilkan raw value** (UUID kategori,
   snake_case kondisi/status) sampai diklik ulang — butuh render-fn
   eksplisit (pola sama `npk-period-picker.tsx`).

## ⚠️ BUTUH MIGRASI DB

`infra/postgres/init/086_ga_asset_master.sql` — `ga_asset_categories` +
`ga_assets` (tabel baru, tidak ada ALTER ke tabel existing).

## Pengujian

- CRUD kategori & aset end-to-end via curl (create/update/list/filter).
- Auto-gen `asset_code`: 2 aset tahun sama → `AST-2026-0001`/`0002`.
- Filter `unassigned=true` exclude aset yang sudah punya `pic_name_override`.
- Upload foto+dokumen: upload → serve via `/media?p=` → 200, byte identik;
  path traversal ke luar root tetap 403.
- Web: halaman `/ga-aset` render 200 (SSR), kolom "Berkas" muncul kalau ada
  foto/dokumen, dialog Tambah/Edit tidak lagi motong footer.
- Typecheck + lint + build bersih di setiap commit.
