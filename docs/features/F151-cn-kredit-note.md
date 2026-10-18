# F151 — CN (Kredit Note) Lifecycle (SALES / FINANCE / GA)

Rebate ke customer berdasarkan **kontrak**, dihitung dari **DPP faktur**, diajukan lewat **form**:
`diajukan → [ditinjau HoD Business] → disetujui HoD Sales → divalidasi Finance → terealisasi (GA, bukti)`.
`ditolak` / `dibatalkan` = final dan melepas faktur supaya bisa diajukan lagi.

- **Menu**: `/cn` ("Kredit Note (CN)", grup Finance). Tiga tab: Pengajuan, Kontrak, Laporan. Kunci izin `cn` (view / create / edit).
- **Migrasi**: `235_cn_kredit_note.sql` (4 tabel + 2 sequence). **⚠️ BUTUH MIGRASI DB** (diterapkan manual ke dev + prod).
- **Setelah deploy**: klik **Sync Fitur** sekali agar `cn` muncul di matriks Akses Grup (tertutup default), lalu centang
  view/create/edit untuk Sales, HoD, Finance, GA.
- **Bukan** F27 Faktur Pajak (dihentikan), credit memo/retur Accurate (tetap di Accurate), F31 Tukar Faktur.

## Keputusan Direktur (diskusi 16 Okt 2026, Bagian 1.1)

| # | Pertanyaan | Jawaban |
|---|---|---|
| 1 | CN itu apa? | Rebate kontrak, **diinput lewat form** (bukan credit memo Accurate) |
| 2 | Alur & approver | Sales mengajukan ke **HoD Sales atau HoD Business**; setelah itu **HoD Sales approve** |
| 3 | Dasar hitung | **Faktur** (DPP), bukan pembayaran masuk |
| 4 | Isi kontrak | Customer, persen/nominal, periode, dasar hitung, syarat, berkas |
| 5 | Laporan pembagian | Per customer dan per sales |
| 6 | Finance vs GA | Finance menghitung/memvalidasi/menyetujui; GA hanya merealisasikan transfer + bukti |
| 7 | Tahap pertama & notifikasi | Penyampaian nilai CN; WA ke Finance → HoD → GA → Sales |

## Keputusan teknis (asumsi saya — bisa diubah)

| # | Keputusan | Alasan |
|---|---|---|
| 1 | **HoD Sales = approver akhir** (`rocky` East / `yogi` West); **HoD Business = peninjau opsional** (`mufid` IVD / `arman` Medical). Pengaju memilih keduanya di form | jawaban #2: "ke HoD Sales atau HoD Business, setelah itu HoD Sales approve". Kunci dari `master_hod` (198) |
| 2 | Lewat HoD Business → wajib `ditinjau` dulu; tanpa HoD Business → HoD Sales langsung `disetujui` | rute terkunci di tabel, tak bisa dilompati (diuji) |
| 3 | Finance (`ika`) memvalidasi, GA (`husni`) merealisasikan; **tolak** oleh pemegang tahap berjalan; **batal** hanya oleh pengaju, hanya sebelum `disetujui` | jawaban #6. Setelah disetujui hanya Finance/GA yang bisa menolak |
| 4 | Tarif/jenis di-**snapshot** ke pengajuan; DPP & nilai CN per faktur di-snapshot ke `cn_pengajuan_item`. **Nilai dihitung SERVER** dari DPP mirror; angka dari klien diabaikan | kontrak/mirror berubah kemudian tak menggeser angka yang sudah diajukan |
| 5 | Persen: `round(DPP × tarif/100)` per faktur. Nominal: tarif = total per pengajuan, dibagi sebanding DPP (largest remainder) sehingga jumlah item **persis** = tarif | tak ada selisih sen/rupiah |
| 6 | Validasi per transaksi: faktur milik customer kontrak, tanggal dalam periode (inklusif), DPP > 0, belum dicakup pengajuan aktif. Satu faktur = satu pengajuan aktif (indeks unik parsial) | SOP "validasi CN per transaksi"; balapan dua pengajuan: tepat satu menang (diuji) |
| 7 | Kontrak: dibuat `draft` oleh Sales, **diaktifkan/dibatalkan Direktur** (+admin/superuser). Kontrak tak bisa dibatalkan selama ada pengajuan aktif | tabel di rekomendasi (kontrak = Direktur). Belum ada approver kontrak dari Direktur — ubah bila beda |
| 8 | Realisasi wajib **bukti = tautan https** + tanggal (default hari ini, tak boleh masa depan) | belum ada penyimpanan berkas generik (sama F27) |
| 9 | Hak per tahap di **BFF** (`lib/cn-access.ts`); status/rute pengajuan dibaca server dari api, bukan dari body | pola F35/F138; api tak tahu role |
| 10 | Laporan = agregat per customer & per sales (salesman faktur), tanpa ditolak/dibatalkan, filter tanggal faktur | SOP "laporan CN" & "laporan pembagian CN" |

## Belum dikerjakan (sengaja)

- **Notifikasi WA** (jawaban #7): target broadcast harus ditentukan user, bukan diinferensi (CLAUDE.md). Butuh nomor/grup tujuan.
- **Batas nilai → Direktur**: rekomendasi awal punya ambang approval Direktur; jawaban #2 tidak menyebutnya, jadi tidak dibuat.
- **Row-level scope**: semua pemegang izin `cn` melihat semua pengajuan (Sales belum dibatasi ke customer-nya sendiri).
- **Ekspor CSV** laporan, unggah berkas (kontrak/bukti) — tautan https dulu.
- **Identifikasi Finance/GA** selain `hod_key` (`ika`/`husni`) dan title (`finance`, `ga`, …) — tambahkan bila staf non-HoD ikut memegang tahap.
