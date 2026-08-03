# Memory — Sesi Setup Onboarding Magang & Local Dev (wrg-os)

> Catatan: file ini **untracked** (bukan bagian repo), sengaja disimpan lokal
> supaya kalau laptop dimatikan & besok lanjut kerja, tidak perlu ulang dari
> nol. Lihat juga `technical.md` untuk detail perintah teknis.

## Konteks

Ada percakapan sebelumnya (sebelum file memory ini dibuat) yang membahas:
1. Membaca materi onboarding anak magang.
2. Menjalankan project `wrg-os` di lokal + seed database.

**Penting:** percakapan itu tidak tersimpan sebagai riwayat yang bisa saya baca
ulang persis kata-katanya — saya (Claude) merekonstruksi state-nya dari kondisi
repo saat ini (file yang ada, git status, versi software terinstall), bukan
dari transkrip asli. Jadi kalau ada detail keputusan yang tidak tercermin di
kondisi file/repo, itu bisa hilang — tanyakan ulang ke user kalau perlu.

## Yang sudah dipastikan (2026-07-28)

### 1. Materi onboarding magang
- Google Drive folder yang diberikan **privat** — tidak bisa diakses langsung
  (redirect ke login Google). Belum ada otorisasi MCP Google Drive di sesi ini.
- Fallback: 4 file yang diminta **sudah ada secara lokal** di root repo
  (`ONBOARDING.md`, `MAGANG-FEATURES.md`, `Onboarding-Magang.html`,
  `gen-magang-features.py`) — status **untracked** di git (bukan bagian resmi
  repo, konsisten dengan isi `ONBOARDING.md`/README arsip: dokumen ini memang
  sengaja dipindah keluar dari repo GitHub per Direktur, disimpan di Drive).
- Root `README.md`: **SUDAH DIPUTUSKAN** (bukan lagi pending) — user pilih
  commit versi "arsip Drive". Sudah di-commit di branch
  `chore/readme-onboarding-drive-note` (belum di-push/PR, "simpan lokal dulu").
  **Update 2026-07-29**: user sadar README working tree `dev` waktu itu ternyata
  BUKAN versi magang (itu versi arsitektur asli) — user manual replace jadi
  versi arsip-Drive lagi (dicek: identik 100% dgn commit `adcc067` di branch
  `chore/...`). Diputuskan **biarkan uncommitted** (sama seperti `scripts/dev.mjs`
  di bawah). Jadi working tree `dev` SEKARANG: `README.md` = arsip-Drive
  (uncommitted).

### 2. Instalasi & setup lokal — **SELESAI, project SUDAH JALAN** (update setelah eksekusi lanjutan)
| Komponen | Status |
|---|---|
| Docker Desktop | ✅ v29.6.2, engine jalan |
| WSL2 | ✅ v2.7.11.0 |
| Node.js | ✅ **v25.6.1** (dipindah dari v20.20.2 via `nvm use 25.6.1` — pnpm@11.5.2 butuh Node ≥22.13) |
| pnpm | ✅ v11.5.2 (install via `npm install -g pnpm@11.5.2`, corepack tidak bundle di Node 25) |
| `.env` | ✅ dibuat, `PG_PASSWORD=wrg_dev_pw`, `DATABASE_URL` port 5433 |
| Postgres (Docker) | ✅ jalan & healthy (`wrg-postgres`, port 5433), **sudah di-seed** |
| `pnpm install` | ✅ selesai |
| api (Hono) | ✅ jalan di **http://localhost:4000** |
| web (Next.js) | ✅ jalan di **http://localhost:3000** |
| services/ai (FastAPI) | ✅ jalan di **http://localhost:8000** (venv Python terpisah, bukan bagian pnpm workspace) |
| User admin pertama | ✅ dibuat: `you@wahanalifeline.co.id` / `rahasia123` |

Ketiga service (api/web/ai) jalan sebagai **background process di sesi Claude
ini** — kalau laptop/terminal ditutup, prosesnya mati dan perlu di-start ulang
manual (tidak ada auto-start di lokal). Command restart cepat: lihat
`technical.md` bagian "Restart cepat".

**Bug yang ditemukan & di-fix:** `scripts/dev.mjs` gagal di Windows native
(`spawn turbo ENOENT`) karena `spawn()` tanpa `shell:true` tidak resolve
wrapper `.CMD` — sudah ditambal (`shell: process.platform === "win32"`).
**Perubahan ini belum di-commit** — lihat bagian keputusan di bawah.

Detail perintah & troubleshooting lengkap: lihat `technical.md`.

## Keputusan yang SUDAH diambil user (2026-07-28)

- **README.md → commit versi "arsip Drive" (bukan revert).** Sudah di-commit
  di branch `chore/readme-onboarding-drive-note` (commit `docs: ganti README
  jadi arsip Drive onboarding magang`). **Belum di-push, belum ada PR** — user
  pilih "simpan lokal dulu". Branch aktif sekarang balik ke `dev` (README di
  working tree `dev` tetap versi asli/arsitektur, karena perubahan itu cuma
  ada di branch `chore/...`, belum merge). Kalau user minta push/PR kapan-kapan,
  tinggal: `git push -u origin chore/readme-onboarding-drive-note` lalu
  `gh pr create --base dev`.
- **Fix `scripts/dev.mjs` (Windows spawn bug) → JANGAN commit dulu.** Tetap
  uncommitted di working tree branch `dev` (perubahan ini tetap aktif dipakai
  selama dev server jalan, cuma belum resmi tercatat di git). Kalau laptop
  restart / `git stash`/`git checkout scripts/dev.mjs` sembarangan, fix ini
  bisa hilang dan bug `spawn turbo ENOENT` muncul lagi — kalau itu terjadi,
  re-apply fix yang sama (lihat [[wrg-os-local-dev-setup-progress]] poin 6).
- Otorisasi Google Drive MCP: belum ditanyakan ulang, masih pakai salinan lokal.

**Ringkasan tegas soal "apa yang diubah":** kode aplikasi (`apps/api`,
`apps/web`, `services/ai`) TIDAK PERNAH disentuh sepanjang sesi ini. Yang
diubah cuma 2: (1) `scripts/dev.mjs` (1 baris, bug fix Windows, lihat atas),
dan (2) `README.md` (commit terpisah, lihat atas). Semua perbaikan menu
dashboard (lihat bagian "Seed lanjutan" di bawah) murni lewat data seed SQL,
BUKAN via ubah kode.

## Seed lanjutan — perbaikan 4 menu yang dilaporkan kosong/error (2026-07-28)

Setelah seed awal (62 tabel), user cek dashboard & lapor 4 hal:
**HITL Review error saat dibuka**, **Visits kosong**, **WatchPoint → HoD
kosong/NA**, **NPK Direktur kosong**. Semua diinvestigasi (bukan asumsi) dan
ternyata **fitur-nya lengkap** — akar masalah selalu di data seed:

1. **HITL Review** benar-benar CRASH (bukan cuma kosong): payload JSON seed
   `{"demo":true,...}` tak cocok bentuk yang di-expect frontend → akses field
   undefined. **Fixed**: payload diganti ke bentuk valid.
2. **Visits kosong**: halaman baca `sales_plan.visit_lat/lon`, BUKAN tabel
   `visit` yang di-seed awal (`visit` ternyata gak pernah dibaca sama sekali).
   **Fixed**: isi koordinat geo + 2 baris baru.
3. **WatchPoint HoD NA** (5 dari 8 HoD): tabel `watchpoint_metric` (metric
   manual per-HoD) cuma ada data utk 1 HoD (husni). **Fixed**: tambah 16 baris
   utk mufid/arman/pakMuhid/ika/fafa.
4. **NPK Direktur kosong**: data cuma ada period S1, default tampilan sistem
   sekarang (bulan≥7) = S2. **Fixed**: tambah data 6 HoD + period S2.

Semua perbaikan ada di file `scripts/db/seed-dev-full.sql` (sudah di-update,
masih idempoten). **Detail teknis lengkap termasuk 1 gap yang SENGAJA tidak
dipaksa-fix (structural, bukan lupa): lihat `technical.md` bagian "Perbaikan
4 menu".**

