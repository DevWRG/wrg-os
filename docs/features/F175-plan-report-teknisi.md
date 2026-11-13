# F175 — Plan & Report Teknisi (format WA khusus Aftersales)

WA `#PLAN` / `#REPORT` untuk role **Teknisi** dengan format per alat, bukan format sales. Pengganti bertahap
Google Form "Kegiatan Teknisi". Status: **Fase 1 dibangun** (8 Nov 2026, lihat "Status pembangunan"); spesifikasi disetujui user 6 Nov 2026.

## Masalah (keadaan dev 6 Nov 2026)

- `AM_ROLES = {AM, Teknisi}` (`repo/inbound.ts`) → #plan/#report teknisi lewat jalur sales: `parseAmPlan` →
  `sales_plan` (`customer | tujuan | goal`), `parseAmReport` → `activity_log` (`customer — hasil — next`).
  Tak ada SN/alat, jenis kunjungan, status per item; laporan dicocokkan ke plan dengan trigram nama faskes
  (dua alat di satu RS tak bisa dibedakan) dan ditautkan ke **deal sales** (`opportunity_id`).
- `#install/#servis/#training/#kalibrasi` → `teknisi_report.body` teks bebas, `installation_unit_id` tak pernah diisi dari WA.
- Jadwal Rutin (F154), jadwal PM, jadwal install, tiket servis: realisasi ditandai **manual**.
- Google Form (±4.000 isian 2025–2026) memegang data yang tak ada di WRG-OS: jenis kunjungan, SN, kegiatan,
  jumlah tes, sparepart, kondisi alat, foto, jam keluhan/selesai (SLA), sheet "Plan Tidak Realisasi".
- Bug terkait: `reportPerOrang` (`repo/plandash.ts`) memakai `role === "AM"` → teknisi dibaca dari counter `sales_todo`
  padahal datanya di `sales_plan` (angka per orang ≈ 0).

## Format

### #PLAN (sebelum 08:00, aturan telat sama dengan AM)

```
#PLAN 7 Nov
1. RSUD Trenggalek | 0832 | PM
2. RS PTP Jember | CM250 | Service
3. PKM Bakunase | Z360 | Install
4. RS Al Irsyad | DxH 560 | Call
```

