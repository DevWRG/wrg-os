# F45 — Pickup Pre-Visit Verification (SHIPPING)

Jadwal trip tim Kirim-Tagih + pengecekan otomatis H-1 (hari libur & PIC
customer) supaya kurir tidak berangkat sia-sia ("rebound trip").

- **Domain**: SHIPPING · FR-ES-45 · Tier R1 · SHOULD · Sprint B2
- **Owner (board)**: Rizal, Karib, Adi, Munir, Anas, Dimas — terkonfirmasi 5 dari
  6 ada di tabel `employee` dengan `dept='kirimtagih'` (Rizal & Karib SPV Admin
  Cabang merangkap Kirim-Tagih, Munir Madiun, Dimas Malang, Adi/Kadek SBY 2 +
  Driver Gudang Pusat). "Anas" tidak ada di roster 63 karyawan.
- **Menu**: `/pickup-plan` — "Jadwal Kirim-Tagih" (section Operations, RBAC key
  `pickup-plan`)
- **Migrasi**: `infra/postgres/init/150_pickup_plan.sql`

## 1. Masalah yang diselesaikan

Kurir berangkat ke faskes, ternyata tutup (libur nasional / cuti bersama /
akhir pekan) atau tidak tahu harus menemui siapa → pulang tanpa hasil, dan
pengiriman/penagihan mundur. Sebelum fitur ini, jadwal trip kurir **tidak ada
sama sekali di sistem** (lihat poin 3), jadi tidak ada apa pun yang bisa
diperiksa lebih dulu.

## 2. Keputusan desain

### "Extends F14" = kalender libur + backup PIC — dua-duanya sudah ada

Deskripsi board menyebut dependency "F14". F14 bukan kode/skema, hanya baris
backlog `MAGANG-FEATURES.md`: **"Kalender Libur + Backup PIC"**. Keduanya sudah
tersedia di `dev`, jadi F45 tinggal memakainya, tidak membangun dari nol:

- `master_holiday` (migrasi 011, di-seed 069/070: 17 libur nasional + 8 cuti
  bersama 2026) — sudah dipakai `isWorkday()` di scheduler.
- `crm_contact` (migrasi 056, F62 — sudah merge ke `dev`) — multi-PIC per
  account; `is_primary` menandai yang utama, sisanya jadi kandidat **backup**.

### Tabel sendiri (`pickup_plan`), bukan kolom di `shipment_tracking` (F12)

1. `shipment_tracking` melacak siklus hidup SATU SJ dan semua kolom waktunya
   pasca-kejadian. Kolom `eta_date` yang dulu ada malah sudah di-DROP di migrasi
   077 atas arahan Direktur ("kosongin ETA-nya dulu saja") — menambah tanggal
   rencana ke situ berarti memutar balik keputusan itu.
2. **Trip "tagih" sering tanpa SJ sama sekali** (ambil faktur / tagih
   pembayaran). Kalau jadwal nempel ke SJ, jenis trip itu tak bisa dijadwalkan —
   padahal justru yang paling rawan rebound (PIC keuangan tak di tempat).
3. Satu trip bisa mampir beberapa customer; satu SJ bisa diantar di trip mana
   pun. Relasinya bukan 1-1.

Konsekuensi bagus: branch F45 **standalone dari `dev`**, bisa merge tanpa
menunggu F12/F42/F93 — tidak menambah tumpukan branch bertingkat.

### `account_id` di-resolve SEKALI saat plan dibuat, bukan fuzzy saat cron jalan

Form menyediakan picker akun (dari `/accounts`, sekalian menampilkan jumlah PIC
tiap akun). Pilihan itu disimpan sebagai `account_id`. **Sengaja tidak**
fuzzy-match nama customer saat cron berjalan: migrasi 068 sudah mencatat
jebakannya — beberapa faskes punya nama **sama persis** (cabang berbeda), dan
resolver fuzzy yang ada (`inbound.ts resolveActivityLinks`, `pg_trgm >= 0.45
LIMIT 1`) tidak punya guard keunikan, jadi PIC bisa nempel ke akun yang salah.
`account_id` NULL → verifikasi PIC **dilewati dan dilaporkan apa adanya**, bukan
ditebak.

### ⚠️ Batas yang jujur: ketersediaan PIC TIDAK diverifikasi

