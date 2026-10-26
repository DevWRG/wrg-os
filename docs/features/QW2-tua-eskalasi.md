# QW2 — TUA bertingkat + eskalasi Harga ke Direktur

Aturan Direktur (rapat 2026-10-19): konfirmasi yang belum clear = **TUA** bila jeda >8 jam;
untuk komunikasi soal **Harga** ambangnya >4 jam, dan **>2 hari dieskalasi ke Direktur**.

## Cara kerja
Job `notif-tua` (14:05 & 22:15, `repo/notiftua.ts`) membaca section "⏳ OUTSTANDING" resume eksekutif hari ini:

- Semua item OUTSTANDING dinilai sendiri (tidak lagi bergantung pada tag `[TUA]` LLM yang memakai >4 jam untuk semua).
- Kategori **Harga** bila topik/status memuat harga, price list, penawaran, SPH, quote, diskon, nett, launching; selain itu **umum**.
- TUA: umur ≥ 4 jam (Harga) / ≥ 8 jam (umum). Umur = yang terbesar antara umur di teks resume dan waktu sejak topik **pertama terlihat**.
  Bila umur tak terbaca sama sekali, tag LLM dipakai.
- Eskalasi: Harga dengan umur > 2 hari → blok "🔺 Eskalasi ke Direktur" di pesan, **sekali per item** (`tua_item.eskalasi_at`, diisi hanya setelah pesan terkirim).
- `tua_item` (migrasi 254) mencatat pertama/terakhir terlihat per topik, karena resume hanya mencakup beberapa jam dan tak bisa menunjukkan umur berhari-hari. Topik yang tak terlihat >3 hari dianggap selesai dan dihapus.

## Target
Tetap satu target `NOTIF_TUA_TARGET` — untuk tahap uji isi dengan **grup Research**. Tidak ada DM personal, tidak ada mention,
tidak ada hashtag. Nomor/grup Direktur ditentukan Direktur, lalu cukup ganti env.

## Batasan
- Jenis "Harga" ditebak dari kata kunci; topik yang tak memuat kata itu dianggap umum.
- Eskalasi >2 hari hanya terlacak selama topik terus muncul di resume (jeda ≤3 hari ditoleransi).
- Belum teruji: WA live ke grup Research dan resume prod.
