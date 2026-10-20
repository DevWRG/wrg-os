# F171 — Permintaan Produk Non-Master (Komite Product Development)

Permintaan lapangan untuk produk **di luar master SKU** dicatat, dicek ke master, dikelompokkan, lalu
kandidatnya dibawa ke **review kuartal** Komite Product Development untuk diputus Direksi. Prinsipnya
dari deck "KSO Forum" Direktur (20 Okt 2026): fokus tetap 1.000 SKU, tapi tidak ada permintaan lapangan
yang hilang. Menggantikan `Log-Permintaan-Non-Master-SKU.xlsx`.

- **Domain**: Sales / Product Development · issue #1849
- **Menu**: `/permintaan-produk` (grup Sales) — tab **Log**, **Analisa**, **Review Kuartal**
- **Migrasi**: 244 (tabel `public.produk_permintaan*`; tidak menyentuh tabel OS lain)
- **Uji**: `apps/api/src/repo/permintaan-produk.test.ts`, `apps/web/src/lib/permintaan-produk-access.test.ts`

## Keputusan user (21 Okt 2026)

| Keputusan | Isi |
|---|---|
| Jalur masuk | **Form web** oleh Sekretaris PD (AM tetap share seperti biasa). Hashtag WA menyusul bila diperlukan |
| Potensi | **qty per bulan × harga × 12**, per faskes memakai permintaan **terbarunya** (faskes yang meminta berulang tidak dihitung berlipat) |
| Data awal | Mulai kosong, tanpa impor Excel |
| Nama orang | Tidak di kode — siapa yang mencatat/memutus diatur di Akses Grup |

## Alur

1. **Catat** (≤ `sla_hari_kerja`, default 1 hari kerja; Sabtu/Minggu & `master_holiday` dilewati): produk
   **persis seperti diminta** (tidak dinormalkan), merek, qty/bulan, satuan, harga per satuan, faskes, AM/pengaju,
   sumber. Faskes dicocokkan ke customer Accurate (`resolusiFaskes`, aturan sama dengan #CALL/#DEMO): satu
   cocok → tertaut; ambigu → pengguna memilih; tak ketemu → **calon pelanggan**, nama apa adanya.
2. **Cek master**: *Ada* / *Bisa substitusi* (keduanya wajib memilih SKU dari `product_code`) / *Belum ada*.
3. **Kelompokkan** — penulisan berbeda untuk produk yang sama digabung **manual** ke satu kelompok
   (nama unik, tak peka huruf). Mesin sengaja tidak menebak: salah gabung = kandidat palsu.
4. **Analisa** — per kelompok, jendela `kandidat_hari` (default 90 hari): permintaan, faskes unik, harga median,
   potensi/tahun. Baris *Ada di master* tidak dihitung. Potensi **NULL** (bukan 0) bila tak satu faskes pun
   punya qty & harga. **Kandidat** = faskes unik ≥ `kandidat_min_faskes` (3) **dan** potensi ≥
   `kandidat_min_potensi` (Rp 250 jt).
5. **Review kuartal** — Komite PD **mengusulkan** (masuk master / principal baru / tolak + alasan; angka saat itu
   dibekukan ke `snapshot`), Direksi **memutus** (final, satu kali per kelompok per kuartal).

Ambang & SLA = baris `produk_permintaan_param`, diubah dari layar (tombol **Ubah ambang**) oleh pemegang izin putusan.

## Izin (Akses Grup)

| Kunci | Aksi | Gate lama (sebelum diatur) |
|---|---|---|
| `permintaan-produk` | lihat = log & analisa · buat = catat · ubah = koreksi, cek master, kelompok, usulan Komite PD | role `direktur` (+ superuser/admin) |
| `permintaan-produk-putusan` | ubah = putusan Direksi & ambang | role `direktur`; **role admin tidak otomatis**, superuser lolos |

Gerbang ada di BFF (`app/api/permintaan-produk/_gerbang.ts`, `requireFeature` + sub-fitur); `oleh` selalu dari sesi.

## Belum termasuk

- Hashtag WA dari AM (mis. `#MINTA`) — menunggu kebutuhan nyata.
- Tautan otomatis "masuk master" → pembuatan kode di Klasifikasi Produk (tetap lewat menu Klasifikasi).