## F22 / F24 / F26 / F8 — 4 fitur AFTERSALES dikerjakan (2026-07-29)

Direktur assign 4 fitur ke user (via item board Roadmap): **F22 Instalasi
Alat Lifecycle**, **F24 PM & Kalibrasi Schedule**, **F26 Service Ticket
Triage (LLM-assisted)**, **F8 Teknisi Readiness Board**. Semua
diimplementasikan penuh dalam sesi ini (kode + verifikasi lokal + dokumentasi
`docs/features/*.md`). Detail teknis lengkap tiap fitur: lihat `technical.md`
bagian "Fitur F22/F24/F26/F8" DAN file `docs/features/F22-*.md` /
`F24-*.md` / `F26-*.md` / `F8-*.md` (ini SUDAH ter-commit di git, beda dari
`memory.md`/`technical.md` yang untracked).

**Struktur branch (PENTING, gampang bingung — makin dalam sejak F8):**
```
dev
 └─ feat/f22-instalasi-alat-lifecycle   (F22 inti + integrasi SJ↔Accurate)
      └─ feat/f24-pm-kalibrasi-schedule  (F24, DI ATAS F22 — butuh installation_unit)
           └─ feat/f8-teknisi-readiness-board  (F8, DI ATAS F22+F24 — butuh keduanya)
 └─ feat/f26-service-ticket-triage       (F26, dari dev LANGSUNG — standalone, tak nyambung F22/F24/F8)
```
Konsekuensi urutan PR: **F22 duluan** → baru **F24** (rebase dulu) → baru
**F8** (rebase lagi, dari `dev` yg sudah include F22+F24). **F26 bebas
kapan saja** (tak nyambung sama sekali ke 3 lainnya).

**Status per 2026-07-29 (akhir sesi):**
- **F22**: **push** + **PR #679** dibuka (`dev` ← `feat/f22-instalasi-alat-lifecycle`), status "Ready to merge". Item Roadmap di-**convert jadi Issue #680**, di-link via `Closes #680`. Nunggu Direktur approve+merge.
- **F26**: **sudah push** ke origin (`feat/f26-service-ticket-triage`), **PR BELUM dibuka** (tinggal buka via link yang dikasih `git push`). Sempat direview manual → ketemu 2 bug (area matching exact-case tanpa fallback, severity invalid didefault diam-diam) → **sudah diperbaiki** (commit `749cacf`) SEBELUM push.
- **F24**: **sudah push** ke origin (`feat/f24-pm-kalibrasi-schedule`). User SADAR F22 belum merge (dicek eksplisit: `git merge-base --is-ancestor` → belum ada di `dev`) tapi TETAP MINTA buka PR sekarang ("nanti waktu meeting aku kasih tahu" ke Direktur soal dependensi F22→F24 ini). Aku sudah kasih link+judul+body PR (termasu section BUTUH MIGRASI DB utk `069_maintenance_schedule.sql`) — **TAPI BELUM ADA KONFIRMASI BALIK** apakah PR-nya benar-benar sudah ke-submit di GitHub. Kalau sesi depan user tanya soal ini, JANGAN asumsikan sudah dibuka — cek dulu (minta user share link/nomor PR, atau kalau ada akses cek langsung).
- **F8**: commit lokal saja (`feat/f8-teknisi-readiness-board`, commit `e467f3c`), **BELUM push**. Nunggu F22 **dan** F24 merge → rebase → push+PR. WA hashtag pipeline-nya **sudah diverifikasi LIVE sungguhan** (beda dari F26) — lihat memory auto-save `wrg-os-f8-teknisi-readiness-board` utk detail.

**Sesi DITUTUP 2026-07-29 malam.** Branch aktif TERAKHIR: `feat/f24-pm-kalibrasi-schedule`.
**SEMUA service (api/web/ai) MATI** saat sesi ditutup (proses background ikut
kepotong pas laptop/terminal ditutup) — besok WAJIB restart manual dari nol,
lihat technical.md bagian "Restart cepat". Kalau sesi baru lanjut kerja di
F22/F24/F26/F8 (branch beda-beda), **WAJIB `git checkout <branch>` dulu**
lalu clear cache `apps/web/.next` (`rm -rf apps/web/.next`) + restart
`pnpm dev` — Next.js App Router nyimpen daftar route per-branch, kalau
pindah branch tanpa clear cache, `tsc`/dev server bisa error "Cannot find
module .../page.js" nyariin route yang cuma ada di branch lain. Lihat
`technical.md` utk detail persis.

**Alur PR (buat magang baru pertama kali, dicatat biar sesi depan tak
ngulang tanya dari nol):**
1. Push branch: `git push -u origin <branch>`.
2. Buka PR via link yang dikasih git push, base=`dev`, judul+body ikut
   `ONBOARDING.md` (F-number di judul, section "⚠️ BUTUH MIGRASI DB" kalau
   nambah file `infra/postgres/init/*.sql`).
3. Kalau item Roadmap masih **status "Draft"** (bukan Issue asli, cek badge
   di panel detail item) → klik **"Convert to issue"** dulu di panel itu,
   baru punya nomor `#`.
4. Edit deskripsi PR, tambah baris `Closes #<nomor issue>` → GitHub otomatis
   link dua arah (kolom "Linked pull requests" di board keisi otomatis).
5. Push barengan sama rekan kerja **aman** — `git push` cuma ngirim branch
   sendiri, tidak nyentuh branch orang lain. Konflik cuma bisa muncul nanti
   pas MERGE (bukan pas push) kalau 2 fitur ubah baris yang sama.
6. `gh` CLI **TIDAK terinstall** di laptop ini — semua langkah PR di atas
   lewat web UI GitHub manual, bukan `gh pr create`.

## Meeting Direktur (2026-07-30) — hasil & fitur baru di-ACC

Direktur sudah mengecek F22/F24/F26 (belum ada kabar merge balik di sesi ini
— jangan asumsikan sudah di-merge, tanya user kalau perlu). Sambil nunggu,
Direktur **ACC user lanjut kerja 3 fitur baru**: **F12** (Tracking Pengiriman
Digital), **F42** (SJ→BAST→TTF Closed-Loop Tracker), **F93** (Delivery Proof
Capture) — urutan pengerjaan **F12 → F42 → F93** (lihat memory auto-save
`wrg-os-jobdesk-roadmap` utk alasan urutan). **F45** (Pickup Pre-Visit
Verification) sengaja BELUM dikerjakan — nunggu waktu senggang user.

