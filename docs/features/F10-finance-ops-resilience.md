# F10 — Finance Ops Resilience (fakturis SPOF + faktur revisi SLA + register cek)

Tiga pengaman operasional Finance dari briefing 24 Mei 2026: komputer fakturis offline 11+ jam, kasus cek kosong
sampai panggilan Polrestabes, dan faktur revisi tanpa SLA. **F10 mengambil alih F29** (Cash Management & Cek
Verification) — register cek dibangun di sini. Status: cakupan disetujui user 7 Nov 2026 · bagian 1 dibangun (#2096 + menu Penerbitan Faktur) · bagian 2 dibangun (8 Nov) · bagian 3 belum.

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
tahap ini.

- Input lewat **web** (menu Finance → Register Cek), bukan WA (`#CEK` sudah dipakai cek faktur F4/QW3).
  Field: nomor seri cek, bank & rekening sumber, tanggal terbit, tanggal jatuh tempo (giro), penerima, nominal, keperluan,
  dokumen dasar (no. faktur pembelian/PO, opsional), foto/scan cek (unggah ke folder arsip Drive F156).
- **Alur status:** `draft → diajukan → disetujui | ditolak → diserahkan → cair | batal | tolak_bank`.
  - Kasir input & ajukan → **HoD Finance** menyetujui/menolak (satu langkah, keputusan user) lewat web atau balas WA
    `ya C<id>` / `tolak C<id> <alasan>` (pola gerbang `ya R<n>` F-CASHIN). Penyetuju di-set lewat UI.
  - Cek belum disetujui **tidak boleh** ditandai diserahkan.
- **Pengaman cek kosong:** sebelum disetujui, tampilkan total cek beredar (disetujui/diserahkan, belum cair) per rekening
  per tanggal jatuh tempo, dan **saldo rekening yang diinput Finance** (input manual harian/mingguan; saldo bank tak ada
  di mirror). Kalau total jatuh tempo pada satu tanggal > saldo terakhir → peringatan merah di layar persetujuan dan di
  pesan WA ke HoD.
- Nomor seri unik per bank+rekening; nomor terlewat/loncat dalam satu buku cek ditandai (deteksi cek hilang).
- Pengingat jatuh tempo H-3 dan H ke grup Finance untuk cek diserahkan yang belum ditandai cair.
- **Audit:** setiap perubahan status + siapa + kapan tercatat (append-only); cek tidak bisa dihapus, hanya `batal` dengan alasan.
- Hak akses: menu baru default tertutup (RBAC matriks). Kasir = input; HoD Finance = setuju; Direktur/admin = baca semua.
  Nominal & penerima = data uang → gerbang BFF wajib cek izin sejak PR pertama.

## Data (garis besar, nomor migrasi ditentukan saat build)

| Tabel | Isi |
|---|---|
| `fakturis_diam` | kejadian diam: mulai, pulih, lama, alarm terkirim |
| `faktur_revisi` | `id`, `nomor`, `invoice_id_awal`, `opt_lock_awal`, `alasan`, `diminta_oleh`, `diminta_at`, `sumber` (wa/deteksi), `batas_sla`, `invoice_id_baru`, `selesai_at`, `ditutup_manual`, `catatan` |
| `cek_keluar` | register cek + status terakhir |
| `cek_keluar_log` | riwayat status append-only |
| `rekening_saldo` | saldo rekening input manual per tanggal |
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

- Saldo rekening: diinput siapa dan seberapa sering (harian/mingguan)?
- Jam kerja fakturis sama 08:00–17:00 di semua cabang, atau ada fakturis cabang?
- `#REVISI` boleh dikirim customer-facing staff selain AM (mis. Admin Sales cabang)?
