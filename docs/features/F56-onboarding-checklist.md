# F56 — Onboarding Checklist Karyawan Baru (HR)

Checklist per jabatan untuk karyawan baru: **akses sistem, training, NDA, alat, grup WA**. HRD/HoD
mencentang butir; butir yang lewat tenggat ditandai terlambat.

- **Domain**: HR · FR-ES-56 · R0 · SHOULD · Sprint Y2 (`DRAFT-Y2`) · owner HRD + HoD penerima
- **Menu**: `/onboarding` ("Onboarding Karyawan", bagian HR). Kunci izin `onboarding`.
- **Migrasi**: `213_onboarding_checklist.sql` (3 tabel + 6 butir template awal). **⚠️ BUTUH MIGRASI DB** (Direktur menerapkan ke prod).
  Nomor 213 karena 212 dipakai F58 (PR #1664) — jika F58 batal merge, nomor ini tetap aman.
- **Setelah deploy**: klik **Sync Fitur** sekali agar `onboarding` muncul di matriks Akses Grup (tertutup default).

Kartu board hanya satu kalimat ("checklist … per role; 18 staff phantom di members.md"), jadi detail di bawah
adalah keputusan teknis — **bisa diubah**, tidak ada yang dikonfirmasi Direktur.

## Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| 1 | Isi checklist = **data** (`onboarding_template`), bukan kode. Dibatasi opsional per `dept` dan pola jabatan (cocok sebagian, abaikan huruf besar/kecil) | "per role" tanpa daftar butir; HRD bisa menyusun sendiri tanpa deploy |
| 2 | Karyawan = tabel `employee` (052), bukan `master_user`/`app_user`. `roster_pending=true` ditampilkan dulu di pilihan | "18 staff phantom" = roster_pending; onboarding bisa mulai sebelum punya akun |
| 3 | Case dimulai **manual** oleh HRD, tanpa auto-trigger saat akun dibuat | tak ada sinyal "karyawan baru" yang andal di data |
| 4 | Butir di-**snapshot** ke `onboarding_item` saat mulai | mengubah template tak menggeser onboarding berjalan |
| 5 | Satu onboarding **berjalan** per karyawan (indeks unik parsial) | cegah ganda |
| 6 | Status butir `belum/selesai/dilewati`; dilewati **wajib alasan** | tak ada butir yang diam-diam hilang |
| 7 | Case `selesai` otomatis saat tak ada butir `belum`; membuka lagi butir → `berjalan` | tanpa langkah "tutup" manual |
| 8 | Tenggat butir = tanggal mulai + `due_days` template; terlambat = `belum` & tenggat < hari ini (WIB) | |
| 9 | Audiens: admin/superuser/Direktur semua; HoD cabang timnya (`cabangScope`); lainnya 403. HoD tanpa territory **ditolak** | selaras F58 |
| 10 | Template hanya dapat diubah admin/superuser/Direktur (api 403 selain itu) | HoD tidak menyusun standar |
| 11 | **Tanpa notifikasi WA & scheduler** | target broadcast harus ditentukan user (CLAUDE.md); bisa jadi fase 2 |
| 12 | `audienceOf` ditulis lokal di `repo/onboarding.ts` | versi F58 belum ada di `dev`; satukan setelah F58 merge |

## API (apps/api)

| Endpoint | Fungsi |
|---|---|
| `GET /onboarding[?status=]` | daftar onboarding + progres |
| `GET /onboarding/candidates` | karyawan tanpa onboarding berjalan |
| `POST /onboarding` | mulai `{employee_id, tanggal_mulai?, catatan?}` → butir template yang cocok disalin (transaksi) |
| `GET /onboarding/:id` | detail + butir |
| `PATCH /onboarding/items/:id` | `{status, catatan?}` |
| `POST /onboarding/:id/cancel` | batalkan (final) |
| `GET/POST /onboarding/templates`, `PATCH /onboarding/templates/:id` | kelola template (admin/Direktur) |

Kode: 200/201 · 400 `{error,field}` · 403 · 404 · 409 (sudah berjalan / dibatalkan) · 422 (tak ada template cocok) ·
503 `migration_pending`. Pelaku (`oleh`) dari sesi di BFF, bukan body.

## Edge case yang ditangani

Karyawan tak ada / di luar cabang HoD (404) · onboarding ganda, termasuk balapan dua klik (409 via indeks unik) ·
tak ada template aktif yang cocok (422) · dilewati tanpa alasan (400) · ubah butir pada case dibatalkan (409) ·
buka lagi case selesai saat ada case berjalan lain (409) · batalkan dua kali (409) · tanggal tak valid (400) ·
`due_days` di luar 0–365 / bukan bilangan bulat (400) · dept template tak dikenal (400) · id non-numerik (400).

## Batasan

- Butir tak bisa ditambah ad-hoc ke satu case (ubah template lalu mulai ulang, atau pakai "dilewati").
- Tidak ada link otomatis ke pembuatan akun/Aset GA/grup WA — HRD mencentang manual.
- Karyawan yang dibatalkan boleh dimulai lagi (case baru).

## Berkas

`infra/postgres/init/213_onboarding_checklist.sql` · `apps/api/src/repo/onboarding.ts` (+ `.test.ts`) ·
`apps/api/src/index.ts` (route) · `apps/web/src/lib/onboarding-access.ts` (+ tes) · `apps/web/src/lib/nav.ts` ·
`apps/web/src/app/api/onboarding/**` · `apps/web/src/components/onboarding/*` · `apps/web/src/app/(dashboard)/onboarding/page.tsx`