**Keputusan penting dari rapat (F12) yang mengubah desain awal:**
- **TTF diabaikan total** — kata Direktur langsung: "hiraukan aja, pakai yang
  BAST aja." State machine F12 cuma 2 transisi (draft→dikirim→bast), BUKAN 3
  spt hashtag awal (#BAST #TTF #KIRIM) menyarankan.
- **ETA dari jarak (km), BUKAN integrasi Maps real-time.** Business Dev di
  rapat: jarak cabang→customer "dianalisa" manual (bukan geocoding hidup),
  terus estimasi waktu dihitung LANGSUNG dari km itu (bukan input manual
  per-hari oleh driver). Ini konfirmasi eksplisit menjawab pertanyaan yang
  disiapkan sebelum rapat (lihat `wrg-os-jobdesk-roadmap`).

## F12 — Tracking Pengiriman Digital: SELESAI (2026-07-30)

Branch `feat/f12-tracking-pengiriman-digital`, dari `dev` langsung (standalone,
tak nyambung F22/F24/F26/F8). **Sudah commit** (`2983f85`), **belum
push/PR**. Detail teknis lengkap: `docs/features/F12-tracking-pengiriman-digital.md`
dan `technical.md` bagian "F12".

Ringkas: tabel baru `shipment_tracking` (migrasi `068_shipment_tracking.sql`
— nomor 068 dipakai ULANG dari lineage lain, lihat catatan penomoran
per-lineage di bagian F22/F24/F26/F8 di bawah), state machine
draft→dikirim→bast, dipicu WA hashtag `#KIRIM`/`#BAST [SJ_no]` (match by
sj_number, reuse pola `inbound.ts`) ATAU manual via halaman
`/shipment-tracking`. ETA dihitung dari `distance_km` (manual input Admin
Shipping) via formula ballpark `ceil(km / 250)` hari — **ASUMSI**, belum ada
angka speed resmi dari Direktur, gampang di-tweak lewat env
`SHIPPING_ETA_KM_PER_DAY`. Sudah ditest lokal end-to-end (create → kirim →
bast via WA hashtag simulasi, termasuk skenario SJ tak ditemukan) — semua
lolos, data uji sudah dihapus. Typecheck + lint + `next build` semua clean.

**Lanjut ke F42 setelah ini** (extend state machine F12 yang baru dibuat, jadi
BUKAN branch baru dari `dev` — kemungkinan besar dilanjut di branch F12 ini
juga atau branch baru di atas F12, mirip pola F22→F24).

### Koreksi PENTING (2026-07-30, sama hari): `distance_km` seharusnya OTOMATIS

User baca ulang transkrip rapat & sadar interpretasi awal saya soal ETA
SALAH: kata terakhir Biz Dev di rapat — "ngambil starting point-nya di mana,
terus ke mana, gitu. Dari situ aja" — berarti km dihitung OTOMATIS dari
koordinat cabang→customer, **BUKAN** Admin Shipping ngetik angka km manual
tiap bikin tracking (yang saya bangun kemarin). User SENGAJA belum mau saya
implementasi versi otomatisnya — 2 pertanyaan sumber koordinat (titik A
cabang, titik B customer) belum ada jawaban, dan user pilih **tanya
Direktur/Biz Dev dulu** drpd saya tebak. Sudah didokumentasikan sbg ⚠️ open
item di `docs/features/F12-tracking-pengiriman-digital.md` poin 3 + placeholder
warning di UI form. **JANGAN implementasi geocoding/tabel koordinat apa pun
sebelum user balik dgn jawaban dari Direktur** — state machine kirim→BAST
(bagian utama F12) sudah selesai & tidak kena dampak, cuma cara isi
`distance_km` yang nunggu revisi.

## F42 — BLOCKED, belum mulai coding (2026-07-30)

User kasih deskripsi resmi board F42: state flow 5 langkah "kirim → terima →
BAST sign → faktur titip → ttf cair", hashtag #SJ #BAST #TTF, owner Diana +
Karib + Rizal + tim "Kirim-Tagih" (bukan cuma Diana spt F12 — sinyal F42
nyentuh proses billing/AR, bukan cuma shipping). **Ketemu 2 kontradiksi vs
keputusan F12 kemarin** (TTF katanya diabaikan, tapi F42 malah butuh TTF; +
5 state tapi cuma 3 hashtag disebut) — **user PILIH TANYA DIREKTUR DULU utk
KEDUANYA**, saya belum mulai desain tabel/state machine apa pun. Detail
lengkap pertanyaan: lihat memory auto-save `wrg-os-jobdesk-roadmap` bagian
"F42 — BLOCKED". **JANGAN mulai coding F42 sebelum user konfirmasi sudah
dapat jawaban Direktur.**

## F50 — Kendaraan Operasional Log: SELESAI (2026-07-30)

Sambil nunggu jawaban Direktur soal F42/F45, user pilih kerjakan F50 (OPS,
tak ada blocker/dependency asing). Branch `feat/f50-kendaraan-operasional-log`
dari `dev` langsung (standalone). **Sudah commit** (`b061b07`), **belum
push**. Detail lengkap: `docs/features/F50-kendaraan-operasional-log.md`.

Ringkas: tabel `vehicle` (master 7 mobil — SENGAJA diseed SQL, bukan halaman
CRUD, ikut konvensi magang "data kecil = seed" yg sudah disepakati sebelumnya)
+ `vehicle_log` (transaksional km/BBM/service). Alert km-based utk service
due, H-30 utk STNK expiry (cron opsional, default off). **Data 7 mobil ASLI
belum diisi** — cuma ada seed dummy dev (`scripts/db/seed-vehicle-dev.sql`),
perlu Direktur/Fafa kasih data plat nomor sungguhan sebelum go-live. Sudah
ditest lokal (add service log → status ke-reset, PATCH STNK → alert
ke-reset, validasi log_type invalid → 400), typecheck+lint+build clean.

## F45 — BLOCKED, dependency "F14" tak ada sama sekali (2026-07-30)

Deskripsi board F45 sebut "Extends F14" (bot cek customer-calendar 24 jam
sebelum visit + saran backup PIC, anti rebound trip/gagal jemput). Saya
kirim Explore agent cari F14 di SELURUH branch git + docs + kode + skema DB
— **hasilnya nihil total**, F14 tidak eksis di manapun (bukan cuma belum
merge — genuinely tak pernah ada). User pilih **tanya Direktur dulu** drpd
saya bangun customer-calendar/backup-PIC dari nol tanpa tau F14 itu apa.
**0% coding, full blocked.**

**Status akhir sesi ini: F12 (state machine inti selesai, distance_km
pending), F42 (blocked), F93 (belum disentuh, nunggu F42), F45 (blocked)** —
semua 4 fitur SHIPPING yg di-ACC Direktur kena macet nunggu jawaban. F50
(OPS) dikerjakan sbg alternatif sambil nunggu (lihat bagian di atas).

## F12 — jawaban Direktur PARSIAL masuk soal koordinat customer (2026-07-30, lanjutan)

Direktur konfirmasi titik B (customer): "ambil dari whatsapp aja mas,
setelah kirim foto terkirim, ditandai dengan hastag mas" — CONFIRMED foto
ber-geotag + hashtag (reuse infra Geo-Tagging Camera AM, sesuai dugaan).
**Tapi 2 hal masih belum jelas** (user pilih tanya ulang Direktur, saya
JANGAN nebak): (1) hashtag/step mana yg bawa foto itu — `#KIRIM` atau
`#BAST`? Logikanya `#BAST` (baru fisik di lokasi customer), tapi belum
dikonfirmasi eksplisit. (2) **Titik A (koordinat cabang) MASIH SAMA SEKALI
belum ditanyakan** — user baru sadar ini kelewat pas dapat jawaban titik B.
Detail lengkap: memory auto-save `wrg-os-jobdesk-roadmap`. **JANGAN mulai
implementasi capture-geo apa pun sebelum kedua hal ini jelas.**

## F42 — jawaban Direktur masuk (TTF diabaikan juga), SELESAI dikerjakan (2026-07-30)

Direktur konfirmasi eksplisit: F42 alurnya "cukup sampai BAST aja, tidak
pakai TTF" — jadi keputusan "abaikan TTF" dari F12 kemarin berlaku JUGA di
F42, bukan cuma khusus F12 (menjawab kontradiksi yg ditemukan sebelumnya).
Pertanyaan sisa soal state "terima" (gak ada hashtag WA-nya di board) —
user pilih **lanjut pakai default saya** (manual via web) drpd tanya ulang.

Branch `feat/f42-sj-bast-closed-loop-tracker` **DI ATAS branch F12**
(sama pola F22→F24). Commit `887efec`, belum push. Detail:
`docs/features/F42-sj-bast-closed-loop-tracker.md`. Ringkas: extend tabel
`shipment_tracking` (bukan tabel baru) — tambah state `terima` di antara
`dikirim` dan `bast`. `markBast()` sekarang WAJIB dari status `terima`
(bukan `dikirim` lagi) — kalau kurir kirim `#BAST` sebelum "terima"
ditandai (manual, web), sistem tolak dgn balasan error, bukan crash.
Ditest end-to-end lokal (guard reject di semua kombinasi salah urutan,
WA hashtag `#KIRIM`/`#BAST` masih jalan dgn guard baru), typecheck+lint
clean, data uji sudah dihapus.

**F93 sekarang bisa mulai** (dependency-nya F12+F42 sudah ada) — tapi
belum dikerjakan sesi ini.

## F12 — jawaban FINAL Direktur soal koordinat, RESOLVED (2026-07-30, lanjutan hari yang sama)

Setelah 2 iterasi jawaban parsial (yg sempat bikin bingung "lompat-lompat"),
Direktur kasih jawaban final yang jelas: **"#KIRIM itu posisinya start dari
mana, biar kelihatan. Terus #BAST juga lokasi customernya. Biar nanti bisa
dicek analitiknya sesuai jaraknya, kesesuaiannya."** Ini artinya:
- `#KIRIM` + foto ber-geotag → capture titik AWAL (dinamis per shipment,
  BUKAN dari tabel referensi cabang — otomatis nge-resolve pertanyaan
  "koordinat cabang dari mana" yang sempat blocking).
- `#BAST` + foto ber-geotag → capture titik CUSTOMER.
- `distance_km` (haversine) + `eta_days` (durasi AKTUAL kirim→bast) dihitung
  OTOMATIS begitu kedua titik ada — buat analitik POST-HOC ("kesesuaian"
  jarak vs waktu), BUKAN kasih customer estimasi di awal seperti desain lama.

**Saya implementasikan di branch F12 sendiri** (bukan F42) krn ini
resolusi open item F12 sendiri — commit `7832d92`. Field `distance_km`
dihapus dari form create, formula `computeEta`/`SHIPPING_ETA_KM_PER_DAY`
lama dihapus, kolom `eta_date` di-drop (redundan), kolom baru
`kirim_lat/kirim_lon/bast_lat/bast_lon` ditambah.

**Lalu di-rebase ke F42** (`git rebase feat/f12-... ` dari branch F42) —
ada 1 conflict di `shipment-tracking.ts` (guard status F42 vs logic geo F12
di fungsi `markBast` yang sama) & di header komentar, **berhasil digabung
manual** (guard "harus dari terima" + hitung geo sekaligus). Migrasi F42
(`terima`) ikut di-renumber 069→**070** krn F12 sekarang punya migrasi 069
sendiri (geo) — commit `7f2585a`. Ditest ulang kombinasi F12+F42 penuh:
kirim(geo)→terima→bast(geo) → `distance_km`/`eta_days` ke-hitung otomatis,
guard "terima" tetap jalan. Typecheck+lint+build semua clean setelah rebase.

**Bug ketemu & difix pas testing**: lupa update route `POST
/shipment-tracking/:id/kirim` dan `/bast` di `index.ts` — repo function
`markKirim`/`markBast` sudah terima param `lat`/`lon` tapi route HTTP-nya
belum diteruskan ke situ, jadi geo selalu `null` walau body request sudah
kirim koordinat. Ini murni "lupa satu layer" (repo diupdate, HTTP route-nya
kelewat) — worth diingat kalau nambah param baru ke fungsi repo yang sudah
dipanggil dari route: cek SEMUA layer (repo → route → (kalau ada) web
proxy) ikut diupdate, jangan cuma yang paling gampang keliatan.

## ⚠️ GAP BARU ketemu (2026-07-30, pas jelasin alur ke user): ETA upfront HILANG

Waktu jelasin alur F12 ke user, user sadar sendiri: desain final (geo dari
`#KIRIM`/`#BAST`, jarak dihitung SETELAH BAST) **sama sekali gak menjawab
masalah awal F12** — deskripsi fitur sebut keluhan customer nanya "estimasi
sampai berapa hari" SEBELUM kirim (`Bu Luri NTT: Lion Parcel estimasi
seminggu kah??`). Sekarang `eta_days` cuma durasi AKTUAL (post-hoc), bukan
estimasi upfront — jadi pertanyaan customer itu TETAP TAK TERJAWAB oleh
sistem. Ini bukan bug implementasi, tapi gap DESAIN yang baru kesadari
setelah semua jawaban Direktur diimplementasikan.

User pilih **tanya Direktur lagi** (bukan asumsi saya).

**✅ RESOLVED (2026-07-30, sama hari): Direktur jawab "kosongin ETA-nya
dulu saja".** Artinya ETA upfront ke customer SENGAJA ditunda/tidak
dibangun sekarang — bukan gap yang perlu ditutup buru-buru. Implementasi
yang sudah ada (form create tanpa input jarak, kolom "Jarak & Durasi
(aktual)" tampil kosong sampai BAST selesai) **SUDAH SESUAI, tak perlu
diubah**. Kalau nanti Direktur minta ETA upfront lagi (mis. dari data
historis per customer), itu jadi fitur BARU terpisah, bukan revisi F12 ini.

## F93 — Delivery Proof Capture: SELESAI (2026-07-30)

Branch `feat/f93-delivery-proof-capture` DI ATAS branch F42 (yang DI ATAS
F12) — pola F22→F24→F8. Commit `a56cc79`, belum push. Detail:
`docs/features/F93-delivery-proof-capture.md`.

**Ketemu kontradiksi lagi di deskripsi board** (sama pola F42/F45
kemarin): teks bilang hashtag `#KIRIM [SJ_no] + photo + signature scan`,
tapi field Hashtag sebut `#KIRIM #BUKTI` (2 hashtag) dan konteks lain
("bukti TERIMA", "audit BAST") jelas nunjuk momen BAST bukan KIRIM. User
pilih **#BUKTI, dipasang di momen BAST** (langsung percaya rekomendasi
saya, gak perlu iterasi tanya-jawab ke Direktur kayak F42/F45).

