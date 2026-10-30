# F173 — Pameran: Registrasi Pengunjung & Kupon Undian

Di booth pameran/exhibition, dokter/visitor mengisi **nama, asal institusi, dan no. HP** dari HP-nya
sendiri lewat **QR** → langsung mendapat **kode kupon undian doorprize** di layar. Datanya tercatat di
WRG-OS: daftar, export, kocok pemenang, dan "jadikan deal" untuk prospek yang serius.
Kebutuhan awal divisi **Medical & Hemodialisa**; divisi **IVD** bisa memakai menu yang sama.

- **Domain**: Sales / Marketing · issue #1894
- **Menu**: `/pameran` (grup Sales) — pilih pameran → kartu acara + QR, tab **Pengunjung**, **Undian**
- **Form publik**: `/daftar/<slug>` (tanpa login) → BFF `/api/publik/pameran/<slug>[/daftar]`
- **Migrasi**: 259 (`pameran`, `pameran_pengunjung`, `pameran_undian`), 260 (`wilayah_kab_kota` + `pameran_pengunjung.kab_kota_kode`)
- **Uji**: `apps/api/src/repo/pameran.test.ts`, `apps/web/src/components/pameran/pilih-kab-kota.test.ts`

## Keputusan user (30 Okt 2026)

| Keputusan | Isi |
|---|---|
| Pengisi form | Pengunjung sendiri, dari HP, lewat **QR di booth** (halaman publik) |
| Kupon | **Nomor undian doorprize** — ada fitur kocok pemenang |
| Tindak lanjut data | Simpan + daftar + export; **jadikan deal manual** (tidak otomatis ke pipeline) |
| Kirim WA | **Tidak** — kupon cukup tampil di layar (hindari nomor WA bisnis diblokir) |

## Aturan

- **Isian form**: nama, asal institusi, **kota/kabupaten asal** (wajib, dropdown cari — 514 kab/kota
  Kepmendagri 300.2.2-2138/2025, migrasi 260; ketik "malang" / "kab malang" / "surabaya"), no. HP
  (angka saja). Pengunjung lama sebelum 260 tak punya kota (`kab_kota_kode` NULL).

- **1 no. HP = 1 kupon per pameran.** No. HP dinormalkan ke `628…` (0812…, +62 812…, 812… dianggap sama).
  Daftar ulang dengan nomor yang sama mengembalikan kupon lama ("nomor Anda sudah terdaftar").
- **Kode kupon** = awalan acara + 5 karakter acak tanpa huruf rancu (tanpa 0/O/1/I/L), mis. `MHD-7K3QX`.
  Awalan default `MHD` (Medical & HD) / `IVD`, bisa diubah per acara.
- **Form menerima pendaftaran** bila saklar *buka* menyala **dan** hari ini (WIB) di rentang tanggal pameran
  ±1 hari. Di luar itu form menampilkan "pendaftaran tidak dibuka".
- **Undian**: staf mengisi nama hadiah + jumlah → server mengocok (crypto random) dari pengunjung yang
  **belum pernah menang**. Kocok serentak dikunci per pameran (advisory lock) — tak ada pemenang ganda.
  Pemenang yang tak hadir ditandai **hangus** (tetap tercatat, tak ikut dikocok lagi), lalu kocok ulang.
- **Jadikan deal**: deal Prospecting baru, `facility_name` = institusi, `product_category` ikut divisi
  (Medical/IVD), `city`/`province` dari kota asal, `sumber_lead = 'pameran'`, nama + HP + kupon pengunjung di catatan. AM ikut scope
  pemanggil (`createDeal`). Klik ganda/serentak hanya menghasilkan satu deal.
- **Hapus** pengunjung hanya untuk entri iseng/ganda; ditolak bila sudah menang undian atau sudah jadi deal.

## Izin (matriks Akses Grup, fitur `pameran`, tertutup default — perlu **Sync Fitur**)

| Aksi | Untuk |
|---|---|
| lihat | daftar pameran, pengunjung, hasil undian, export CSV |
| buat | buat pameran baru |
| ubah | ubah pameran, buka/tutup form, kocok pemenang, tandai hangus, jadikan deal |
| hapus | hapus entri pengunjung |

## Keamanan jalur publik

- Middleware meloloskan `/daftar/` dan `/api/publik/` tanpa sesi. **Hanya** BFF di
  `app/api/publik/pameran` yang boleh ada di bawah `/api/publik/`: slug divalidasi regex, path API tetap,
  body dibangun ulang dari tiga field (nama/institusi/no_hp) — field lain (mis. `oleh`) dibuang.
- Batas kirim per IP di apps/api: **600 per 10 menit** (env `PAMERAN_JATAH_IP`). Wi-Fi venue & CGNAT
  operator = ratusan pengunjung satu IP — jatah awal 40 menolak 460 dari 500 di uji beban.
  IP dari `cf-connecting-ip` (Cloudflare Tunnel).
- Field umpan bot tersembunyi (`situs`); terisi → dibalas sukses palsu, tidak disimpan.
- Halaman `noindex`.

## Prasyarat prod (di luar repo)

**Cloudflare**: `os.wahanalifeline.co.id` memakai **I'm Under Attack Mode** (Security Level, plan Free)
— bukan WAF, jadi aturan *WAF Skip* TIDAK berpengaruh; satu-satunya pengecualian per path adalah
**Configuration Rule** (Security Level → off) untuk `/daftar/` & `/api/publik/`. Keputusan user 24 Sep
2026: UAM tetap menyala, tanpa bypass permanen — jadi ini keputusan user, bukan langkah otomatis.
Tanpa pengecualian: pengunjung melihat layar "Checking your browser" ±5 dtk saat membuka QR, lalu
`cf_clearance` (default 30 menit) membuat submit lolos. Gagal submit hanya bila form dibiarkan terbuka
melewati masa cookie — pesan "Koneksi terputus. Muat ulang halaman" menuntun pengunjung.

## Uji beban (30 Okt 2026, k6 di Mac mini → stack dev, tanpa Cloudflare)

| Skenario | Hasil |
|---|---|
| 500 pengunjung dalam 60 dtk (IP berbeda) | 0% gagal, p95 10 ms |
| 500 pengunjung dalam 10 dtk (50/dtk) | 0% gagal, p95 8 ms |
| 500 dibuka di milidetik yang sama | ±65% ditolak di level TCP (antrean `somaxconn` 128 macOS) — artefak uji: di prod semua lewat beberapa koneksi tetap `cloudflared`, bukan 500 koneksi baru |
| 500 dalam 60 dtk dari SATU IP | jatah lama 40 → 460 ditolak (429) → jatah dinaikkan ke 600 |

Data selalu konsisten: setiap pendaftar sukses = 1 baris, kupon & no. HP unik.

## Data

- `pameran` — acara (slug unik = alamat form, divisi, tanggal, awalan kupon, saklar buka).
- `pameran_pengunjung` — unik `(pameran_id, no_hp)`, `kode_kupon` unik global, `ip`/`user_agent` untuk
  jejak spam, `deal_id` saat dijadikan deal (`'proses'` = penanda sementara selama deal dibuat).
- `pameran_undian` — satu baris per pemenang (`pengunjung_id` unik), status `menang`/`hangus`.
