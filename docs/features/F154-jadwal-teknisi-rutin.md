# F154 — Jadwal Kunjungan Rutin Teknisi (auto-generate, terbit sebelum tgl 1)

Menu **Jadwal Teknisi** (grup Operations) + WA `#JADWAL`. Issue #1803. Migrasi **235** (4 tabel).

## Keputusan user (18 Okt 2026)

Mandiri di data prod (modul Aftersales instalasi/PM/kapasitas masih dev-only) · frekuensi per skema, bisa diubah per
faskes · wilayah per teknisi · draft tgl 20 → review HoD Aftersales → terbit (WA ke teknisi, saklar mati).

## Data & aturan

- **Populasi** = faskes dengan alat KSO operasional (`kso_asset` + `kso_asset_status_v`; mengikuti penempatan F169).
  Prod 18 Okt: 195 faskes, 15 wilayah. `kso_asset.ritme_kunjungan` TIDAK dipakai (532/600 kosong, sisanya angka harga).
- **Wilayah** = `upper(area_customer(account_id))`, cadangan `kso_asset.kota`. Satu teknisi per wilayah (`teknisi_wilayah`).
- **Teknisi** = `master_user` role Teknisi (5, semua Pusat, **tanpa akun dashboard**) → jadwal sampai lewat WA.
- **Frekuensi** default: ada alat PER_TEST → tiap 2 bulan, selain itu 3 bulan; override per faskes (`jadwal_rutin_frekuensi`).
- **Jatuh tempo**: bulan sejak kunjungan rutin terakhir (baris non-batal) ≥ interval. Tanpa riwayat → disebar merata
  ((indeks bulan + hash account_id) mod interval = 0) supaya semua faskes tak jatuh di bulan pertama.
- **Penyusunan**: per teknisi, wilayah terbanyak dulu; satu wilayah = satu trip (wilayah baru = hari baru); maks 3 faskes/hari
  (`JADWAL_RUTIN_PER_HARI`); hari kerja = Sen–Jum minus `master_holiday` (prod baru berisi 2026 — UI memperingatkan).
  Kelebihan hari kerja ditaruh di hari terakhir + catatan "bagi ulang".
- **Susun ulang** menghapus & menghitung ulang baris `auto` berstatus `rencana` saja; baris yang diubah manual / selesai / batal
  dipertahankan. Bulan yang sudah **terbit** tak bisa disusun ulang (edit per baris).
- **Terbit** ditolak selama masih ada kunjungan tanpa teknisi. WA per teknisi hanya bila `JADWAL_RUTIN_WA_ENABLED=true`.
- **#JADWAL**: teknisi → jadwalnya sendiri (bulan ini dari hari ini; bulan depan bila terbit); HoD/admin → `#JADWAL nama`.
  Hanya jadwal TERBIT yang dibagikan.

## Akses

Izin `jadwal-teknisi` (tertutup default, Sync Fitur). Sebelum matriks diatur: admin/superuser, Direktur, HoD Aftersales
(hod_key `muhid`) atau jabatan memuat "aftersales". Tulis = izin edit. BFF `/api/jadwal-teknisi/*` (requireFeature,
`oleh` dari sesi, id/bulan divalidasi).

## Scheduler

`jadwal-rutin-draft` tgl 20 07:00 WIB (`JADWAL_RUTIN_DRAFT_ENABLED`, default mati; `JADWAL_RUTIN_DRAFT_CRON`) — susun draft
bulan depan hanya bila belum ada barisnya.

## Uji (DB dev, 18 Okt)

Nov 2026: 85/189 faskes jatuh tempo; susun ulang identik (idempoten); terbit ditolak saat ada baris tanpa teknisi;
#JADWAL dari AM ditolak. Tes unit: penyusun 5/5, akses 1/1.

## Batasan / lanjutan

- Belum ada tombol "tambah kunjungan manual" di UI (API `POST /jadwal-teknisi/baris` sudah ada).
- Realisasi ditandai manual (status Selesai) — belum dari laporan teknisi (teknisi belum melapor ke WRG-OS).
- Saat modul Aftersales dev dipromosikan: sambungkan ke kapasitas teknisi & PM/kalibrasi (F24) supaya beban tak bentrok.

## Berkas

`infra/postgres/init/235_jadwal_teknisi_rutin.sql` · `apps/api/src/repo/jadwal-teknisi.ts` (+ test) · `apps/api/src/index.ts` ·
`apps/api/src/scheduler.ts` · `apps/api/src/repo/inbound.ts` (#JADWAL) · `apps/web/src/lib/jadwal-teknisi-access.ts` (+ test) ·
`apps/web/src/lib/nav.ts` · `apps/web/src/app/api/jadwal-teknisi/**` · `apps/web/src/app/(dashboard)/jadwal-teknisi/page.tsx` ·
`apps/web/src/components/jadwal-teknisi/jadwal-view.tsx`
