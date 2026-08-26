# F4 — #CEK Faktur/SO/SJ Cross-ref, Phase A (ERP)

Sales/AM di lapangan kirim `#CEK <nomor dokumen>` di WA — tak perlu sebut jenis
dokumennya (SO, SJ/delivery-order, atau Faktur/invoice) — bot balas status
dokumen itu + dokumen lain yang **kemungkinan** terkait (SO→SJ→SI dari transaksi
yang sama).

> ⚠️ **Ini Phase A saja (Sprint S7).** Board menyebut "Server-side SO→SJ→SI join
> via Accurate API" untuk Phase A dan "fuzzy fallback + shipment tracking S9
> post-Crawl Gate" untuk Phase B. Riset menyeluruh (grep seluruh repo termasuk
> file untracked root) tidak menemukan `ADR-021`, `Crawl Gate`, atau sprint `S9`
> sebagai dokumen/definisi apa pun — cuma tag di board eksternal Direktur. Sudah
> direlay ke Direktur (Husni); jawaban: **"skip dulu, masukkan ke issue"** — Phase
> B resmi ditunda, dibuka sebagai issue backlog terpisah, tidak dibangun di sini.

- **Domain**: ERP · Hashtag `#CEK` · Tier R0/R1 · MUST · Sprint S7 Phase A
- **Owner (board)**: Husni (Integration Owner)
- **Menu**: tidak ada — WA-only, sama pola F2 `#STOK`
- **Migrasi**: `infra/postgres/init/083_cek_doc_number_index.sql`

## 1. Kenapa cross-ref-nya heuristik, bukan join beneran

Dicek langsung di kode sebelum desain apa pun ditulis:

1. **Tidak ada kolom penghubung SO↔SJ↔Faktur di mirror manapun.**
   `accurate_sales_order`/`accurate_delivery_order` cuma punya `customer_name`
   TEKS (bukan FK), dan **recent-only ±500** dari total ±11.8rb/11.9rb transaksi
   riil. `accurate_invoice` satu-satunya yang punya `customer_id` asli (FK ke
   `accurate_customer`).
2. **Live API Accurate yang sudah dipakai di kode ini cuma bisa lookup by `id`**
   (`getSalesOrderItems`/`getDeliveryOrderItems`), **tidak ada endpoint by
   nomor**. Tak terverifikasi apakah `list.do` Accurate support filter nomor —
   tak ada kredensial Accurate asli di lingkungan dev untuk dites. Menebak
   bentuknya mengulang kesalahan yang sudah dihindari F37 untuk puller
   real-time-nya.
3. Satu-satunya field lintas-dokumen di `raw` JSONB Accurate adalah `po_number`
   — itu nomor PO milik CUSTOMER (referensi eksternal mereka), bukan ID
   internal yang menghubungkan SO→SJ→SI.

Karena itu Phase A **tidak pernah mengaku pasti** — korelasi cuma berdasar
nama customer + rentang tanggal, dan balasan WA selalu bilang begitu (bukan
cuma saat ambigu).

## 2. Deteksi jenis dokumen: auto-detect, tanpa prefix

`#CEK <nomor>` coba exact-match `number` di ketiga tabel sekaligus — yang match
jadi "anchor". Konsisten dengan pola `#STOK` (semua teks setelah hashtag =
argumen, tanpa sub-grammar), dan format seri nomor SO/SJ/Faktur secara praktik
berbeda jadi risiko salah tebak jenis kecil.

## 3. Korelasi: exact-match customer + window tanggal, TANPA fuzzy

Alur di `findDocByNumber`/`correlateDoc` (`apps/api/src/repo/cek.ts`):

1. Anchor ditemukan → ambil `customer_name` (invoice resolve via join
   `accurate_customer`, satu-satunya FK asli dari 3 tabel) + `trans_date`.
2. Cari di 2 tabel lain: `lower(trim(customer_name)) = lower(trim(anchor))` DAN
   `trans_date` dalam `CEK_DATE_WINDOW_DAYS` (default 14) dari anchor.