Ringkas implementasi: extend `shipment_tracking` (4 kolom baru:
`bukti_photo_path`, `signature_photo_path`, `bukti_at`, `bukti_by`) —
BUKAN state baru di state machine (status tetap `bast`, cuma nempel
field). `markBukti()` guard status harus `bast`, isi 2 slot foto
berurutan (foto 1 → bukti, foto 2 → signature; kurir kirim 1 foto
gabungan pun valid, slot signature boleh kosong). Slot ketiga → ditolak.
WA hashtag `#BUKTI` TANPA geo (beda dari `#KIRIM`/`#BAST` yang geo-nya
dipakai hitung jarak F12). "Auto-attach ke Accurate mirror" dari
deskripsi board TIDAK diartikan literal (mirror READ-ONLY) — cuma nempel
ke `shipment_tracking` yang udah link logical ke SJ Accurate, sama pola
F12. Ditest end-to-end (guard sebelum bast, 2 slot, slot penuh ditolak,
WA hashtag jalan), typecheck+lint+build clean.

**Semua 4 fitur SHIPPING/OPS yang di-ACC Direktur (F12, F42, F93)
sekarang SELESAI.** F45 masih blocked ("F14" gak ketemu).

## Sesi DITUTUP 2026-07-30 malam — status akhir & peta branch lengkap

**SEMUA service (api/web/ai) MATI** saat sesi ditutup (proses background
ikut kepotong pas laptop/terminal ditutup) — besok WAJIB restart manual
dari nol, lihat `technical.md` bagian "Restart cepat". **Branch aktif
TERAKHIR: `feat/f93-delivery-proof-capture`.**

### Peta branch lengkap (dicek langsung via `git ls-remote` + `merge-base`, bukan asumsi)

```
dev (origin)
 ├─ feat/f22-instalasi-alat-lifecycle   [PUSHED, PR #679 dibuka] — NOT merged ke dev
 │    └─ feat/f24-pm-kalibrasi-schedule  [PUSHED, PR dibuka] — NOT merged ke dev
 │         └─ feat/f8-teknisi-readiness-board  [commit lokal SAJA — TIDAK ADA di remote sama sekali]
 ├─ feat/f26-service-ticket-triage       [PUSHED] — NOT merged ke dev, PR belum dibuka
 ├─ feat/f12-tracking-pengiriman-digital [PUSHED, PR dibuka user] — NOT merged ke dev
 │    └─ feat/f42-sj-bast-closed-loop-tracker  [PUSHED, PR dibuka user] — NOT merged
 │         └─ feat/f93-delivery-proof-capture  [PUSHED, PR BELUM dikonfirmasi dibuka
 │              user — user minta deskripsi PR tapi belum bilang "udah aku PR"
 │              kayak F12/F42. JANGAN asumsikan sudah dibuka, tanya dulu.]
 └─ feat/f50-kendaraan-operasional-log   [commit lokal SAJA (`b061b07`) — TIDAK
      ADA di remote, belum di-push. Standalone dari dev, gak ada dependency.]
```

**F22/F24/F26 masih ditahan Direktur** (review, belum ada kabar merge —
sudah beberapa sesi, jangan asumsikan progress tanpa tanya user dulu).