`crm_contact` tidak punya kolom jam kerja / hari aktif / cuti PIC (data cuti
hanya ada untuk staf internal di `user_leave`). Jadi fitur ini **tidak bisa**
memastikan "PIC-nya ada di tempat besok". Yang dilakukan:

- **Dipastikan**: tanggal trip jatuh di hari libur nasional / cuti bersama /
  akhir pekan.
- **Disodorkan, bukan dipastikan**: PIC utama beserta backup-nya, supaya kurir
  punya nomor kedua kalau yang pertama tak menjawab.

Pesan WA-nya ditutup disclaimer eksplisit. **Jangan** ubah teksnya jadi
mengesankan ketersediaan PIC sudah dicek.

## 3. Fakta yang mendasari (hasil investigasi, bukan asumsi)

- **Tidak ada tabel jadwal kurir/pickup/jemput apa pun** di 86+ tabel. Konsep
  "pickup" maupun "retur" belum pernah ada di sistem.
- `sales_plan` **bukan** milik Kirim-Tagih: gate role-nya eksplisit di
  `apps/api/src/repo/inbound.ts` (`AM_ROLES = {AM, Teknisi}`); role lain jatuh
  ke `sales_todo`, yang tidak punya kolom customer sama sekali.
- `shipment_tracking` tidak punya tanggal rencana — status `draft` berarti
  "belum dikirim", tanpa informasi kapan direncanakan.

## 4. Cara kerja

- **Tabel** `pickup_plan`: `tanggal` (rencana), `customer_name` (teks bebas,
  konsisten dgn `shipment_tracking`), `account_id` (FK opsional ke
  `accurate_customer`), `cabang`, `tujuan` (CHECK `kirim|tagih|kirim+tagih`),
  `sj_number` (opsional, teks bukan FK), `kurir_name`, `kurir_wa_number`,
  `status` (CHECK `rencana|selesai|batal`), plus hasil verifikasi
  (`previsit_notified_at`, `previsit_catatan`, `previsit_bermasalah`).
- **Cron `previsit-check`** (`apps/api/src/repo/pickup-plan.ts`
  `runPreVisitCheck`), default `0 16 * * *` = 16:00 WIB ≈ 24 jam sebelum.
  Predikat `tanggal = <besok WIB> AND status='rencana' AND
  previsit_notified_at IS NULL` — pola sama `am_reminder` mode `h-minus-1`
  (`repo/reminder.ts getDue()`).
- **⚠️ Tanggal "besok" dihitung di JS berbasis WIB, BUKAN `current_date + 1`
  di SQL.** Container Postgres ber-timezone `Etc/UTC`, jadi `current_date`
  adalah tanggal UTC. Dengan cron default 16:00 WIB (= 09:00 UTC) keduanya
  kebetulan sama — tapi kalau `PREVISIT_CHECK_CRON` digeser ke pagi (mis.
  06:00 WIB = 23:00 UTC hari sebelumnya), `current_date + 1` akan menunjuk
  HARI INI menurut WIB: salah tanggal tanpa error apa pun. Karena itu helper
  `besokWib()` dipakai (pola sama `wibDate()` di `scheduler.ts`), sehingga
  jadwal cron boleh diubah ke jam berapa pun tanpa merusak korektness.
  Catatan: `repo/reminder.ts` masih memakai `current_date + 1` mentah —
  aman untuk jadwalnya sekarang (17:00 WIB), tapi punya jebakan laten yang
  sama kalau jadwalnya digeser ke pagi.
- **Pengelompokan per kurir**: satu kurir menerima SATU pesan berisi semua
  stop-nya, bukan satu pesan per customer. Kunci grup = nomor yang sudah
  **dinormalisasi** (`normalizeWa`, sama seperti `master_user.wa_number`) dan
  nomor juga disimpan ternormalisasi saat POST/PATCH — kalau pakai string
  mentah, `628…` dan `0812-…` milik orang yang SAMA jadi 2 grup, dan kurir
  menerima 2 pesan yang masing-masing cuma memuat sebagian stop.
- **Kalender yang belum diisi tidak dilaporkan "aman"**: `master_holiday` baru
  di-seed untuk 2026. Kalau plan bertanggal di tahun yang belum ada barisnya,
  hasilnya `bermasalah: true` dengan catatan "kalender libur <tahun> belum
  diisi → cek manual" — bukan "aman". Tidak ada libur ≠ kalendernya ada.
