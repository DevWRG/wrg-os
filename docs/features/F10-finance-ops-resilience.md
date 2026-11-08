# F10 — Finance Ops Resilience (fakturis SPOF + faktur revisi SLA + register cek)

Tiga pengaman operasional Finance dari briefing 24 Mei 2026: komputer fakturis offline 11+ jam, kasus cek kosong
sampai panggilan Polrestabes, dan faktur revisi tanpa SLA. **F10 mengambil alih F29** (Cash Management & Cek
Verification) — register cek dibangun di sini. Status: cakupan disetujui user 7 Nov 2026 · bagian 1 (#2096, #2101) · bagian 2 (#2101) · bagian 3 dibangun 8 Nov.

## Masalah (data prod 7 Nov 2026)

- **Fakturis = titik gagal tunggal.** 60 hari terakhir **1.142 faktur dibuat oleh 2 akun Accurate saja**
  (`raw->>'createdBy'` 829215: 589 · 836342: 553). Kalau dua komputer/orang itu berhalangan, penerbitan faktur berhenti
  dan tak ada yang tahu sampai AM/customer menagih.
- **Revisi faktur tak terlacak.** Di Accurate revisi = faktur dihapus lalu diinput ulang dengan nomor sama (id baru),
  atau diedit di tempat. Arsip `accurate_invoice_hilang` (#1840) mencatat **35 faktur hilang sejak 21 Okt, 20 di antaranya
  diinput ulang** (≈20 revisi / 2,5 minggu). Tapi: jam *permintaan* revisi tak tercatat di mana pun, sapuan hilang baru
  jalan 05:30 dan hanya memeriksa faktur OPEN, dan edit di tempat tak terdeteksi sama sekali.
- **Field pajak kosong.** `taxNumber`, `referenceNumberTax`, `efakturProceed` kosong di semua faktur 60 hari (e-Faktur
  diproses di luar Accurate, lihat F27 ditutup) → revisi faktur *pajak* tak bisa dibaca dari mirror; F10 hanya
  melacak revisi faktur penjualan.
- **Cek tidak tercatat.** Tak ada data cek/giro di mirror Accurate; register harus diinput Finance.

## 1. Alarm fakturis diam (SPOF)

- Sumber: `raw->>'createDate'` (format `dd/mm/yyyy HH:MM:SS`, WIB) + `raw->>'createdBy'` di `accurate_invoice`.
- Dicek **sesudah tiap sync faktur** (`ACCURATE_SYNC_CRON`, default 10/12/14/16/18/20 Sen–Jum) — tak menambah panggilan
  Accurate. Resolusi deteksi ≈ 2 jam karena faktur baru hanya terlihat sesudah sync.
- Aturan: hari kerja (`master_holiday`, F14), jam kerja 08:00–17:00. Kalau **tidak ada faktur baru selama ≥ 3 jam kerja**
  (dihitung dari `createDate` terakhir, atau dari 08:00 bila belum ada sama sekali hari itu) → satu alarm ke grup
  **FINANCE & TAX WRG** (target `F10_WA_TARGET`, cadangan `INVOICE_REMINDER_FINANCE_TARGET`). Satu alarm per kejadian;
  faktur berikutnya muncul → pesan "pulih" + lama diam.
- Ambang (`F10_SPOF_JAM`, default 3) dan jam kerja bisa diubah lewat env. Alarm per akun **tidak** dipakai (keputusan user).
- **Rekap mingguan** (Senin pagi, ikut saklar yang sama): jumlah faktur per akun fakturis, porsi akun terbesar, kejadian
  diam minggu lalu. Nama akun dipetakan lewat UI (`createdBy` → master_user), bukan di kode.
- Web: kartu "Penerbitan Faktur" — faktur terakhir (jam + akun), status normal/diam, riwayat kejadian diam 30 hari.

## 2. Faktur revisi + SLA

### WA `#REVISI` (pengirim ketat: master_user aktif — AM, Admin, Finance)

```
#REVISI PJK/1459-2606-JBR | harga item ke-2 salah, harusnya 1.250.000
```

- Nomor faktur wajib dan harus ada di `accurate_invoice` (atau `accurate_invoice_hilang`). Tak ketemu → bot membalas
  contoh format + saran nomor terdekat; tidak menebak. Alasan wajib (`|` lalu teks bebas).
- Tiket dibuka dengan `diminta_at` = jam pesan. Balasan bot: `📝 Revisi R12 tercatat — PJK/1459-2606-JBR (RSUD …).
  Batas SLA: <tanggal jam>`. Tiket dobel (nomor sama, masih terbuka) → bot menyebut tiket yang ada.
- Notifikasi ke grup FINANCE & TAX WRG supaya fakturis tahu ada antrean.

### Penutupan otomatis

Tiket dianggap selesai ketika sync faktur (2-jam-an) menemukan salah satu:
1. faktur dengan **nomor sama dan id berbeda** dari id saat tiket dibuka, dibuat sesudah `diminta_at` (hapus → input ulang), atau
2. **`optLock` naik** pada id yang sama (edit di tempat).

`selesai_at` = `createDate` faktur baru / waktu sync yang melihat perubahan. Finance juga bisa menutup manual di web
(catatan wajib, mis. "tidak perlu revisi") — status **Ditutup manual**, tidak ikut hitungan % tepat SLA.
Catatan: edit di tempat baru terlihat saat faktur itu tersinkron ulang (jendela 7 hari sync 2-jam-an, atau sapuan
faktur OPEN 05:30), jadi deteksi edit pada faktur lama/lunas bisa tertunda.

### Deteksi tanpa #REVISI

Faktur input ulang yang tak punya tiket tetap dicatat sebagai revisi **tanpa SLA** (`sumber = deteksi`), supaya pola revisi
per cabang/AM/fakturis kelihatan. Sumber: `accurate_invoice_hilang.ada_kembaran` + pengecekan nomor kembar saat sync.

### SLA

- Default **1 hari kerja** sejak `diminta_at` (`F10_REVISI_SLA_JAM_KERJA`, default 8), dihitung jam kerja + hari libur F14.
- Lewat batas → pengingat ke grup Finance sekali per tiket (dicek tiap sync; gagal kirim = dicoba lagi sync berikutnya).
  Rekap harian ke rekap overdue F91 tidak dibangun dulu.
- Web: tab **Faktur Revisi** di menu Penerbitan Faktur (izin yang sama) — tiket terbuka/selesai/terdeteksi 60 hari,
  ringkasan % tepat SLA + median lama proses (jam kerja), tutup manual (izin ubah), ekspor Excel 180 hari.
- `#REVISI` aktif hanya bila `F10_REVISI_ENABLED=true`; mati = pesan diabaikan.

## 3. Register cek (ambil alih F29)

Hanya **cek/giro keluar** (yang diterbitkan WRG) — pencegahan kasus cek kosong. Cek masuk dari customer di luar cakupan
tahap ini. Dibangun 8 Nov 2026 (migrasi 293, menu `/register-cek`).

- Input lewat **web** (menu Finance → Register Cek), bukan WA (`#CEK` sudah dipakai cek faktur F4/QW3).
  Field: rekening (master `bank_account` F-CASHIN, hanya jenis kas), jenis cek/giro, nomor seri, tanggal terbit,
  tanggal efektif (giro), penerima, nominal, keperluan, dokumen dasar (opsional). Foto/scan cek **belum** (menyusul).
- **Alur status:** `draft → diajukan → disetujui | ditolak → diserahkan → cair | tolak_bank`; `draft/diajukan/disetujui → batal`.
  - Izin matriks menu `register-cek`: **tambah** = input, ajukan, serahkan, cair, tolak bank, batal (kasir);
    **ubah** = setujui / tolak (HoD Finance). Pembuat cek **tidak bisa** menyetujui ceknya sendiri (dicek di API).
  - Tolak, tolak bank, dan batal wajib alasan. Cek belum disetujui tidak bisa ditandai diserahkan.
  - Persetujuan **lewat web saja**; WA hanya memberi tahu (`F10_CEK_WA_TARGET`) saat cek diajukan. Balasan WA
    `ya C<id>` belum dibangun.
- **Pengaman cek kosong:** saldo pembanding = **saldo akhir rekening koran terakhir** yang disetor lewat `#KORAN`
  (F-CASHIN `bank_statement`, yang `perlu_review` diabaikan) — tidak ada input saldo manual. Total cek beredar
  (disetujui + diserahkan, belum cair) + cek yang diajukan > saldo → peringatan merah di daftar, di form input, dan di WA
  ke penyetuju. Rekening tanpa rekening koran disebut "tidak ada pembanding".
- **Cair otomatis** (job harian): mutasi debit rekening yang sama, nominal persis, tanggal ≥ terbit, dan deskripsinya
  memuat angka nomor seri (sama persis, atau potongan ekor ≥ 6 digit). Nol atau lebih dari satu kandidat → tidak
  ditebak, ditandai manual. Satu mutasi tak dipakai dua cek.
- Nomor seri unik per rekening; nomor loncat (seri baru ≠ seri terakhir + 1, awalan sama) ditandai di daftar.
- Pengingat jatuh tempo H-3 dan H (sekali per cek per tahap) ke grup Finance untuk cek diserahkan yang belum cair —
  `F10_CEK_CRON` default 08:30 hari kerja.
- **Audit:** `cek_keluar_log` append-only (aplikasi hanya INSERT/SELECT); cek tidak bisa dihapus.
- Saklar `F10_CEK_ENABLED` (default mati) untuk job harian + WA. Menu tetap bisa dipakai tanpa saklar (izin matriks).

## Data (garis besar, nomor migrasi ditentukan saat build)

| Tabel | Isi |
|---|---|
| `fakturis_diam` | kejadian diam: mulai, pulih, lama, alarm terkirim |
| `faktur_revisi` | `id`, `nomor`, `invoice_id_awal`, `opt_lock_awal`, `alasan`, `diminta_oleh`, `diminta_at`, `sumber` (wa/deteksi), `batas_sla`, `invoice_id_baru`, `selesai_at`, `ditutup_manual`, `catatan` |
| `cek_keluar` | register cek + status terakhir |
| `cek_keluar_log` | riwayat status append-only |
| ~~`rekening_saldo`~~ | tidak dibuat — saldo dari `bank_statement` F-CASHIN |
| `fakturis_akun` | pemetaan `createdBy` Accurate → master_user (diisi lewat UI) |

## Saklar (default mati)

`F10_SPOF_ENABLED` · `F10_REVISI_ENABLED` (hashtag + deteksi + pengingat) · `F10_CEK_ENABLED` (menu + WA persetujuan).
Uji WA dari dev hanya ke grup "Research".

## Di luar cakupan

- Revisi faktur pajak / e-Faktur (data tak ada di mirror).
- Cek masuk dari customer, rekonsiliasi mutasi bank otomatis.
- Pemantauan perangkat fisik komputer fakturis (agen di PC) — deteksi lewat aktivitas faktur sudah cukup untuk tahap ini.

## Urutan build

1. Alarm fakturis diam + rekap mingguan (paling kecil, data sudah ada).
2. `#REVISI` + penutupan otomatis + deteksi + tab web.
3. Register cek + persetujuan HoD + saldo & peringatan + pengingat jatuh tempo.

## Pertanyaan terbuka

- ~~Saldo rekening diinput siapa?~~ Terjawab: diambil dari rekening koran `#KORAN` (F-CASHIN), tanpa input manual.
- Jam kerja fakturis sama 08:00–17:00 di semua cabang, atau ada fakturis cabang?
- `#REVISI` boleh dikirim customer-facing staff selain AM (mis. Admin Sales cabang)?