3. 0 hasil → jujur "tidak ditemukan" (lihat §4, kata-katanya sengaja beda makna
   dari "tidak ada").
4. 1 hasil → tampil sebagai kemungkinan terkait.
5. >1 hasil → **tidak pilih satu** — tampil semua kandidat, sama pola
   `buildStokReply` "multi-match" F2.
6. **Independen dari 1-5**: cek `accurate_customer` untuk nama customer
   duplikat. Kalau >1 baris nama sama, balasan tambah disclaimer ambigu —
   **walau langkah 2-5 cuma dapat 1 kandidat rapi**. WRG punya kasus nyata
   nama-sama-entitas-beda (F142 Price Book, 22 nama produk dupe) — exact-string-
   match sendirian tak bisa deteksi ini.

**Sengaja TANPA fuzzy fallback** (dikonfirmasi Direktur, exact-match saja untuk
Phase A) — fuzzy nama/nomor eksplisit masuk Phase B yang ditunda (lihat header).

## 4. Dokumen di luar cakupan lokal: kata-katanya WAJIB beda makna

SO/SJ cuma nyimpan ±500 transaksi terbaru. "Tidak ditemukan" di sini **bukan**
berarti "tidak pernah ada" — dua kasus dibedakan eksplisit di teks balasan:

- Anchor sama sekali tak ketemu di 3 tabel → *"tidak ditemukan di data lokal.
  SO/SJ cuma simpan ±500 transaksi terbaru — kalau dokumen ini lebih lama, cek
  langsung di Accurate."*
- Anchor ketemu, tapi SJ/Faktur terkait tak ketemu di window tanggal →
  *"tidak ditemukan di ±N hari & customer sama (cakupan data lokal — SO/SJ
  terbatas ±500 transaksi terbaru)"* — bukan "belum pernah dikirim".

## 5. Gate sender: sama `#STOK`, bukan terbuka seperti `#KLAIM`

`#CEK` membocorkan data komersial (nama customer, total, status bayar) KELUAR
ke pengirim — kelas risiko sama `#STOK` (data cabang), bukan kelas `#KLAIM`
(input masuk berisiko rendah dari pengirim tak dikenal). `resolveSender()`
wajib; sender tak dikenal → skip diam-diam, tanpa balasan.

**Belum ada scoping AM↔customer** (mis. AM cuma boleh cek customer sendiri) —
`access-scope.ts` yang ada sekarang dibangun untuk `app_user`/dashboard, bukan
identitas pengirim WA (`master_user`). Default: unscoped (siapa pun resolved
employee bisa cek dokumen customer manapun) sampai ada arahan lain. Begitu
juga tanpa filter role tambahan (parity dengan `#STOK`).

## 6. Known limitation di QW3 (`#CEK CUSTOMER`) — fuzzy-match SO/SJ independen

Beda modul (`apps/api/src/repo/inbound-cek.ts`, bukan `cek.ts` di atas), tapi
dirujuk dari sini karena limitation-nya sejenis dengan §3: `handleCekQuery()`
mencari SO dan SJ **independen**, masing-masing `ORDER BY score DESC LIMIT 1`
via pg_trgm `similarity()` (threshold `CEK_MATCH = 0.3`,
`inbound-cek.ts:24`, query di `:43-56`). Beda dari F4 yang exact-match by
nomor + window tanggal (§3), QW3 murni fuzzy by nama tanpa korelasi tanggal.

