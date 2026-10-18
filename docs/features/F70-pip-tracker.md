# F70 — Improvement Journey & PIP 90-Day Tracker (HR)

Melihat **improvement tiap karyawan** (perubahan skor Raport 360 antar periode) dan, bila karyawan menjalani PIP,
melacak **perjalanan 90 hari**: improvement goal, milestone, check-in mingguan, outcome, jejak audit.

- **Domain**: HR · FR-ACE-70 · R2 · MUST · kartu board `DraftIssue` (tanpa nomor issue → PR pakai `No-Card:`).
- **Tempat**: tab **Improvement & PIP** di `/karyawan` (Raport Karyawan 360) + panel di drilldown `/karyawan/[amId]`.
  Bukan menu baru → **tanpa Sync Fitur**.
- **Izin**: fitur `karyawan` yang sudah ada (`canViewRaportList`, matriks Akses Grup). Lihat = `view`, tambah data = `create`,
  putuskan/ubah = `edit` (dibatasi hanya bila matriks punya baris `karyawan`; selaras `featureAllowed`). **Tidak ada aturan akses baru.**
  Scope baris di apps/api = `resolveScope` seperti `/raport/*`: AM murni hanya datanya sendiri; AM murni & peran `viewer` tidak boleh menulis.
- **Migrasi**: `236_pip_tracker.sql` (4 tabel). **⚠️ BUTUH MIGRASI DB** (Direktur menerapkan ke prod).
- **Tanpa**: WA/hashtag, scheduler, notifikasi, jenjang persetujuan, ambang skor, auto-trigger PIP.

## Sumber arahan Direktur
Fokus = melihat improvement; data ter-match ke employee yang sama dengan Raport 360 & profil; PIP = workflow dalam fitur yang sama;
hashtag/WA diabaikan; jangan menetapkan ambang, hierarki approval, batas extension, atau aturan akses sendiri.

## Keputusan teknis (bukan dari Direktur — bisa diubah)
| # | Keputusan | Alasan |
|---|---|---|
| 1 | Kunci relasi = `employee` (052). PIP dimulai lewat `am_id`; tautan **hanya** `employee.am_id` eksplisit (tanpa fallback nama seperti di `getRaportDetail`). Tak tertaut → 422 | salah orang di dokumen PIP jauh lebih mahal daripada "belum tertaut" |
| 2 | "Resume/profil" = baris `employee` + departemen (data existing); tidak ada struktur resume baru | arahan Direktur |
| 3 | Improvement = skor komposit `getRaportList` per periode; Δ = selisih dengan periode sebelumnya; null bila salah satu kosong. Default 4 kuartal terakhir; `?periods=` (maks 8, urut lama→baru) | tanpa ambang/label |
| 4 | PIP **manual**; skor tidak memicu apa pun; tidak ada data Rocky yang di-seed | arahan |
| 5 | Durasi 90 hari = konstanta `PIP_DURATION_DAYS` (dari requirement). `end_date = start + 90` | |
| 6 | Outcome: `graduate`/`terminate` menutup case (catatan wajib); `extend` = `end_date` baru **yang diisi pengguna** (> end_date sekarang), case tetap aktif, boleh berulang, tanpa batas | jumlah/durasi belum ditentukan |
| 7 | Minimal 1 improvement goal saat memulai; milestone opsional; goal/milestone/check-in bisa ditambah selama aktif | |
| 8 | Milestone = penanda yang diputuskan manusia (`tercapai`/`tidak_tercapai`/`belum`); **tidak** memblokir outcome | "gate" tak didefinisikan; tidak menambah aturan |
| 9 | Check-in: tanggal ≥ mulai dan ≤ hari ini (WIB); `week_no` dihitung server; hanya bisa ditambah (tanpa edit/hapus) | bukti audit |
| 10 | Satu PIP **aktif** per karyawan (indeks unik parsial → 409, termasuk balapan) | cegah ganda |
| 11 | Case ditutup = read-only (409 untuk semua mutasi) | audit-grade |
| 12 | Jejak audit ke `audit_log` (`use_case_id='F70'`, `correlation_id='f70-case-<id>'`, `agent_id='A3'` dipinjam seperti F60), satu transaksi dengan data. `human_actor` dari sesi | reuse mekanisme audit existing |
| 13 | `employee_id` FK `ON DELETE RESTRICT`: dokumen tak hilang karena karyawan dihapus | compliance |

## API (apps/api) — semua lewat BFF `/api/pip/*` (whitelist rute)
| Endpoint | Fungsi |
|---|---|
| `GET /improvement[?periods=]` | semua karyawan: deret skor + Δ + PIP aktif (AM murni → 403) |
| `GET /improvement/:amId` | satu karyawan: profil employee + deret skor + semua PIP-nya |
| `GET /pip/cases[?status=]` · `GET /pip/cases/:id` | daftar · detail (goal, milestone, check-in, jejak audit) |
| `POST /pip/cases` | mulai `{am_id, alasan, start_date?, goals:[{goal,target?}], milestones?:[{judul,due_date}]}` (transaksi) |
| `POST /pip/cases/:id/goals\|milestones\|checkins` | tambah |
| `PATCH /pip/milestones/:id` | `{status, catatan?}` (tidak_tercapai wajib alasan) |
| `POST /pip/cases/:id/outcome` | `{outcome, catatan, end_date?}` |

Kode: 200/201 · 400 `{error,field}` · 403 · 404 · 409 · 422 · 503 `migration_pending`. Pelaku `oleh` dari sesi di BFF (body `oleh` ditimpa).

## Edge case yang ditangani
am_id tak tertaut ke employee (422) · PIP aktif ganda & balapan (409) · tanpa goal (400) · tanggal tak valid / check-in masa depan / sebelum mulai (400) ·
milestone sebelum mulai (400) · tidak_tercapai tanpa alasan (400) · extend tanpa/dengan `end_date` ≤ sekarang (400) · outcome tanpa catatan (400) ·
mutasi pada PIP tertutup (409) · AM murni menulis / melihat orang lain (403) · tanpa identitas sesi (403) · id non-numerik (400) ·
periode tak sah / >8 (400) · body bukan JSON object (400) · tabel belum ada (503) · skor periode kosong (Δ `null`, bukan 0).

## Batasan / belum
- Karyawan tanpa `employee.am_id` tidak bisa dimulai PIP-nya sampai ditautkan di Kelola Profil.
- Menutup PIP (terminate) **tidak** menonaktifkan akun/roster — di luar scope.
- UI tidak menyembunyikan tombol tulis berdasar izin (server yang menolak dengan pesan); belum ada edit/hapus check-in/goal.
- Skor Raport dihitung on-the-fly per periode (sama dengan halaman Raport); 4 periode = 4× hitung daftar.
- Belum diuji dengan data prod; tidak ada baris PIP yang di-seed (Rocky tampil sebagai PIP aktif hanya bila PIP-nya dibuat lewat fitur ini).

## Berkas
`infra/postgres/init/236_pip_tracker.sql` · `apps/api/src/repo/pip.ts` (+ `.test.ts`) · `apps/api/src/index.ts` (route) ·
`apps/web/src/app/api/pip/[...path]/route.ts` · `apps/web/src/components/karyawan/{improvement-tab,pip-panel,pip-format}.ts(x)` (+ `pip-format.test.ts`) ·
`karyawan-360.tsx` (tab) · `app/(dashboard)/karyawan/[amId]/page.tsx` (panel).
