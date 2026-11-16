# F176 — Riwayat Alat (Aftersales)

Keputusan user 17 Nov 2026: teknisi butuh menu riwayat maintenance/PM **per alat**, di faskes mana pun alat itu
dipasang. Menu baru di grup Aftersales; teknisi melihat **semua** alat; riwayat lama Google Form diimpor.

## Identitas alat
Kunci = SN dinormalisasi `alat_sn_key()` (migrasi 328) — aturan sama dengan `kso_asset.sn_key` (097) dan
`normSn()`: trim → buang kutip pembuka → buang ekor `.0` → upper → buang spasi → buang leading zero.
Tiap kejadian menyimpan faskes **saat kejadian itu**, jadi riwayat di faskes lama tetap terbaca setelah alat pindah.

## Sumber (view `alat_riwayat_v`)
| sumber | asal | catatan |
|---|---|---|
| `wa` | #REPORT teknisi F175 (`teknisi_kunjungan_alat`) | jenis, status, kegiatan, jumlah tes, sparepart |
| `form` | Google Form "Kegiatan Teknisi" → `alat_riwayat_form` | impor `scripts/db/import_kegiatan_teknisi.py` |
| `jadwal` | `jadwal_rutin` selesai tanpa #REPORT F175 | SN dari snapshot `alat` |
| `pm` | PM & Kalibrasi alat beli | modul hanya menyimpan penyelesaian **terakhir** |
| `install` | `install_schedule` done tanpa #REPORT F175 | |
| `servis` | `teknisi_report` lama (#install/#servis teks bebas) | per unit beli |

Penempatan alat KSO dari `kso_penempatan_v` (F169).

## Impor Google Form
Spreadsheet "Kegiatan Teknisi" (milik support@), sheet **"Form Responses 1"** (sheet lain = rekap/potongan).
Konektor Drive menolak ekspor (berkas terlalu besar) → unduh manual: sheet "Form Responses 1" → File → Download → CSV
(atau .xlsx utuh). Lalu:

    python3 scripts/db/import_kegiatan_teknisi.py --file <berkas> --db <db>            # dry-run
    python3 scripts/db/import_kegiatan_teknisi.py --file <berkas> --db <db> --apply

Idempoten (`baris_key` = md5 waktu|SN|teknisi|jenis) — impor ulang ekspor lebih baru hanya menambah baris baru.
Waktu form = WIB, disimpan dengan `+07` eksplisit. **Tidak diimpor**: foto (path internal AppSheet), email
pengirim, nama analis, kolom rumus. Data asli tidak di-commit.

## Akses
Kunci RBAC `riwayat-alat` (default tertutup; fallback direktur/admin/superuser). Pemegang menu melihat semua alat.
BFF `/api/riwayat-alat` & `/api/riwayat-alat/[kunci]` (`requireFeature`), API `/riwayat-alat/alat[/:kunci]`.
