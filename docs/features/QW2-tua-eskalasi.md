# QW2 — TUA bertingkat + eskalasi Harga ke Direktur

Aturan Direktur (rapat 2026-10-19): konfirmasi yang belum clear = **TUA** bila jeda >8 jam;
untuk komunikasi soal **Harga** ambangnya >4 jam, dan **>2 hari dieskalasi ke Direktur**.

## Cara kerja
Job `notif-tua` (14:05 & 22:15, `repo/notiftua.ts`) membaca section "⏳ OUTSTANDING" resume eksekutif hari ini:

- Semua item OUTSTANDING dinilai sendiri (tidak lagi bergantung pada tag `[TUA]` LLM yang memakai >4 jam untuk semua).
- **Action items lewat tenggat**: section "3. ACTION ITEMS OUTSTANDING" (`PIC → tugas | deadline | status`) juga dibaca. Tugas yang
  tenggatnya sudah lewat langsung TUA; Harga yang lewat tenggat >2 hari ikut eskalasi. Tenggat tanpa jam = akhir hari itu. Format yang
  dikenali: `24 Okt`, `24 Oktober 2026`, `24/10`, `24-10-2026`, `2026-10-24`, `hari ini`, `kemarin`, `besok`, plus jam opsional.
  Tenggat yang tak terbaca ("segera", nama hari seperti "Jumat") **diabaikan**, tidak ditebak.
- **Piutang lewat jatuh tempo (perpanjangan AR Watch)**: dibaca dari `ar_aging_mv`, bukan dari resume, jadi tetap jalan walau resume hari itu tidak ada.
  Yang dihitung hanya yang kritis menurut AR Watch (bucket 90+ atau anomali) dan lewat **30 hari** (TUA); lewat **60 hari** dieskalasi ke Direktur
  (sekali per faktur, `tua_item.eskalasi_at`). Ambang: `AR_TUA_HARI` (default 30), `AR_ESKALASI_HARI` (default 60). Tampil sebagai bagian
  "💸 Piutang Kritis" terpisah (top 5 + sisa) agar tak menenggelamkan item resume. Karena yang dihitung hanya 90+ atau anomali, eskalasi praktis
  mengenai semua 90+ dan anomali >60 hari.
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