### Yang SELESAI sesi ini (2026-07-30)
- **F12 Tracking Pengiriman Digital** — state machine draft→dikirim→bast,
  geo-capture otomatis dari foto #KIRIM/#BAST (jawaban final Direktur,
  setelah 3 iterasi klarifikasi), ETA upfront sengaja dikosongkan (arahan
  eksplisit Direktur). PR sudah dibuka user.
- **F42 SJ→BAST Closed-Loop Tracker** — tambah state `terima`, TTF
  dikonfirmasi diabaikan juga di sini. PR sudah dibuka user.
- **F93 Delivery Proof Capture** — hashtag `#BUKTI` (dikoreksi dari teks
  literal board yg bilang `#KIRIM`), 2 slot foto (bukti+signature) nempel
  setelah status `bast`. **Push sudah, PR BELUM dikonfirmasi dibuka.**
- **F50 Kendaraan Operasional Log** — standalone OPS, master 7 mobil
  (seed, bukan CRUD), alert km-based + STNK H-30. **Belum di-push sama
  sekali** — data 7 mobil produksi asli juga belum diisi (nunggu
  Direktur/Fafa).

### Yang BLOCKED, belum dikerjakan
- **F45 Pickup Pre-Visit Verification** — dependency "F14" dicari lewat
  Explore agent di SELURUH git history, TIDAK KETEMU sama sekali. User
  pilih tanya Direktur dulu, belum ada jawaban balik per akhir sesi ini.

### Kalau sesi besok lanjut kerja fitur baru (PURCHASING F37/F38, GA F132 dst)
Cek dulu `wrg-os-jobdesk-roadmap` (auto-memory Claude) buat urutan &
pertanyaan yang sudah disiapkan. Kalau lanjut branch existing, WAJIB
`git checkout <branch>` dulu + `rm -rf apps/web/.next` + restart proses
(kill process tree, `TaskStop` doang TAK CUKUP — lihat `technical.md`).

## SESI 2026-07-31 — renumber migrasi + investigasi F37/F38 (BACA INI DULU)

### 1. Semua nomor migrasi fitur SUDAH BERUBAH (jangan pakai angka lama)

`dev` bergerak 10 commit (2× sync main→dev + F1-SPT pipeline 7 tahap +
Price Book F142 + klasifikasi produk + Simulator KSO) dan sekarang memakai
slot **068–075**. Semua branch fitur kena tabrakan & sudah direnumber:

| Fitur | Nomor LAMA | Nomor SEKARANG |
|---|---|---|
| F12 tabel `shipment_tracking` | 068 | **076** |
| F12 geo | 069 | **077** |
| F42 state `terima` | 070 | **078** |
| F93 bukti+signature | 071 | **079** |
| F50 `vehicle`+`vehicle_log` | 068 | **080** |

F12/F42/F93 sudah **di-rebase ke `dev` terbaru + force-push** (3 PR yang
terbuka otomatis ter-update). F50 sudah direbase+renumber tapi **masih
lokal, belum di-push** (menunggu keputusan user).

⚠️ **Deskripsi PR di GitHub masih menyebut nama file LAMA** di section
"⚠️ BUTUH MIGRASI DB" (mis. `068_shipment_tracking.sql`) — perlu diedit
manual oleh user, `gh` CLI tidak ada di laptop ini.

Konflik rebase yang muncul selalu sama & sepele: `apps/web/src/lib/nav.ts`
baris import icon lucide (dev nambah `BookOpen`/`Calculator`, fitur kita
nambah `Route`/`Car`) → gabung dua-duanya, bukan pilih satu.

### 2. F37 Cross-Branch Stock Visibility — TIDAK BISA dikerjakan sekarang

- **"Extends F2 SQC" itu dependency fantom** — "SQC" dicari di 1.185 commit
  seluruh branch, docs, skema, nama file: NOL (satu-satunya string "SQC" =
  kebetulan base64 di `pnpm-lock.yaml`). F2 juga tak ada di daftar fitur mana
  pun. Lebih parah dari kasus F14 (F14 setidaknya ada judulnya).
- **Stok per-gudang tidak ada & tidak bisa ditambal**: `accurate_item` cuma
  punya 1 angka agregat (`quantity`/`available` dari `availableToSell`,
  migrasi 035) dgn PK `id` TUNGGAL → struktural mustahil simpan breakdown
  per gudang. `accurate_branch` praktis kosong (kolom `name` tak pernah
  diisi, tak ada `syncBranches()`, `accurate_invoice.branch_id` semua = 50 —
  lihat komentar `apps/api/src/repo/sales.ts:76-78`). Tak ada tabel
  warehouse/gudang sama sekali di 86+ tabel.
- Puller Accurate manggil 10 endpoint, **nol** yang soal gudang/mutasi stok.
  Belum terverifikasi apakah kredensial WRG bisa akses endpoint gudang &
  apakah modul multi-gudang aktif di tenant mereka.
- "Real-time" juga tak didukung — mirror ini batch pull (cron 6×/hari).

**Perlu jawaban Direktur**: (a) F2 SQC itu apa, (b) stok per gudang sumbernya
dari Accurate (perlu endpoint baru) atau input manual tim gudang.

### 3. F38 ED Watch & Near-Expiry Alert — BISA, tapi datanya harus dibuat sendiri

- Data ED/batch/lot **nol di seluruh repo** (dicek juga di 6 branch fitur
  lain, termasuk F36 Inbound Receiving yang paling logis punya kolom ED —
  ternyata cuma checklist teks bebas tanpa item_id/qty/batch).
- Tapi itu konsisten dgn kenyataan: seed HR `053` merekam pengakuan staf
  gudang sendiri — *"dokumen SP/SJ (manual lot-ED)"*, *"Akurasi stok &
  lot-ED"*, KPI *"Barang expired → 0"*. Owner F38 di board = orang-orangnya:
  **Yugi** (Admin Gudang/PJ Barang reagen), **Denys** (Staf Inventory),
  **Pita** (Leader Supply Chain).
- **Self-contained** — bikin registri batch sendiri, tak nunggu jawaban soal
  API Accurate. Ini bedanya dari F37.
- Pola alert sudah matang: **F50 STNK H-30** bentuknya nyaris identik
  (ambang hari-mundur + `*_alert_sent_at` per-baris + reset saat data
  diperbarui). Untuk 3 tier 90/60/30 pakai pola edge-trigger
  `sales-alert-eval` (`last_state`) — JANGAN pola F24 (`due_date =
  current_date + 14`, kesamaan persis) krn alert hilang permanen kalau cron
  mati sehari.
- 2 keputusan desain (tak wajib tanya Direktur): **"KSO first"** tak punya
  flag otoritatif (cuma `deal.coop_model='KSO'` TEXT bebas, atau histori
  faktur `raw->detailItem->charField1='KSO'` — dua-duanya inferensi);
  **"ED-short to trial"** — konsep trial/demo/konsinyasi TIDAK ADA di sistem,
  jadi `suggested_allocation` sebaiknya jadi *output rekomendasi* saja.
- **Insight urutan**: karena stok tak punya dimensi batch MAUPUN gudang,
  tabel F38 mau tak mau memuat batch+qty+gudang → **F38 justru membangun
  ledger yang F37 butuhkan**. Kerjakan F38 dulu dgn tabel dirancang
  sadar-F37, F37 nanti tinggal nambah view/halaman.

### 4. F45 ternyata JAUH lebih tidak-blocked dari perkiraan

"F14" itu **ADA** — `MAGANG-FEATURES.md:49` → **"Kalender Libur + Backup
PIC"**. Sesi lalu kelewat karena file itu untracked, jadi Explore agent yang
cuma nyisir git history tak melihatnya. **Pelajaran: kalau nyari kode fitur,
jangan cuma git grep — cek juga file untracked di root.**

Dua fondasinya sekarang SUDAH ADA di `dev`:
- `master_holiday` — sudah di-seed 17 libur nasional + 8 cuti bersama 2026
  (migrasi dev 069/070), ada halaman `/holidays`, sudah dipakai `isWorkday()`.
- `crm_contact` (F62, **sudah merge ke dev**) — multi-PIC per customer,
  lengkap `is_primary`, `role_deal`, `hp_wa`. Itu persis substrat "backup
  PIC suggest".