`faskes | SN atau nama alat | jenis [nomor tiket]`. Tanggal opsional (default hari ini/besok mengikuti jam kirim seperti
#plan sekarang). **Jenis**: `PM · Service · Install · Uji Fungsi · Tarik Alat · Training · Kalibrasi · Call`
(alias: Maintenance=PM, Refresh Training=Training). Kirim ulang #PLAN di hari yang sama = ganti item yang belum dilaporkan.

### #REPORT — satu pesan per kunjungan (per faskes)

Satu alat, merujuk plan:
```
#REPORT 1
Status: Selesai
Kegiatan: bersihkan probe, kalibrasi
Jumlah Tes: 2150
Pergantian Sparepart: lampu halogen 1
Catatan: -
```

Satu alat, tanpa plan (kerjaan mendadak):
```
#REPORT
RS: RS Al Irsyad
Alat: DxH 560
SN: 4471
Jenis: Service
Status: Selesai
Kegiatan: reset sensor
```

Beberapa alat di satu faskes:
```
#REPORT
RS: RSUD Trenggalek

1) SN 0832 | Zybio EXC200 | PM
Status: Selesai
Kegiatan: bersihkan probe, kalibrasi
Jumlah Tes: 2150
Pergantian Sparepart: -

2) #2
Status: Pending sparepart
Kegiatan: cek error tray, ganti rack sementara

Catatan: analis Bu Rina
```

**Aturan baca (deterministik, tanpa LLM):**
- Label tak peka huruf, urutan bebas, alias umum diterima (`Tes`, `Sparepart`, `Faskes`=`RS`, `Nomor Seri`=`SN`).
- **Wajib**: identitas alat (nomor plan `#n` / `#REPORT n`, ATAU RS + SN/Alat) dan `Status` per alat.
- **Status**: `Selesai/Done/OK/Beres` · `Pending <alasan>` · `Batal/Cancel/Gagal <alasan>` · `Revisit`.
  Pending/Batal tanpa alasan (di baris status atau `Catatan`) → ditolak dengan contoh.
- Blok alat dimulai baris bernomor `1)` / `2.`; isi judul = `#<no plan>` ATAU `SN | alat | jenis`.
  `RS:` dan `Catatan:` di luar blok berlaku untuk seluruh kunjungan.
- Baris kosong tidak menutup blok: `Status:`/`Kegiatan:` sesudah baris kosong tetap milik blok terakhir. Yang pindah
  ke tingkat kunjungan hanya `Catatan:` yang didahului baris kosong (Catatan tepat di bawah isian blok = milik alat itu).
- Baris bernomor tepat di bawah `Kegiatan:`/`Catatan:`/`Sparepart:` (tanpa baris kosong) = daftar isi kegiatan, bukan
  alat baru — kecuali judulnya jelas judul alat (memuat `|`, `#2`, atau awalan `SN`).
- Tanda format WA (`*Status:*`, `_…_`, `~…~`) dibuang sebelum label dibaca.
- `Jumlah Tes` harus angka (titik/koma ribuan dibuang). `Pergantian Sparepart: -`/`Tidak ada` = tanpa penggantian.
- SN cukup 4–6 digit terakhir; dicari di antara alat milik faskes itu. Nomor plan + RS/SN sekaligus → dicek silang,
  tak cocok → bot bertanya, tidak menebak.
- Label tak dikenal / blok tanpa status → bot membalas contoh format (bukan diam). Blok yang gagal dicocokkan tetap
  disimpan dengan tanda `perlu_cek`; blok lain jalan terus.
- Report bisa dikirim sebagai caption foto.

**Foto:** foto dengan caption nomor blok (`1`, `2`) atau digit SN → terikat ke alat itu; foto tanpa caption dalam
jendela waktu sesudah report (pola penjodohan lampiran #KORAN) → foto kunjungan umum.

**Balasan bot** merinci per alat:
```
✅ RSUD Trenggalek — 2 alat tercatat
1. Zybio EXC200 (…0832) · PM · Selesai
2. Mindray BS-240 (…1194) · Service · Pending sparepart
```

## Pencocokan

- **Pengirim**: `master_user` role Teknisi (resolveSender ketat). Satu identitas — `teknisi_capacity` sejak 246 sudah
  cermin master_user, `matchTeknisi` dipakai hanya untuk shortcut lama.
- **Faskes**: `account_id` via pencocok nama faskes yang sudah ada (inti nama + kota, lihat jebakan nama Accurate terbalik).
- **Alat**: `kso_asset` (`sn_key`, `account_id`, nama/type alat) lalu `installation_unit.serial_number`; urutan kandidat
  = alat di faskes itu. Alat BELI yang belum ada di DB → `perlu_cek` (celah populasi, lihat sumber Populasi Alat).
- **Rujukan otomatis per item plan**: Jadwal Rutin bulan itu (account + teknisi), jadwal PM jatuh tempo (unit), tiket
  servis terbuka (nomor `T-` atau unit+faskes), jadwal install aktif (unit).

## Efek dari report

| Jenis + Status | Efek |
|---|---|
| PM · Selesai | `jadwal_rutin` faskes bulan itu → selesai (bila semua alat terjadwal di sana selesai); `maintenance_schedule` unit → done + jatuh tempo berikutnya |
| Service · Selesai | tiket servis → resolved (catatan = Kegiatan); SLA = jam tiket masuk → jam report |
| Install · Selesai | `install_schedule` → done; langkah unit maju sesuai urutan yang ada (tak melompat langkah) |
| apa pun · Pending/Revisit | item tetap terbuka, masuk daftar Pending dengan alasan |
| apa pun · Batal, ATAU item plan tak dilaporkan s/d batas | masuk **Plan Tidak Realisasi** + alasan (tak dilaporkan = "tanpa laporan") |
| `Jumlah Tes` | disimpan per alat per tanggal (bahan produktivitas KSO) |

Efek ke tabel modul Aftersales (`maintenance_schedule`, `service_ticket`, `install_schedule`, `installation_unit`) hanya
aktif bila tabelnya ada — main belum punya modul itu; Jadwal Rutin (F154) dan `kso_asset` sudah di main.

## Data (rancangan, migrasi baru)

Terpisah dari `sales_plan` / `activity_log` supaya metrik kunjungan sales tak tercampur.

- `teknisi_plan_item` — teknisi (am_id), tanggal, urutan, account_id, faskes_teks, alat (kso_asset_id / installation_unit_id),
  sn_teks, alat_teks, jenis, ref (jadwal_rutin_id, maintenance_schedule_id, service_ticket_id, install_schedule_id),
  wa_message_id, is_late, submitted_at.
- `teknisi_kunjungan` — header report: teknisi, tanggal, account_id, faskes_teks, catatan, wa_message_id, reported_at.
- `teknisi_kunjungan_alat` — per alat: kunjungan_id, plan_item_id, alat ref, sn_teks, jenis, status, alasan, kegiatan,
  jumlah_tes, sparepart, perlu_cek, catatan_cocok.
- `teknisi_kunjungan_foto` — kunjungan_id, kunjungan_alat_id (nullable), media_path.

## Tahapan

1. **Fase 1** — parser #PLAN/#REPORT teknisi + routing role Teknisi ke jalur baru; tabel di atas; pencocokan faskes/alat/rujukan;
   efek otomatis; Plan Tidak Realisasi (job harian); foto per alat; perbaikan `reportPerOrang`/compliance untuk teknisi.
   `#install/#servis/#training/#kalibrasi` tetap jalan sebagai shortcut (format baris sama dengan #REPORT).
2. **Fase 2** — draf #PLAN otomatis tiap sore ke teknisi (Jadwal Rutin + PM jatuh tempo + tiket terbuka wilayahnya +
   jadwal install); balas `ok` = plan terkirim. Saklar default mati.
3. **Fase 3** — tab **Plan & Report** di Readiness Board (plan vs realisasi per teknisi/hari, Pending, Tidak Realisasi,
   rekap SLA), menggantikan "Laporan Terbaru"; Google Form dipensiunkan.

## Keputusan

- 6 Nov 2026 (user): format #REPORT berlabel per kunjungan (usulan user: Kegiatan / Jumlah Tes / Pergantian Sparepart /
  Catatan / Foto) + identitas alat + Status; dukung dua cara identitas (nomor plan ATAU RS/Alat/SN); banyak alat satu
  faskes = blok bernomor dalam satu pesan.
- **Belum diputuskan**: foto wajib untuk jenis tertentu (PM/Install)? · urutan kerja terhadap promosi modul Aftersales ke main.

## Status pembangunan

**Fase 1 bagian 1 (8 Nov 2026)** — di belakang saklar `TEKNISI_PLAN_REPORT_ENABLED` (default mati; mati = Teknisi
tetap lewat format sales seperti sebelumnya):
- Migrasi `291_teknisi_plan_report.sql`: empat tabel di bagian Data. Rujukan ke tabel modul Aftersales bertipe `uuid`
  tanpa FK, supaya migrasi bisa dipromosikan sebelum modul itu sampai main.
- Parser `parsers/teknisi.ts` (+ tes): #PLAN, #REPORT tiga bentuk, alias label/jenis/status, galat yang jelas.
  Format salah = **tidak disimpan sama sekali**, bot membalas daftar galat + contoh.
- `repo/teknisi-plan-report.ts`: pencocokan faskes (`accountIdDariTulisan`), alat (`kso_asset` lewat SN penuh/ekor
  3–6 karakter atau nama alat di faskes itu; potongan SN alfanumerik di kolom alat ikut dicoba sebagai SN; lalu
  `installation_unit` bila kolom `account_id`-nya ada), rujukan `jadwal_rutin` bulan itu. Kirim ulang #PLAN mengganti
  item yang belum dilaporkan. Nomor plan + SN yang menunjuk alat berbeda → tak ditautkan ke mana pun, `perlu_cek`.
  Report sebagai caption foto → foto kunjungan umum. Report ganda (wa_message_id sama) diabaikan.
- Routing di `inbound.ts` sebelum syarat "daftar bernomor" jalur sales.
- `reportPerOrang` (plandash): Teknisi dibaca dari `teknisi_plan_item` bila ada isinya, kalau tidak dari `sales_plan`
  (sebelumnya salah dibaca dari counter `sales_todo` → ≈0). `unmatched` Teknisi = alat `perlu_cek`.

**Fase 1 bagian 2 (8 Nov 2026):**
- Efek `#REPORT` (`repo/teknisi-efek.ts`, saklar **`TEKNISI_EFEK_ENABLED`** default mati, terpisah dari saklar jalur WA):
  PM Selesai → `jadwal_rutin` bulan itu `selesai` hanya bila semua SN di snapshot `alat`-nya sudah dilaporkan PM
  Selesai bulan itu (kalau belum: "x/y alat selesai") + `maintenance_schedule` unit maju satu siklus; Service Selesai →
  satu-satunya tiket terbuka faskes itu `resolved` (lebih dari satu = tak ditutup, "tutup manual"); Install Selesai →
  `install_schedule` unit `done` (langkah training/BAST tak dilompati). SQL langsung, bukan memanggil modul Aftersales,
  dijaga `to_regclass` — supaya bisa dipromosikan sebelum modul itu sampai main. Alat `perlu_cek` tak diberi efek. Hasil
  disimpan di `teknisi_kunjungan_alat.efek` (migrasi `293`) dan tampil di balasan (`↳ …`).
- Plan Tidak Realisasi: job `teknisi-tidak-realisasi` (09:00 WIB, saklar `TEKNISI_TIDAK_REALISASI_ENABLED`, cron
  `TEKNISI_TIDAK_REALISASI_CRON`) menandai item plan tanggal < hari ini yang tak dilaporkan; view
  `teknisi_plan_tidak_realisasi_v` = itu + alat yang dilaporkan Batal.
- Foto: foto dari pengirim yang sama ≤30 menit SEBELUM teks report ikut jadi foto kunjungan; foto susulan ≤30 menit
  sesudahnya → kunjungan terakhir teknisi itu (caption `1`/`2` = blok, ekor SN = alat itu, lainnya = foto umum).
- Shortcut `#install/#servis/#training/#kalibrasi` yang memuat baris `Status:` → jalur per alat dengan jenis dari
  hashtag; teks bebas lama tetap ke `teknisi_report`.

**Belum:** pencocokan tiket per nomor (tabel tiket tak punya nomor `T-`; `tiket_teks` hanya disimpan), Fase 2 (draf plan
otomatis), Fase 3 (tab Plan & Report di Readiness Board).

**Perbaikan parser (13 Nov 2026):** label bertanda tebal WA, baris kosong di dalam blok, Kegiatan berupa daftar
bernomor, dan contoh balasan bot kini memuat bentuk banyak alat. Nomor tiket `T-` dihapus dari contoh (sistem belum
punya nomor itu); parser tetap menerimanya.
