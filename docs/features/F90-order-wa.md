# F90 — Sales Order Entry via WA (#ORDER)

AM mengetik pesanan di WhatsApp; WRG-OS memvalidasi barang dan harga terhadap price book, AM
konfirmasi, pesanan masuk **Antrean Order** untuk Admin Sales. WRG-OS **tidak menulis ke Accurate**:
Admin Sales tetap menginput SO di Accurate, lalu sistem mencocokkan pesanan dengan cermin
`accurate_sales_order` secara otomatis.

## Alur WA

```
#ORDER RS Siloam Surabaya
2 box GLU-100
5 ARC-CRP @ 450000
catatan: kirim minggu depan
```

1. Baris pertama = faskes (`cariAkun`; harus mengerucut ke satu akun).
2. Tiap baris berikutnya = `qty [satuan] <kode|nama> [@ harga]`, maksimal 30 baris.
   - Barang dicari di `product_pricelist` periode `ORDER_PERIODE_HARGA` (default `H2-2026`): kode
     persis, atau semua token nama cocok.
   - Tanpa `@ harga` → harga = price list. Harga **di bawah lantai (`harga_nett`) ditolak**, baris
     tidak masuk.
   - Stok Accurate (`accurate_item`) ikut dicatat sebagai info, tidak memblokir.
3. Balasan = ringkasan draft `O<id>` + total. AM membalas `#ORDER ya O<id>` (berlaku 24 jam) →
   status `antrean`. `#ORDER batal O<id> <alasan>` membatalkan. `#ORDER status` = daftar pesanan
   terakhir AM.
4. Pengirim: `resolveSender` ketat; peran am/hod/admin/direktur.

## Menu Antrean Order (`/order-wa`)

- Kartu status: Antrean · Diproses · Masuk Accurate · Batal. Klik nomor pesanan untuk rincian barang
  (harga, lantai, stok saat pesan).
- Aksi (admin/superuser, izin `order-wa` edit): Proses → Sudah di Accurate (isi nomor SO) / Batal
  (wajib alasan); Buka lagi dari Masuk Accurate.
- Cocok otomatis setiap halaman dibuka: customer sama, `trans_date` antara H-1 dan H+14 dari
  konfirmasi, minimal satu kode barang sama (bila pesanan punya kode), dan SO belum dipakai pesanan
  lain → `selesai`, `selesai_oleh = 'otomatis'`.
- Scope baris: AM melihat pesanannya sendiri, HoD per cabang, admin/direktur semua.

## Saklar

| Env | Default | Fungsi |
|---|---|---|
| `ORDER_WA_ADMIN_ENABLED` | mati | kirim WA ke Admin Sales saat pesanan masuk antrean |
| `ORDER_WA_ADMIN_TARGET` | — | JID grup/nomor Admin Sales |
| `ORDER_PERIODE_HARGA` | `H2-2026` | periode price book acuan |

## Data

Migrasi `239_order_wa.sql`: `order_wa` (header + status) dan `order_wa_item` (snapshot barang,
harga, lantai, stok; `CHECK harga >= harga_nett`).
