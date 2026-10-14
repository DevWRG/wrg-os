# F7 — KSO Lifecycle: kontrol suplai reagen + kebutuhan vs stok

Tab **Suplai Reagen** di Produktivitas KSO (`/kso-produktivitas?tab=suplai`). Melengkapi siklus KSO yang
sudah ada — kontrak (F47), penempatan alat (F169), kesehatan (F73) — dengan sisi **suplai**: apakah reagen
untuk alat yang terpasang terus mengalir, dan apakah stok cukup untuk kebutuhan berikutnya.

- **Domain**: CRM · FR-SB2-07 · issue #1740
- **Izin**: menumpang `kso-simulator` (sama dengan tab Kesehatan / Produktivitas KSO) — tanpa menu baru.
- **Migrasi**: tidak ada. Semua dihitung dari tabel/view yang sudah ada.

## Keputusan user (15 Okt 2026)

| # | Keputusan |
|---|---|
| 1 | Cakupan = kontrol order per faskes **dan** kebutuhan reagen vs stok |
| 2 | Rata-rata kebutuhan memakai **filter periode** yang bisa diubah (1/2/3/4/6 bulan, default 3) |
| 3 | Tampil sebagai tab di Produktivitas KSO, ber-scope |
| 4 | Rekap WhatsApp mingguan, **saklar default mati** |

## Keputusan teknis

| # | Keputusan | Alasan |
|---|---|---|
| 1 | Sumber = **Delivery Order (Surat Jalan) Accurate**, bukan faktur | Faskes PER_TEST ditagih per tes; reagennya dikirim WRG → hanya terlihat di DO. DO juga mencatat BELI_REAGEN → satu sumber untuk dua skema. Prod 15 Okt: 73/77 faskes PER_TEST & 120/150 BELI_REAGEN punya DO reagen 6 bln terakhir |
| 2 | Cermin DO baru ada sejak **8 Apr 2026** → jendela dipotong ke situ, ditandai di UI | rata-rata tak boleh dibagi bulan yang belum ada datanya |
| 3 | Jenis reagen = `kso_item_jenis_v` (tanpa UMUM/MANUAL); label gabungan `kso_jenis_gabungan` dipecah ke anggotanya; jenis alat = `kso_jenis_kanonik(type_alat)` | peta yang sama dipakai seluruh view KSO |
| 4 | Kiriman ≤7 hari dari kiriman sebelumnya = satu **gelombang** | satu pesanan sering dikirim bertahap; tanpa ini ritme median jadi 1–2 hari |
| 5 | Ritme = median jeda antar-gelombang **di jendela** (ikut filter periode); kiriman terakhir = seluruh data | |
| 6 | TELAT bila lewat > maks(1,5×ritme, ritme+14); ≤1 gelombang → 60 hari | ritme pendek tak langsung telat karena selisih beberapa hari |
| 7 | Kebutuhan/bln dari **semua customer**, kebutuhan KSO ditampilkan berdampingan | stok gudang melayani semua; item kritis rata-rata 4× kebutuhan KSO-nya |
| 8 | KRITIS < 1 bln stok · PERLU_PO stok + PO jalan < 2 bln · **STOK_0** dipisah | stok 0 padahal rutin dikirim (mis. consumable HD WEGO) = stok tak tercatat, bukan kekurangan |
| 9 | PO jalan = PO Accurate *Menunggu/Sebagian diproses* **≤120 hari** | PO Mei 2025 85.000 BOX masih "sebagian" dan menutupi kekurangan palsu |
| 10 | Satuan DO = satuan dasar item (6.845/6.845 baris) dan PO = satuan item → tanpa konversi | dicek di prod |
| 11 | Bagian order ber-scope (AM/HoD/admin, sama F73); bagian item = agregat perusahaan tanpa nama faskes | |
| 12 | Rekap tanpa snapshot: "baru telat" = tanggal jadi-telat jatuh di 7 hari terakhir | tak perlu tabel baru |
| 13 | Penerima rekap stok = `KSO_SUPLAI_PO_HOD` (hod_key, mis. HoD Finance & SC); kosong = dilewati | daftar HoD tak boleh ditulis di kode |

Angka prod 15 Okt (jendela Jul–Sep): 422 faskes×jenis dari 195 faskes → 242 rutin · 81 telat · 99 tanpa kiriman;
185 item → 31 kritis · 25 perlu PO · 38 stok 0 · 91 aman. Rekap dry-run: 8 baru telat (Rocky 5, Yogi 3).

## API

| Endpoint | Fungsi |
|---|---|
| `GET /kso/suplai?bulan=` | `{hari_ini, jendela, data_do, stok_per, aturan, ringkas, order[], item[]}` — order ber-scope x-user-id |
| `POST /kso/suplai/rekap[?dry=1]` | jalankan rekap manual (ops/uji) |

Scheduler: `kso-suplai-rekap` Senin 07:20 WIB (`KSO_SUPLAI_REKAP_ENABLED=true`, cron `KSO_SUPLAI_REKAP_CRON`).

## Batasan

- DO atas nama customer lain (yayasan, distributor, PT pihak ketiga) tidak terhitung untuk faskesnya → bisa tampil "Tanpa kiriman".
- Kebutuhan = pola kiriman masa lalu, bukan tes × konsumsi reagen (data tes BELI_REAGEN cuma sheet manual).
- Lead time vendor belum diperhitungkan — target cakupan tetap 2 bulan.

## Berkas

`apps/api/src/repo/kso-suplai.ts` (+ `.test.ts`) · `apps/api/src/index.ts` · `apps/api/src/scheduler.ts` ·
`apps/web/src/components/kso/suplai-view.tsx` · `produktivitas-tabs.tsx` · `app/(dashboard)/kso-produktivitas/page.tsx`