- **UI membedakan "sudah dicek" dari "sudah diberi tahu"** — 3 state di kolom
  Cek H-1: `belum dicek`, `belum terkirim` (hasil cek tersimpan tapi WA gagal /
  di-skip karena tanpa tujuan), dan `aman`/`perlu perhatian`. Tanpa pembedaan
  ini, plan tanpa nomor kurir tampil hijau "aman" padahal kurirnya tak pernah
  menerima apa pun.
- **Anti-broadcast**: plan tanpa `kurir_wa_number` masuk grup fallback env
  `PREVISIT_WA_TARGET`; kalau env itu juga kosong → **tidak dikirim** dan
  ditandai `skipped: "no-target"`. Tidak pernah fallback diam-diam ke grup
  besar (pola F24/F50, dan insiden 8 Jul 2026 yang tercatat di
  `sales-analytics-alert-eval.ts`).
- **Retry-safe**: `previsit_notified_at` di-set **hanya** kalau WA benar-benar
  terkirim; gagal kirim → tidak ditandai, cron besok mencoba lagi. Hasil
  verifikasi (`previsit_catatan`/`previsit_bermasalah`) tetap disimpan walau WA
  gagal, supaya tetap terlihat di UI.
- **Reset saat tanggal digeser**: PATCH `tanggal` mengosongkan ketiga kolom
  verifikasi — hasil lama tak berlaku untuk tanggal baru (pola F50
  `stnk_alert_sent_at` di-reset saat `stnk_expiry` diperbarui).
- **SENGAJA tidak dibungkus `isWorkday()`**: justru gunanya memperingatkan bahwa
  BESOK libur. Kalau di-gate hari kerja, peringatan "besok cuti bersama" tak
  akan pernah terkirim di hari terakhir sebelum libur panjang — persis kasus
  yang paling bikin rebound trip. `reminder-h`/`h-1` juga tidak di-gate.

### Env

| Env | Default | Fungsi |
|---|---|---|
| `PREVISIT_CHECK_ENABLED` | `false` | Nyalakan job (default mati, seperti job WA lain) |
| `PREVISIT_CHECK_CRON` | `0 16 * * *` | Jadwal cek H-1 (WIB) |
| `PREVISIT_WA_TARGET` | *(kosong)* | Tujuan fallback untuk plan tanpa nomor kurir. Kosong = tidak dikirim |

### Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/pickup-plan` | Daftar (filter `status`/`from`/`to`/`limit`) |
| POST | `/pickup-plan` | Buat jadwal |
| PATCH | `/pickup-plan/:id` | Ubah status/tanggal/catatan/nomor kurir |
| DELETE | `/pickup-plan/:id` | Hapus |
| GET | `/pickup-plan/:id/previsit` | Pratinjau verifikasi (tanpa kirim WA, tanpa menandai) |
| POST | `/pickup-plan/previsit/run` | Trigger manual cron — mengembalikan `tanggal` target + `message` tiap batch (pola `runReminders`) untuk diperiksa. Body opsional `{"tanggal":"YYYY-MM-DD"}` untuk recovery kalau cron terlewat semalam |

## 5. Hasil pengujian lokal

- Pengelompokan per kurir: 3 plan / 2 kurir → 2 batch (1 dan 2 stop). ✅
- Deteksi libur: plan 2026-08-17 → `"libur": "HUT Kemerdekaan RI"`,
  `bermasalah: true`. ✅
- Deteksi akhir pekan: plan 2026-08-01 (Sabtu) → peringatan akhir pekan. ✅
- PIC utama + backup: akun dengan 2 kontak → utama (Kepala Bagian Pengadaan) +
  `↳ backup:` (Staf Farmasi). ✅
- `account_id` NULL → "PIC: belum ada di data — cari kontaknya dulu sebelum
  berangkat", tanpa menebak akun. ✅
- Anti-broadcast: plan tanpa nomor kurir & `PREVISIT_WA_TARGET` kosong →
  `skipped: "no-target"`, 3 dari 4 plan ternotifikasi. ✅