Sisa gap tinggal 1 pertanyaan sempit: "customer-calendar" itu libur nasional
(sudah ada) atau jadwal-terima per-customer (belum ada)?

### 4b. F45 Pickup Pre-Visit Verification — SELESAI (2026-07-31)

Branch `feat/f45-pickup-pre-visit-verification`, **standalone dari `dev`**
(bukan di atas F12/F42/F93 — bisa merge sendiri). Commit **`a80a393`** (satu
commit bersih hasil amend: 6 temuan review digabung SEBELUM push, pola sama
F26), migrasi **081_pickup_plan.sql**. **Belum di-push.** Detail penuh:
`docs/features/F45-pickup-pre-visit-verification.md`.

Ringkas: tabel baru `pickup_plan` (jadwal trip Kirim-Tagih: tanggal,
customer, `tujuan` kirim/tagih/kirim+tagih, kurir + nomor WA, opsional
`sj_number`) + cron `previsit-check` (default `0 16 * * *`, gate
`PREVISIT_CHECK_ENABLED`) yang mengecek H-1: hari libur (`master_holiday`)
+ PIC utama & backup (`crm_contact`), lalu kirim WA per-kurir.

**Kenapa tabel sendiri, bukan kolom di `shipment_tracking`** (dipilih user
setelah saya sodorkan trade-off): trip "tagih" sering TANPA SJ dan justru
paling rawan rebound; kolom `eta_date` di `shipment_tracking` sudah di-DROP
di 077 atas arahan Direktur jadi jangan diputar balik; satu trip bisa
mampir beberapa customer. Bonusnya branch jadi standalone.

**Keputusan yang WAJIB dijaga kalau fitur ini disentuh lagi:**
- `account_id` di-resolve SEKALI di form (picker akun), **BUKAN fuzzy-match
  saat cron jalan** — migrasi 068 mencatat ada faskes bernama SAMA PERSIS
  (cabang beda) & resolver fuzzy `inbound.ts resolveActivityLinks` tak punya
  guard keunikan. `account_id` NULL = PIC dilewati apa adanya, bukan ditebak.
- **Ketersediaan PIC TIDAK diverifikasi** — `crm_contact` tak punya kolom jam
  kerja/cuti PIC. Yang dipastikan cuma hari libur; PIC utama+backup cuma
  disodorkan. Pesan WA ditutup disclaimer — **jangan diubah** jadi
  mengesankan PIC sudah dicek.
- Cron **SENGAJA tidak** dibungkus `isWorkday()` — justru gunanya
  memperingatkan besok libur. Kalau di-gate, peringatan "besok cuti bersama"
  tak akan pernah terkirim di hari terakhir sebelum libur panjang.

Owner board terkonfirmasi 5/6 di tabel `employee` semuanya
`dept='kirimtagih'` (Rizal, Karib, Munir, Dimas, Adi/Kadek); "Anas" tak ada
di roster 63.

**Open item** (di dokumen fitur poin 6): "customer-calendar" ditafsirkan
sebagai kalender libur nasional sesuai F14. Kalau Direktur maksudnya
**jadwal terima per-customer** (mis. RS X cuma terima Senin–Kamis jam 8–12),
itu butuh tabel baru + pengisian data per faskes — belum ada & belum
dikonfirmasi.

### 5. Kondisi lingkungan akhir sesi ini
Branch aktif: **`feat/f45-pickup-pre-visit-verification`** (standalone dari
dev). DB lokal sudah disinkronkan — migrasi dev **068–075** + **081** (F45)
diterapkan; `master_holiday` 25 baris. api :4000 + web :3000 jalan;
**uvicorn ai TIDAK dinyalakan** (tak dibutuhkan). Typecheck·lint·build hijau
di F93, F50, dan F45.

**Peta branch per akhir sesi 2026-07-31:**
```
dev (origin, migrasi s/d 075)
 ├─ F12 [PUSHED+PR, migrasi 076+077]  → F42 [PUSHED+PR, 078]  → F93 [PUSHED+PR, 079]
 ├─ F50 [LOKAL saja, 080]
 ├─ F45 [LOKAL saja, 081]  ← standalone, siap push kapan pun
 ├─ F22 [PUSHED, PR #679] → F24 [PUSHED+PR] → F8 [LOKAL saja]
 └─ F26 [PUSHED, PR belum dibuka]
```
**Yang masih perlu user kerjakan manual**: edit deskripsi 3 PR (F12/F42/F93)
di GitHub — masih menyebut nama file migrasi LAMA di section "BUTUH MIGRASI
DB". `gh` CLI tak ada di laptop ini.

## SESI 2026-07-31 (lanjutan) — F37+F38 SELESAI & di-PR, bug gateway/importer disapu di F37+F50

