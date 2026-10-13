# F58 — AI Champion / Training Adoption Tracker (HR)

Statistik pemakaian fitur per user → mana yang **champion**, mana yang **laggard** → daftar
**perlu training**. Hanya untuk adopsi & training; **bukan** KPI/NPK/Raport (keputusan Direktur).

- **Domain**: HR · FR-ES-58 · R1 · SHOULD · Sprint B3 · owner Husni Co-Builder + semua HoD
- **Menu**: `/adoption` ("Adopsi Fitur", bagian HR). Kunci izin `adoption`.
- **Migrasi**: `212_feature_usage_event.sql` — satu tabel baru. **⚠️ BUTUH MIGRASI DB** (Direktur menerapkan ke prod).
- **Setelah deploy**: klik **Sync Fitur** sekali agar `adoption` muncul di matriks Akses Grup, lalu centang
  untuk HoD yang boleh melihat (tertutup default).

## Keputusan Direktur (2026-10-13)

| # | Keputusan | Implementasi |
|---|---|---|
| 1 | Adopsi & training saja, bukan KPI | Tak disambung ke Raport/NPK |
| 2 | `view` dan `action` dicatat terpisah; dinilai dari **action** | kolom `kind`; label hanya dari `actions` |
| 3 | Per bulan + 30 hari terakhir; dibanding sesama jabatan yang berizin; laggard = berizin tapi nol/sangat jarang | peer = `app_user.title` per fitur |
| 4 | Hanya user berizin menurut matriks Akses Grup | lihat "Siapa dihitung" |
| 5 | Admin/superuser + Direktur semua; HoD timnya; tertutup default | `audienceOf()` + `canViewAdoption()` |
| 6 | Fase 1: daftar "perlu training" saja | tanpa WA/notifikasi, tanpa status "sudah training" |
| 7 | Mulai dari nol | tanpa backfill |

## Keputusan teknis (di luar jawaban Direktur — bisa diubah)

| Hal | Nilai | Lokasi |
|---|---|---|
| Laggard | aksi ≤ **2** per periode | `LAGGARD_MAX_ACTIONS` |
| Champion | aksi > ambang laggard, ≥ persentil-75 peer (≈ ¼ teratas), peer ≥ **3**, peer tidak seragam | `CHAMPION_PERCENTILE`, `MIN_PEERS` |
| Akun baru | < **14** hari = "Baru", tak dicap laggard & tak ikut statistik peer | `GRACE_DAYS` (dari `app_user.created_at`; tanggal pemberian izin tidak tersimpan di matriks) |
| Data minim | pencatatan < **7** hari → belum ada laggard | `MIN_TRACKING_DAYS` |
| Throttle view | 1 event per (user, fitur) per **30** menit (di SQL) | `VIEW_THROTTLE_MINUTES` |
| Batas daftar | default 200, maks 500 | `LIST_LIMIT_*` |

Semua di `apps/api/src/repo/adoption.ts`.

## Siapa dihitung (laggard hanya bila berhak)

User × fitur dihitung bila: akun aktif, **bukan** anggota grup superuser, dan di salah satu grupnya ada izin
`active` + `can_view` + (`can_create` atau `can_edit` atau `can_delete`). Izin **lihat saja** tidak dihitung —
fitur tanpa jalur tulis tak mungkin punya "action", jadi semua penggunanya akan keliru jadi laggard.
Gate identitas lama (fitur tanpa baris izin di matriks) **tidak** dihitung, sesuai "menurut matriks Akses Grup".
Fitur `adoption` sendiri tidak dinilai.

## Alur pencatatan

| Jenis | Titik | Aturan |
|---|---|---|
| action | `gatewayFetch` (`apps/web/src/lib/gateway.ts`) — semua route BFF lewat sini | hanya POST/PUT/PATCH/DELETE yang **2xx**; fitur dari path `x-pathname` → katalog NAV (`adoption-capture.ts`); path tak terpetakan **tidak ditebak**; `/api/auth`, `/api/health`, `/api/admin`, `/api/adoption` dikecualikan |
| view | `<UsageBeacon/>` di layout → `POST /api/adoption/view` | fitur ditentukan server; hanya bila user berhak membuka halaman |

Identitas selalu dari cookie sesi yang **tanda tangannya diverifikasi** (`sessionTokenSub`), tak pernah dari body.
`POST /adoption/event` di apps/api hanya menerima service token + `x-user-id` dan tidak dibuka ke browser.
Kegagalan pencatatan ditelan (tak pernah mengganggu request user). Yang disimpan hanya (user, fitur, jenis, waktu).

## API (apps/api)

| Endpoint | Fungsi |
|---|---|
| `POST /adoption/event` | catat event (internal) |
| `GET /adoption/summary?period=month\|rolling30&month=YYYY-MM[&feature=&title=&q=]` | agregat per fitur (+ `rows` bila `feature` diisi) |
| `GET /adoption/training-needs?…&limit=` | daftar laggard, aksi terendah dulu |

Kode: 200 · 400 `{error,field}` · 403 · 503 `{error:"migration_pending"}` (migrasi 212 belum diterapkan) ·
`empty:true` bila belum ada event sama sekali. Batas bulan/30 hari dihitung **WIB**.

## Batasan yang diketahui

- Event ganda karena retry/double-submit tidak di-dedup (tak mengubah klasifikasi).
- Pemetaan action memakai katalog NAV: rute yang tak punya menu sendiri tidak dihitung.
- Masa tenggang memakai `created_at` akun, bukan tanggal izin diberikan.
- User yang sedang cuti tetap tampil di daftar training dengan lencana "Cuti" (HR yang menilai).
- Awal pencatatan: angka periode berjalan bisa rendah ("data baru" ditandai di UI).

## Berkas

`infra/postgres/init/212_feature_usage_event.sql` · `apps/api/src/repo/adoption.ts` (+ `.test.ts`) ·
`apps/api/src/index.ts` (route) · `apps/web/src/lib/adoption-{access,capture,record}.ts` (+ tes) ·
`apps/web/src/lib/gateway.ts` · `apps/web/src/lib/session-token.ts` · `apps/web/src/app/api/adoption/**` ·
`apps/web/src/components/adoption/*` · `apps/web/src/app/(dashboard)/adoption/page.tsx` · `nav.ts` · `(dashboard)/layout.tsx`