Konsekuensinya: dua customer BEDA dengan nama yang mirip (`similarity() >
0.3` satu sama lain) bisa saling "mencuri" hasil. Contoh nyata (seed
`scripts/db/seed-cek-dev.sql` kasus #5): `#CEK CUSTOMER CV Sample Dua` balas
header **"CV Sample Satu"** — SO milik "CV Sample Satu" menang skor
similarity walau customer yang dicari adalah "CV Sample Dua" yang cuma
punya SJ. `similarity('CV Sample Dua', 'CV Sample Satu') = 0.588`, jauh di
atas threshold.

Bukan bug — ini batas struktural dari desain fuzzy-independen, bukan
kesalahan implementasi. Kalau nanti perlu diperketat: opsi paling dekat
dengan pola F4 di atas adalah resolve `accurate_customer` dulu (exact/ID
match) baru JOIN ke SO/SJ per `customer_id`, bukan fuzzy-match SO & SJ
masing-masing secara terpisah — tapi ini perubahan scope QW3, belum
diputuskan (lihat PR #868).

## Cara kerja

- Hashtag: `#CEK <nomor>` — deteksi via `CEK_LINE` regex di `detectKind()`
  (`apps/api/src/repo/inbound.ts`).
- Prefilter `processUnprocessed()`: `cek` ditambahkan ke whitelist regex —
  tanpa ini pesan `#CEK` diam-diam tak pernah ke-SELECT (jebakan yang sama yang
  pernah kena F139).
- Composer: `apps/api/src/repo/cek.ts` (`findDocByNumber`, `correlateDoc` via
  `findSoCandidates`/`findSjCandidates`/`findInvoiceCandidates`,
  `buildCekReply`).
- Tidak ada cron baru, tidak ada perubahan `apps/web` — naik di jalur inbound
  yang sudah ada (webhook + `POST /wa/inbound/process` manual catch-up).

### Env

| Env | Default | Fungsi |
|---|---|---|
| `WA_INBOUND_PROCESS` | `false` | gate proses inbound (sama semua hashtag) |
| `WA_INBOUND_GROUPS` | kosong (allow-all) | whitelist grup WA yang diproses |
| `CEK_DATE_WINDOW_DAYS` | `14` | rentang tanggal korelasi customer sama |

## Hasil pengujian lokal

Ditest via `buildCekReply()` langsung (bypass HTTP, data uji dihapus setelah
verifikasi) + `POST /wa/inbound/process` end-to-end untuk gate sender:

- ✅ Anchor SO + 1 SJ match + 1 Faktur match (customer sama, dalam window) →
  balasan lengkap 3 dokumen + disclaimer korelasi.
- ✅ Anchor ketemu, 0 dokumen terkait di window → balasan "tidak ditemukan di
  ±14 hari" (bukan "belum dikirim").
- ✅ Anchor ketemu, 2 kandidat SJ di window+customer sama → balasan list
  semua kandidat, tidak pilih satu.
- ✅ `accurate_customer` punya 2 baris nama sama dengan anchor → disclaimer
  ambigu muncul walau korelasi cuma dapat 1 kandidat rapi.
- ✅ Nomor sama sekali tak ketemu di 3 tabel → balasan "tidak ditemukan di
  data lokal ... cek langsung di Accurate".
- ✅ Sender tak dikenal (pushname tak match roster) → `skipped:
  "unknown-sender"`, tanpa balasan.

Lint + typecheck (`pnpm --filter @wrg/api build`, `lint`) + `next build`
(`apps/web`, tak disentuh tapi ikut dijalankan) semua clean.

## Belum dikerjakan / perlu konfirmasi

1. **Phase B** (fuzzy fallback nama/nomor + "shipment tracking S9 post-Crawl
   Gate") — ditunda total per arahan Direktur, dibuka sebagai issue backlog
   terpisah. `ADR-021`/`Crawl Gate`/sprint `S9` tetap belum terverifikasi
   bentuknya dari sisi kode.
2. Scoping AM↔customer & filter role pengirim — default unscoped/tanpa filter
   (lihat §5), belum dikonfirmasi eksplisit apakah cukup.
3. QW3 (assignee lain, Kefiar) — board-nya menyebut "#BAST #TTF minimal
   hashtag di F4 SXR", menandakan F4 dianggap fondasi buat QW3. Tidak ada
   tindakan khusus diambil di sini — skeleton dispatch hashtag sudah dari awal
   dirancang untuk menambah hashtag baru dengan mudah.
