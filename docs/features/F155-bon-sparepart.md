# F155 — Bon Sparepart Teknisi (#BON) & #OPNAME

Menu **Bon Sparepart** (Operations, `/bon-sparepart`) + hashtag WA `#BON` dan `#OPNAME`.

## Latar
Teknisi membawa sparepart urgent saat kantor tutup (bypass alur PO customer → SJ). Gudang membuat bon; teknisi melapor lewat WA; `#OPNAME` menampilkan bon yang sudah dilaporkan vs belum dan rekonsiliasi bon yang sudah jadi SJ (keputusan Direktur, rapat 2026-10-19). Tanpa PRD; keputusan desain dijawab user 2026-10-26.

## Alur
1. **Admin Gudang** mencatat bon di dashboard (teknisi + sparepart dari master Accurate + jumlah; customer opsional) → status `dibuat`.
2. **Teknisi** melapor lewat WA — satu barang per baris, jumlah `x2` (kosong = 1):
   ```
   #BON Pompa peristaltik x2
   Lampu halogen 12V
   ```
   Dicocokkan ke bon gudang miliknya (terlama dulu, per barang). Semua baris penuh → bon `dilaporkan`; sebagian → tetap `dibuat` ("sebagian dilaporkan"). Laporan tanpa bon gudang → bon baru `asal='teknisi'` (ditandai di #OPNAME). Nama barang ambigu → bot minta kode item, **tak ada yang dicatat** sampai semua baris benar. `#BON status` = bon saya 30 hari.
3. **Rekonsiliasi ke SJ** (hanya baca mirror `accurate_delivery_order[_item]`; tak menulis ke Accurate): bon `dilaporkan` ditautkan otomatis bila **tepat satu** SJ cocok — semua item bon ada di SJ, tanggal SJ −1…+14 hari dari laporan (WIB), customer sama bila diisi — dan SJ itu bukan kandidat bon lain. Selain itu: pilih dari kandidat atau isi nomor SJ manual di dashboard (nomor divalidasi ada di mirror; satu SJ satu bon). Status → `selesai`.
4. **#OPNAME** (non-teknisi; read-only selain menautkan): belum dilaporkan, dilaporkan belum SJ, #BON tanpa bon gudang, sudah jadi SJ (terbaru). Tab **Opname** di dashboard = isi yang sama.

## Data
Migrasi **253** (additive, idempoten): `bon_sparepart` (status `dibuat`→`dilaporkan`→`selesai`/`batal`, `asal` gudang|teknisi, tautan SJ + sumber otomatis/manual) dan `bon_sparepart_item` (`dilaporkan_qty` per baris). Indeks unik parsial menjamin satu SJ hanya dipakai satu bon aktif.

## Akses
Fitur `bon-sparepart` di matriks Akses Grup — **tertutup default** (perlu Sync Fitur + centang grup). Sebelum matriks diatur: admin/superuser, Direktur, HoD Aftersales, jabatan memuat "aftersales"/"gudang". Tulis (bon baru, batal, tautkan, rekonsiliasi) = izin edit. Teknisi melapor lewat WA saja (tak punya akun dashboard).

## Batasan (disengaja)
- Tanpa sinkron/penulisan ke Accurate, tanpa approval berjenjang, tanpa cron pengingat, tanpa notifikasi ke Admin Gudang; balasan WA hanya ke chat/grup asal pesan.
- Master tidak punya kategori sparepart (`accurate_item.category` = jenis teknis) → pencarian lewat nama/kode.
- Item SJ hanya ditarik 120 hari terakhir dan bertahap; SJ yang itemnya belum ditarik tak bisa dicocokkan otomatis (tetap bisa manual).
- Pencocokan otomatis tidak membandingkan qty (teknisi bisa membawa lebih banyak dari yang dipakai di SJ).
