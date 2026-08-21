# F9 — Duplicate Customer Name Alert (OPS)

Deteksi otomatis saat sales rep bikin deal baru dengan nama customer yang
mirip/identik dengan nama yang sudah ada — flag ke HITL Review, bukan blok
create, bukan hashtag WA.

> ⚠️ **Scope ini sudah dipersempit dari deskripsi board asli** ("Master Data
> Hygiene Watch: name/customer/brand/NPWP reconciliation... 24 duplikasi
> PJK/0957 + Mufid=Mufidz + Rocky 2 nomor + Fafa pushName mismatch"). 4
> insiden yang disebut nol bukti di repo, dan bagian identitas karyawan
> (Mufid/Rocky/Fafa) menyentuh `master_user` — domain HR yang eksplisit
> terlarang buat magang (`ONBOARDING.md`). Direktur mempersempit scope
> langsung: *"ini untuk pengecekan duplikasi data — kalau ada input nama
> customer yang double, kasih alert aja, tanpa pakai hashtag."* Brand & NPWP
> juga di luar scope (brand: tak ada entitas brand di sistem; NPWP: tak
> disebut lagi di scope yang dipersempit).

- **Domain**: OPS · Tier R1 · SHOULD (dari board asli, scope sudah berubah)
- **Owner (board)**: Husni (BD&GA)
- **Menu**: tidak ada menu baru — reuse `/hitl` (HITL Review) yang sudah ada
- **Migrasi**: tidak ada — payload JSONB, index trigram sudah ada sebelumnya

## 1. Kenapa hook di `createDeal()`, bukan tempat lain

Dicek langsung di kode: satu-satunya tempat nama customer BARU (teks bebas)
benar-benar *di-input* di live API adalah `createDeal()`
(`apps/api/src/repo/deal.ts:756-781`, field `customer_name`/`facility_name`).
`accurate_customer.name` cuma diisi via sync Accurate (nol CRUD manusia);
`crm_account` wajib `accurate_customer.id` sudah ada lebih dulu (hard FK, tak
ada `POST /accounts`) — jadi bukan tempat nama baru masuk. `deal.account_id`
sendiri tak pernah di-set saat create (selalu NULL).

## 2. Dua sinyal independen, bukan satu

- **Sinyal A** — nama baru vs `customer_name` deal LAIN (semua AM, semua
  cabang, tanpa filter). Sengaja tanpa filter: inti masalahnya justru 2 AM
  BEDA yang mengetik nama customer sama dengan ejaan beda — filter per-AM
  akan menyembunyikan kasus itu.
- **Sinyal B** — nama baru vs `accurate_customer.name` (customer yang SUDAH
  dikenal Accurate). Karena `account_id` selalu NULL saat create, sinyal ini
  nangkep kasus "rep ngetik nama baru padahal customer-nya udah ada di
  Accurate, seharusnya di-*link* bukan bikin nama baru."

Satu payload type (`duplicate_customer_name_flag`), field `kind` per kandidat
(`"deal"` / `"accurate_customer"`) yang membedakan sinyal — bukan 2 payload
type terpisah, biar perubahan dashboard minimal.

## 3. Threshold: exact vs fuzzy, kenapa 0.72

- **Exact**: dibandingkan via `custId()` yang sudah ada (`deal.ts:75-83` —
  lowercase + strip non-alnum), otomatis nyamain `"PT ABC"`/`"PT. ABC"`/spasi
  ganda tanpa logic baru.
- **Fuzzy**: `similarity() >= 0.72` (pg_trgm, extension sudah enabled,
  `idx_deal_customer_trgm` sudah ada di `deal.customer_name`).

0.72 **sedikit lebih tinggi** dari 0.70 "auto-match" `#REPORT` yang sudah ada
di repo ini — bukan lebih rendah. Alasan: preseden F142 Price Book (nama
identik tak selalu berarti entitas sama, 2 cabang bisa share nama persis)
bikin ambang rendah = alert palsu yang mengikis kepercayaan ke dashboard HITL.
Exact vs fuzzy dibedakan cuma di badge UI ("IDENTIK" vs skor %), bukan di
mekanisme deteksi — exact tetap bisa jadi 2 entitas beda (2 cabang), fuzzy
tetap perlu dicek manusia juga.

## 4. Kenapa reuse HITL Review, bukan cron WA broadcast baru

Pola cron-WA-broadcast (F38 ED Watch, F45 previsit-check) itu untuk kasus
proaktif PERIODIK dengan target WA fixed — beda kelas dari "alert saat
input" yang diminta di sini. `hitl_queue` sudah jadi mekanisme "flag untuk
direview manusia" yang established (3 payload type lain:
`report_ambiguous_match`, `pipeline_authenticity_flag`, `anomaly_flag`, semua
murni dashboard `/hitl`, nol WA push) — payload JSONB-nya generik, jadi
nambah tipe ke-4 additive, tanpa migrasi, tanpa infra baru.
`resolveHitl()` (`apps/api/src/repo/hitl.ts`) **tidak diubah sama sekali** —
fallback generik yang sudah ada (approve/reject = flip status, tanpa
downstream side-effect) langsung cocok.