- Idempotensi: run kedua → `count: 0`. ✅
- Geser tanggal → `previsit_notified_at`/`catatan`/`bermasalah` ter-reset. ✅
- Validasi input: tanggal bukan `YYYY-MM-DD`, `customer_name` kosong/spasi,
  `tujuan` di luar 3 nilai → 400 dengan pesan jelas. ✅
- Normalisasi nomor: plan dengan `6289580690991` dan `0895-8069-0991` (orang yang
  sama) → **1 batch berisi 2 stop**, keduanya tersimpan sebagai `6289580690991`. ✅
- Tahun tanpa kalender: plan 2027-01-01 → `kalender_ada: false`,
  `bermasalah: true`, catatan "kalender libur 2027 belum diisi → cek manual"
  (bukan "aman"). ✅
- UI 3-state: plan tanpa nomor kurir → badge **"belum terkirim"** +
  "sudah dicek, WA belum terkirim", bukan hijau "aman". ✅
- Input tak wajar tidak lagi 500: `?limit=abc` → 200 (fallback default),
  `?from=xx` → 400, `?status=ngawur` → 400, id bukan-UUID pada
  PATCH/DELETE/previsit → 404, `tanggal=2026-13-45` → 400 (lolos regex tapi
  ditangkap cek round-trip `isIsoDate`). ✅
- Scheduler: `PREVISIT_CHECK_ENABLED=true` → log `[scheduler] aktif` memuat
  `previsit-check=0 16 * * *`, dan `/agents/schedule` melaporkan
  `enabled: true` (wiring 3 tempat di `scheduler.ts` benar). **Catatan:**
  `status.jobs` di `/agents/schedule` hanya memuat agen A1–A12, jadi
  `previsit-check` TIDAK akan terlihat di daftar `jobs` endpoint itu —
  verifikasinya lewat log startup. Env uji sudah dikembalikan. ✅
- Typecheck · lint · build: bersih. Data uji sudah dihapus.

### Catatan implementasi yang sengaja dipertahankan

- **Select → send → mark tanpa row-claim.** `runPreVisitCheck` membaca himpunan
  due, mengirim, baru menandai — tanpa `FOR UPDATE SKIP LOCKED`. Kalau cron
  16:00 dan trigger manual berjalan bersamaan, kurir bisa menerima pesan dua
  kali. Dibiarkan karena bentuknya identik `repo/reminder.ts` (konsistensi
  repo) dan trigger manual **tidak punya proxy BFF**, jadi tak bisa dipicu dari
  browser — hanya lewat API langsung. Kalau nanti tombol "kirim ulang" ditaruh
  di UI, pola claim wajib ditambahkan lebih dulu.
- **Izin `can_create/can_edit/can_delete` tidak ditegakkan di BFF mutasi.**
  Celah ini repo-wide (tidak ada satu pun gate `can(…, 'delete')` di
  `apps/web`), jadi F45 mengikuti keadaan yang ada, bukan memperkenalkan
  regresi. Gate yang aktif: RBAC per-fitur (`pickup-plan`) untuk akses menu.

## 6. Belum dikerjakan / mungkin ditanyakan Direktur

1. **"customer-calendar" ditafsirkan sebagai kalender libur nasional** (sesuai
   F14 = "Kalender Libur"). Kalau yang dimaksud sebenarnya **jadwal terima
   per-customer** (mis. RS X hanya menerima barang Senin–Kamis, jam 08–12), itu
   perlu tabel baru `customer_receiving_window` + pengisian data per faskes —
   belum ada di sistem dan belum dikonfirmasi.
2. **Jadwal masih diisi manual** lewat web. Board tidak menyebut hashtag WA
   (kolom Hashtag "—"), jadi tidak ada pemicu WA untuk membuat jadwal. Kalau
   nanti diminta, polanya bisa mengikuti `#KIRIM`/`#BAST` F12.
3. **Ketersediaan PIC tidak diverifikasi** — lihat poin 2. Menutup gap ini
   butuh data jam kerja/PIC pengganti per faskes, yang harus diisi manusia.
4. Keluhan tim Kirim-Tagih yang terekam di `053_seed_employee_spine.sql`
   sebetulnya lebih banyak soal **kesiapan internal** (SJ & faktur terbit lambat,
   stok cito tak ready, NCS telat) daripada customer tutup. F45 tidak menyentuh
   itu — worth dikonfirmasi apakah prioritas Direktur memang di sisi ini.