### F37 Cross-Branch Stock Visibility — SELESAI, PUSH, PR dibuka
Ternyata bukan lagi blocked (bandingkan bagian "F37 TIDAK BISA dikerjakan
sekarang" di atas — itu sudah usang). Direktur kasih klarifikasi baru:
"F2" bukan dependency fantom, itu 1 menu fungsi cek-stok yang sudah ada (2
fungsi di 1 menu); dan daftar gudang cabang final **11**: Surabaya (1
gudang), Lamongan, Tuban, Jember, Kediri, Madiun, Madura, Jakarta,
Jogja&Solo, NTB, NTT — **gudang virtual di customer TIDAK ikut ditampilkan**
(arahan eksplisit Direktur). Migrasi **082_cross_branch_stock.sql**: tabel
`warehouse` (kolom `jenis` NOT NULL tanpa default, gerbang wajib di semua
query baca) + `item_stock_branch`. Importer `scripts/db/import_stock_branch.py`.
Sudah lewat review adversarial 2-model (Sonnet+Opus), **push + PR dibuka**
user (base=dev). Detail teknis lengkap: `technical.md` + memori auto-save
`wrg-os-f37-cross-branch-stock`.

### F38 ED Watch & Near-Expiry Alert — SELESAI, PUSH, PR dibuka
Dikerjakan **DI ATAS branch F37** (butuh tabel `warehouse` migrasi 082).
Tabel `item_stock_batch` (dimensi batch+ED, migrasi 083) + cron `ed-watch`
ambang **90/60/30/0** (tier 0 = sudah lewat, ditambah setelah review — tanpa
itu siklus alert normal berhenti bunyi tepat saat paling mendesak) + saran
alokasi (`retur`/`trial`/`kso`/`reguler`, KSO dari histori faktur
`charField1='KSO'` — PETUNJUK bukan kontrak). Tab ketiga "ED & Kedaluwarsa"
di `/inventory`. Lewat review adversarial 2-model, semua temuan diperbaiki +
diverifikasi empiris (termasuk gateway WA tiruan lokal buat buktikan jalur
live). **Di-rebase ulang ke F37 terbaru** (setelah F37 dapat fix importer,
lihat bawah) sebelum push — riwayat bersih, 0 konflik. **Push + PR dibuka
user, base=feat/f37-...** (bukan dev, karena depend migrasi 082 yang belum
merge — pola sama F22→F24→F8). Detail lengkap: `docs/features/F38-ed-watch-near-expiry.md`.

### 2 bug lintas-fitur ditemukan saat review F38, disapu ke F37+F50
Review F38 nemu 2 pola bug yang TERNYATA ada juga di fitur lain yang sudah
dibuat sebelumnya — user minta perbaiki, bukan cuma catat:
1. **`gateway.sent` bukan berarti WA terkirim** — `sendViaWaGateway` balikin
   `sent:true` juga di mode stub (`WA_SEND_URL` kosong) & dry-run
   (`WA_DRY_RUN` default `true`). Kalau dipakai syarat nulis penanda
   anti-spam tanpa filter tambahan, penanda ke-set walau WA nggak pernah
   terkirim → alert mati permanen begitu dry-run dimatikan. **F50
   (`runVehicleAlerts`) sudah diperbaiki** (`sent && !stub && !dryRun`,
   commit lokal, F50 belum ada PR jadi cukup commit baru tanpa force-push).
   **F45 (`runPreVisitCheck`) PUNYA BUG SAMA TAPI SENGAJA BELUM DIPERBAIKI**
   — PR-nya sudah dibuka & konsekuensinya "alert tak berbunyi" (bukan
   kehilangan data), jadi ditunda sebagai utang tercatat.
2. **Abort "0 SKU cocok" dicek di Python SETELAH psql commit** — importer
   F37 (sebelum diperbaiki) & F38 sama-sama kirim `BEGIN...COMMIT` sebagai 1
   blok ke psql, lalu Python cek hasil "cocok" SETELAH proses selesai —
   kombinasi dgn `--hapus-tak-disebut` bisa menghapus data lalu baru bilang
   gagal. **F37 sudah diperbaiki** (pindah ke `DO $$ ... RAISE EXCEPTION $$`
   di dalam transaksi + guard baru "qty kosong + `--hapus-tak-disebut`
   ditolak"), diverifikasi empiris via `docker exec psql` lokal: CSV SKU
   salah + `--apply --hapus-tak-disebut` → exit 1, 0 baris DB berubah.

**`gh` CLI masih tidak ada di laptop ini** — kedua PR (F37 revisi, F38 baru)
dibuka manual oleh user lewat link compare GitHub, deskripsi didraft Claude.

## SESI 2026-08-03 — domain grouping sidebar (9 branch), F37 Stok Gudang jadi route sendiri, F50 rebase+BBM+PR, F52 baru

### 0. Koreksi status vs catatan sesi lalu
F37/F38 **BELUM di-merge** ke `dev` per awal sesi ini (dicek langsung via
`git merge-base --is-ancestor` — jangan asumsikan dari histori chat lama).
`dev` sudah maju 42 commit sejak F37 di-branch (Price Book, KSO Simulator,
RBAC fix, dll) — migrasi terbaru `dev` waktu itu: `076_pricelist_price_list.sql`.

### 1. Direktur meeting: sidebar HARUS dikelompokkan per domain
Bukan lagi "menunggu konfirmasi" (lihat catatan lama F37 soal ini) — sudah
diputuskan. **Scope**: cuma domain jobdesk user (Aftersales/Purchasing/
Shipping/OPS), BUKAN seluruh sidebar (Sales/HR/Analytics/dst punya tim lain,
dibiarkan). **OPS tetap gabung ke section "Operations"** yang sudah ada (tak
perlu section sendiri) — beda dari Aftersales/Purchasing/Shipping yang dapat
section baru.

**Dikerjakan di 9 branch, pakai git worktree per-branch** (supaya dev server
yang lagi dipakai user testing di working tree utama TIDAK terganggu):
| Cluster | Branch (root → child) | Section baru |
|---|---|---|
| Aftersales | F22 → F24 (rebase) | "Aftersales" |
| Aftersales | F26 (standalone) | "Aftersales" (instance sendiri, beda dari F22/24 — akan konflik ringan pas salah satu merge duluan, itu wajar) |
| Shipping | F12 → F42 → F93 (rebase berantai, semua clean 0 konflik) | "Shipping" |
| Shipping | F45 (standalone) | "Shipping" (instance sendiri) |
| Purchasing | F37 → F38 (rebase) | "Purchasing" |

F22/F26/F12/F45/F37 = plain push (commit baru). F24/F42/F93/F38 = **force-push**
(rebase ubah history). Konflik nav.ts cuma di F24 (item F22 pindah section,
context línia F24 nunjuk berubah) — resolved manual, satu-satunya konflik dari
9 branch.

### 2. F37 — Inventory vs Stok Gudang, KOREKSI setelah salah paham
Iterasi pertama saya cuma bikin "Stok Gudang" jadi item nav baru yg nunjuk
`/inventory?tab=gudang` (query param buka tab langsung) — user tolak: **"ini
mah itungannya cuma ngeredirect"**. Yang dia mau: 2 ROUTE benar-benar terpisah.

**Fix**: `/inventory` balik ke bentuk asli pre-F37 (polos, section Operations,
tanpa tab). `/stok-gudang` jadi halaman BARU (section Purchasing, server
component fetch sendiri lewat `gatewayFetch`, key RBAC sendiri `stok-gudang`
— bukan lagi berbagi key `inventory`). Komponen lama `inventory-tabs.tsx`
DIHAPUS, isi tab "Per Gudang"-nya jadi `stock-gudang-view.tsx` berdiri
sendiri. **Pelajaran: kalau user bilang "pisah", defaultnya PISAH BENERAN
(route beda), bukan deep-link/tab — konfirmasi dulu kalau ragu, jangan
under-scope.**

F38 (di atasnya) kena treatment sama: tab ketiga "ED & Kedaluwarsa" jadi
route sendiri `/ed-watch` (section Purchasing juga). `EdWatchPanel` sudah
self-contained (fetch sendiri saat mount) dari awal, jadi dipindah apa
adanya — beda dari Stok Gudang yg perlu direfactor jadi server component.

### 3. Gudang "Jogja & Solo" dipisah jadi 2 (F37)
Awalnya diseed 1 gudang gabungan (`JOGJASOLO`) — user minta dipisah jadi
`JOGJA`/`SOLO` (12 gudang cabang total, dari 11). Karena kode gabungan itu
**belum pernah dirilis/dipakai** (masih di branch belum merge, 0 baris
`item_stock_branch` mereferensikannya), koreksinya **DIHAPUS langsung**
(bukan dinonaktifkan seperti pola `PUSAT`/`KEMANGI`/`SBY1` yang memang sempat
"hidup" duluan). Pelajaran: pola "jangan pernah DELETE, selalu deactivate"
itu utk melindungi data PRODUKSI yang sudah terlanjur pakai kode lama — kalau
kode itu sendiri belum pernah dirilis, DELETE aman & lebih bersih.

### 4. Semua fitur lain DICEK, tidak ada kasus sama seperti F37/F38
Setelah restructuring, user minta cek fitur lain punya masalah sama (tab
nempel di halaman existing yang tak terkait) atau tidak. Dicek via
`git diff --stat` semua 9 branch vs file2 Operations existing (products/
orders/shipments/suppliers/hitl) — **NOL** yang menyentuh. F37/F38 satu2nya
kasus karena `/inventory` satu2nya halaman yang sudah ada SEBELUM semua
fitur ini (mirror Accurate polos), yang lain semua bikin route baru dari
awal.

### 5. F50 — rebase ke dev terkini, ketemu BBM "hilang", tambah kolom, PUSH pertama
Direbase ke `origin/dev` (42 commit ketinggalan) — **0 konflik**, bersih total.
User cek web, kirain BBM tak diimplementasi ("aku cek tidak ada bbm") — padahal
SUDAH ada sejak awal, cuma tersembunyi di tombol ikon tanpa label (➕ buka form
isi BBM, 🕐 lihat riwayat). **Fix UX** (bukan fix bug): tambah kolom "BBM Bulan
Ini" (agregat SUM liter+biaya bulan berjalan, dihitung WIB di JS) di tabel
utama biar kelihatan sekilas. **Pelajaran: fitur yg "kelihatan hilang" belum
tentu bug — cek dulu apa beneran belum ada atau cuma UX-nya nggak jelas,
sebelum nulis kode baru.**

**F50 di-PUSH PERTAMA KALI** sesi ini (sebelumnya cuma commit lokal, tak
pernah ada di remote sama sekali). PR belum dibuka user per akhir sesi ini,
draft deskripsi sudah disiapkan Claude.

### 6. F52 IT Asset & Issue Tracker — fitur BARU, selesai penuh dari nol
Branch `feat/f52-it-asset-issue-tracker`, dari `dev` FRESH (bukan numpuk di
atas F37/F38/F50), migrasi **084** (slot bebas berikutnya setelah F38=083).

**2 keputusan desain dikonfirmasi user SEBELUM coding** (belajar dari
insiden Stok Gudang di atas — tanya dulu drpd under/over-scope):
1. Master aset IT via **CRUD web** (beda dari pola F50 vehicle yg seed-only)
   — krn jumlah PC/laptop lebih dinamis drpd 7 mobil statis.
2. "Kritis" (SLA 2 jam) = **flag PERMANEN per-aset** (`is_critical`), bukan
   pilihan manual per-tiket — PC Fakturis ditandai sekali, semua tiket dari
   situ otomatis SLA 2 jam.

**SLA "24/5"** — user klarifikasi maksudnya hari kerja (Senin-Jumat), BUKAN
jam kantor. Diimplementasi sbg `businessHoursFromNow()`: tiap hari kerja
dihitung 24 jam PENUH, weekend/`master_holiday` dilewati TOTAL (bukan cuma
jeda). Diverifikasi via test langsung (bypass HTTP): start Jumat 23:00 WIB +
2 jam kritis → **Senin 01:00 WIB** — cocok persis trace manual.

**Anti-broadcast + anti-false-positive gateway alert DIBANGUN BENAR SEJAK
AWAL** (bukan ditambal belakangan spt F37/F45/F50) — `sla_alert_sent_at`
cuma ditandai kalau WA `sent && !stub && !dryRun`.

**Digabung jadi 1 halaman (2 tab: Tiket/Aset), bukan 2 menu terpisah** —
awalnya saya bikin 2 route (`/it-assets` + `/it-tickets`), lalu user tanya
"ini ga bisa dijadikan satu kah?". Digabung jadi `/it-asset` satu route.
**Beda kasus dari F37/F38** (yang dipisah krn ARAHAN DOMAIN GROUPING
Direktur, tab digabung ke halaman ASING beda-fitur): Aset & Tiket F52
sama-sama domain OPS & fitur yang SAMA, jadi gabung 1 menu itu wajar &
BUKAN pelanggaran prinsip yang sama. **Pelajaran: prinsip "pisah per
domain" ≠ "semua tab harus jadi route sendiri" — cek dulu apa dua
konsep itu benar2 domain berbeda, atau cuma dua sub-view dari 1 fitur.**

Data dev-only diseed (`scripts/db/seed-it-asset-dev.sql`, 5 aset + 3 tiket
contoh) atas permintaan user biar bisa langsung dites di browser tanpa isi
form manual dulu.

**Status akhir sesi**: F37/F38 push (sudah lewat sebelumnya) + update baru
(domain grouping, split Stok Gudang/ED Watch, Jogja/Solo) sudah **di-push**.
F50 rebase+BBM+push (**push pertama**), PR belum dibuka. F52 **commit lokal
saja, BELUM push, BELUM ada PR** — kode lengkap (migrasi+repo+routes+cron+
web+docs), typecheck/lint bersih, tested end-to-end manual.

### 7. Gotcha baru sesi ini
- **`rm -rf apps/web/.next` sambil dev server MASIH JALAN bikin 500** —
  Turbopack nyari file yang baru dihapus. Kejadian pas saya buru-buru
  typecheck lalu lupa restart proses. Selalu kill process tree DULU, baru
  `rm -rf .next`, baru `pnpm dev` lagi — jangan rm sambil proses hidup.
- Docker Desktop **tidak auto-start** — kena pas awal sesi ini, perlu
  `Start-Process 'Docker Desktop.exe'` manual lewat PowerShell + poll
  `docker ps` sampai daemon respon (~30-60 detik).
- postgres.js: kombinasi `sql\`${sql.unsafe(str)} WHERE ...\`` (nyambung
  string mentah lalu lanjut interpolasi lagi) TIDAK reliable — lebih aman
  tulis ulang query lengkap drpd coba compose lewat `sql.unsafe`.

## SESI 2026-08-03 (lanjutan) — F52 push+PR draft, F53 baru (reuse label-asset), bug tabel disapu ke F50

### F52 push + draf PR
F52 di-push (pertama kali, `git push -u origin ...`). Draf deskripsi PR
disiapkan (pola sama F37/F38/F50: Apa&kenapa/Cara kerja/keputusan desain/
migrasi/pengujian).

### F53 Stiker Aset & Asset Tagging Audit — SELESAI, push+PR
Branch `feat/f53-stiker-aset-tagging-audit`, dari `dev` FRESH, migrasi
**085_asset_tag.sql**. **Sudah di-push, PR belum dibuka user.**

**Hasil konsultasi Direktur (user sampaikan sebelum minta mulai coding):**
1. F34 (aset revenue + rekonsiliasi Accurate, domain FINANCE) **dikonfirmasi
   genuinely terpisah** dari F53 — bukan dependency sama sekali, beres tanpa
   drama tanya-jawab spt F42/F45 dulu.
2. F53 tetap jalan (ranah GA/OPS), tak perlu nunggu F132.
3. **User kasih link repo GitHub `DevWRG/label-asset`** — tool standalone
   HTML ("WRG LifeLine · Sticker Printer") yang SUDAH dibuat sebelumnya
   utk generate stiker QR. Diminta REUSE, bukan bangun dari nol.

**Investigasi `label-asset`:** repo cuma isinya 1 file `index.html` (581KB,
180 baris tapi baris SANGAT panjang) — format "bundler artifact" (mirip
export dari tool Artifact) dgn manifest ter-embed. Berhasil dibongkar via
`node -e` extract `<script type="__bundler/template">` (isinya JSON-string
ter-escape, bisa di-`JSON.parse` jadi HTML biasa 488 baris). Dari situ
ketemu: (a) skema kolom NYATA yang tim GA pakai di Excel — kode
`WRG-<lokasi>-<kategori>-<urut>` (mis. `WRG-KMG-FRN-001`), jenis kepemilikan
Aset/Inventaris, kategori, lokasi cabang, letak; (b) desain visual stiker
("Jurassic Park inspired": strip navy "Jangan Dicabut" + QR + barcode
CODE128 + badge ASSET/INV); (c) mekanisme aslinya PASTE dari Excel (tanpa
DB, ephemeral, print via `window.print()`).

**2 keputusan dikonfirmasi user SEBELUM coding** (pelajaran F37 Stok Gudang
— tanya dulu drpd tebak scope):
1. **Terintegrasi ke DB** (bukan reuse tool lama apa adanya) — registry F53
   permanen, generate stiker dari situ, bukan copy-paste Excel tiap kali.
2. **Mulai kosong** — tidak ada file Excel data ASLI utk diimpor sekarang.

**Implementasi:** tabel `asset_tag` (kode manual — skema auto-generate
`<lokasi>-<kategori>-<urut>` TIDAK ditebak krn belum ada aturan resmi) +
`asset_tag_audit_log` (riwayat verifikasi fisik). Sticker generation
di-port ke `apps/web/src/lib/asset-sticker.ts` — QR via npm `qrcode` (baru
ditambahkan sbg dependency), **barcode CODE128 SENGAJA di-drop** (blueprint
cuma minta QR, jaga scope R0/COULD tetap minimal). Cetak pakai pola
`window.open("","_blank")+document.write()` yang SUDAH ADA di codebase
(`sales-analytics-dashboard.tsx`) — bukan bikin CSS print baru.

**1 halaman `/asset-tag`, 2 tab (Aset + Cetak Stiker)** — langsung dibuat
gabung dari awal (bukan 2 lalu digabung spt F52), krn sudah belajar dari
pola F52: 2 sub-view domain+fitur SAMA = gabung wajar.

### Bug UI ditemukan & disapu ke F50 (pola sama, komponen di-copy)
User lapor screenshot: tabel "Riwayat Audit" F53 mepet/kepotong. Akar
masalah: `<th>`/`<td>` cuma py-1.5 (padding VERTIKAL doang), nol padding
horizontal — teks yang wrap (tanggal panjang, "Tidak ditemukan") nempel ke
kolom sebelah. **Fix**: tambah `pr-4` + `whitespace-nowrap` per kolom +
`overflow-x-auto` di container. **Dicek ke F50** (komponen `vehicle-row-
actions.tsx` riwayat log — SAMA POLA, krn F53 di-copy dari situ) — ternyata
bug SAMA ada di sana juga, diperbaiki via worktree, commit terpisah, push
ke PR F50 yang sudah terbuka. **Pelajaran: kalau nemu bug di komponen yang
jelas-jelas di-copy dari fitur lain, cek balik sumbernya — kemungkinan besar
bug yang sama ikut ter-copy.**

**Status akhir turn ini**: F50 push (fix tabel) + F52 push+draf PR + F53
push+draf PR — F52 dan F53 PR belum dibuka user (link `pull/new/...` sudah
dikasih).