## Cara kerja

- **Hook**: `flagDuplicateCustomerName()` (`apps/api/src/repo/deal.ts`)
  dipanggil di akhir `createDeal()`, dibungkus try/catch — **best-effort,
  tak pernah menggagalkan `POST /deals`**. Ini alert, bukan gate: blocking
  create deal karena tebakan heuristik string-similarity akan mengganggu
  sales rep yang legit.
- **Enqueue**: `enqueueDuplicateCustomerName()`
  (`apps/api/src/repo/hitl.ts`) — insert `hitl_queue` dengan
  `correlation_id = 'f9-<dealId>'`, guard cek row `pending` yang sama dulu
  ada supaya 1 dealId cuma bisa punya 1 flag.
- **Web**: `apps/web/src/app/(dashboard)/hitl/page.tsx` — 1 render branch
  baru (ternary chain, pola sama 3 payload type lain), tombol "Sudah dicek /
  bukan duplikat" (approve) / "Tolak" (reject). `apps/web/src/app/api/hitl/*`
  tidak diubah (generic passthrough).
- Tidak ada cron, tidak ada env baru, tidak ada migrasi.

## Hasil pengujian lokal

Ditest via `POST /deals` end-to-end + 1 pengujian langsung fungsi
(`enqueueDuplicateCustomerName`, bypass HTTP) untuk guard anti-spam. Data uji
dihapus setelah verifikasi.

- ✅ Nama unik → 0 kandidat → tidak ada row `hitl_queue` baru.
- ✅ Nama identik (setelah normalisasi) dgn deal existing → flag `exact:true`,
  `score:1`.
- ✅ Nama mirip (typo, skor 0.82) dgn deal existing → flag `exact:false`,
  matched ke SEMUA deal serupa yang sudah ada (bukan cuma 1).
- ✅ Nama mirip dgn `accurate_customer.name` existing (Sinyal B) → flag
  `kind:"accurate_customer"`.
- ✅ Anti-spam: `enqueueDuplicateCustomerName()` dipanggil 2× dengan `dealId`
  sama → panggilan ke-2 return `null`, tidak ada row baru.
- ✅ `POST /hitl/resolve` approve & reject pada payload type baru → status
  flip benar via fallback generik yang sudah ada, tanpa perubahan kode.

Lint + typecheck (`pnpm --filter @wrg/api build`, `lint`) + `pnpm --filter
@wrg/web build` semua clean.

## Belum dikerjakan / perlu konfirmasi

1. **Hanya `createDeal`, bukan `updateDeal`** — itu satu-satunya tempat nama
   BARU masuk; nambah ke update butuh deteksi "customer_name berubah" +
   correlation key beda, di luar yang diminta Direktur.
2. **Tanpa filter performa** (LIMIT per-AM/cabang/waktu) — di skala tabel
   sekarang (~5-6rb baris) `similarity()` scan penuh tetap cepat (2 query
   lain di repo ini sudah pakai pola sama di skala serupa). Kalau `deal`
   tumbuh 10x, follow-up-nya ganti ke operator `%` (index-assisted via
   `idx_deal_customer_trgm`) — dicatat, belum dikerjakan (premature
   optimization sekarang).
3. Brand & NPWP dari deskripsi board asli — di luar scope yang dipersempit
   Direktur, tidak dibangun.
