# F15 — SPH Generator + Pricing Library

Domain: CRM · Hashtag `#SPH #PRICING` · FR FR-ES-15 · Owner: AM,
Admin Penawaran, HOD Business (approver).

> **Status di `main` (produksi):** jalur **web** SPH sudah live. Jalur
> **WhatsApp `#SPH` / `#PRICING`** (§1 di bawah) BELUM ikut ke main —
> `parsers/sph.ts` & penanganan hashtag di `inbound.ts` masih hanya di `dev`.

## Ringkasan

App layer di atas F142 Price Book (`product_pricelist`, migrasi 071) untuk
membuat draft SPH (Surat Penawaran Harga) dengan harga per-SKU REAL dari
katalog, bukan placeholder. Dua jalur intake: **form web** (`/sph/new`, pilih
katalog persis) dan **hashtag WA** (`#SPH`, 1 item per pesan, kode Accurate).
Berbeda dari batch A6 "Sales Doc Drafter" (`salesdoc.ts`, baca
`deal.estimated_value`/`product_ids` yang kasar) — F15 selalu menghitung harga
per-line REAL, validasi diskon terhadap `diskon_maks`, dan gate baris
nama-varian-kembar sebelum finalize.

## Keputusan Direktur (2026-08-12, respons 12 pertanyaan gabungan QW1/F15/F19)

1. **`deal.stage` TETAP MANUAL** — SPH tidak pernah memanggil
   `transitionStage()` di `deal.ts`. File itu tidak disentuh sama sekali di
   fitur ini (aman dari gate ONBOARDING.md pipeline/deal core).
2. **Approval 2 tahap**: AM draft → **HOD Business review** → **Admin
   Penawaran finalize (approve)** → kirim. Bukan 1 approval seperti doc_type
   lain (offering_letter/presentation/mou tetap 1 tahap, tidak diubah).
3. **Floor-breach approval scheme**: "abaikan" — TIDAK dibangun jalur
   approval terpisah untuk kasus harga di bawah `harga_nett`. Ditolak keras
   di titik insert kalau diskon > `diskon_maks` (lihat §Enforcement).
4. Identitas pemilik fitur di roster: "abaikan" — tidak diperlukan untuk desain.

Setelah desain awal di-review vs blueprint asli (user minta "ikuti
deskripsinya aja" tanpa nunggu Direktur lagi utk 4 gap sisa), **4 hal
ditambahkan** meski belum eksplisit dikonfirmasi Direktur — lihat masing2
bagian di bawah:

## 1. Hashtag WA `#SPH` `#PRICING` (`inbound.ts` + `parsers/sph.ts`)

- **`#PRICING <query>`** — lookup on-demand read-only ke Price Book, pola
  sama `#SALES`. Balas ≤5 hasil: nama, harga list, diskon maks, floor, flag
  ⚠️ kalau nama itu punya varian lain.
- **`#SPH <customer> | <kode> | <qty> | <diskon%>`** — 1 item per pesan,
  **wajib pakai kode** (bukan nama — otomatis bebas masalah 22-nama-kembar
  di jalur WA, gak perlu resolusi apa pun). Diskon wajib pakai tanda `%`
  eksplisit (tolak angka polos — ambigu 10% vs 0.10, pelajaran lama repo ini
  soal locale angka). Reuse `createSphDraft()` PERSIS sama dgn jalur web —
  enforcement diskon_maks & variant-gate otomatis ikut, tidak ada logika
  bisnis yang diduplikasi.
- **Gotcha yang kena & sudah difix**: filter SQL di `processUnprocessed()`
  (`inbound.ts`) itu WHITELIST hardcoded (`'#\\s*(plan|report|leads|update|
  sales)'`) — hashtag baru TIDAK OTOMATIS ketangkap cron/webhook cuma krn
  `detectKind()` diperluas. Wajib tambah `sph|pricing` ke regex itu juga,
  atau pesan #SPH/#PRICING masuk selamanya `processed_at IS NULL` diam-diam.
- Multi-item / cari-by-nama TIDAK didukung di WA (pakai form web) — sengaja,
  parsing multi-baris via chat itu persis alasan QW1 (#FORECAST) diminta
  Direktur dibahas onsite dulu (terlalu kompleks utk format bebas).

## 2. LLM auto-draft (`repo/sph.ts draftSphText`, panggil `services/ai /sales-doc`)

- **Iterasi 1 (dibongkar)**: tabel harga dihitung sistem, LLM diminta
  merangkai SURAT LENGKAP (nomor/tanggal/tabel-nya-sendiri/syarat/penutup)
  lalu tabel sistem ditempel lagi di bawah. **Ketemu bug nyata dari
  screenshot user**: LLM/template TETAP nulis nomor/tanggal/tabel/syarat
  placeholder-nya SENDIRI (`[qty]`, `[pembayaran]`, dst) walau sudah dikasih
  tabel final — hasilnya 2 blok di 1 dokumen, satu ngaco satu benar,
  membingungkan customer.
- **Iterasi 2 (final)**: LLM/template **HANYA** kontribusi 1-3 kalimat
  pengantar (`_DOC_INSTRUKSI["sph_final_pricing"]`, `services/ai/app/
  salesdoc.py`). SEMUA bagian faktual/struktural — nomor, tanggal (WIB,
  auto dari `Date.now()` server, format "13 Agustus 2026"), tabel harga,
  syarat & ketentuan, penutup — ditulis sistem (`letterHeader`/
  `letterFooter`/`priceTableBlock`, `repo/sph.ts`) dan LLM tidak diberi
  kesempatan menuliskannya sama sekali (bukan cuma "diminta jangan").
- AI service mati/unreachable (`ECONNREFUSED`) → fallback penuh ke template
  deterministik (`renderSphTextFallback`, struktur identik dgn jalur LLM,
  cuma intro-nya generik), `model_used=NULL`. Diverifikasi: matikan uvicorn
  → draft tetap jadi & benar; nyalakan lagi (dry-run tanpa API key) → intro
  dari `template_doc()` Python, struktur tetap dari sistem, 0 duplikasi.

## 2b. Syarat & Ketentuan + Nomor/Tanggal — wajib eksplisit, bukan placeholder mati

- **Tanggal**: sebelumnya literal `[tanggal]` (bug, bukan sengaja) — sekarang
  auto-isi tanggal server WIB saat draft dibuat.
- **Nomor**: BELUM ada skema penomoran resmi dari Direktur (beda dgn
  tanggal yg bisa dipastikan dari server, nomor SPH biasanya terikat sistem
  register fisik perusahaan) — dibiarkan `[diisi Admin Penawaran]`,
  actionable, BUKAN ditebak. **Perlu jawaban Direktur** kalau mau diotomasi.
- **Syarat Pembayaran/Pengiriman**: sistem TIDAK punya sumber data ini di
  mana pun (bukan kolom Price Book) — dijadikan **input wajib** di
  `/sph/new` (AM isi per quote, beda customer bisa beda syarat, salah
  default lebih bahaya dari kosong). Jalur `#SPH` WA (format 1-baris tak
  memuat field ini) fallback ke `(diisi Admin Penawaran)` eksplisit.

## 3. Variant-confirm gate — HANDOVER §6 (migrasi 098 + `repo/sph.ts`)

Desain awal (AM pilih by ID di picker) MENCEGAH ambiguitas tapi tidak
membangun langkah "confirm ke admin" yang literal diminta HANDOVER §6.
Ditambahkan:
- `sph_line_item.variant_confirmed` (default `true`) — di-set `false` saat
  insert kalau `(brand, nama)` baris itu dipakai >1 SKU di SELURUH katalog
  periode (bukan cuma di antara item yang diminta).
- `approveSalesDoc` (`salesdoc.ts`) — utk `doc_type='sph'`, cek
  `unconfirmedVariantItems()` dulu; ada yg `false` → approve DITOLAK, sebut
  nama item yang perlu dikonfirmasi.
- `POST /sph/:id/confirm-variant` (body `line_item_id`) — Admin Penawaran
  konfirmasi 1 baris. `salesDocId` di URL WAJIB cocok dgn `sales_doc_id`
  baris itu (cegah id nyasar ke dokumen lain).
- UI `/sales-docs`: kartu status `hod_review` fetch detail SPH, tampilkan
  daftar item pending + tombol "Konfirmasi" per baris; tombol "Finalisasi"
  disabled kalau masih ada yang pending (UX saja — backend tetap gate-nya,
  ini bukan satu-satunya pertahanan).

**Bug yang ketemu & difix pas testing**: kunci pembeda ambiguitas awalnya
pakai `\0` sbg delimiter (`` `${brand}\0${nama}` ``) — parameter tool
yang dipakai menulis kode ini men-decode `\0` jadi BYTE NUL ASLI di file
sumber (bukan teks 6-karakter `\0`), dan builder vs checker sempat pakai
delimiter beda (NUL vs spasi) → gate selalu lolos diam-diam (`variant_confirmed`
selalu `true`). Fix: pakai delimiter teks biasa (`"::"`) konsisten di kedua
sisi, diverifikasi via `node -e` cek 0 byte NUL tersisa di file.

## 4. Export PDF (`/api/export/sales-doc/[id]`, reuse `exportdoc.ts`)

Infra `export HTML→print-to-PDF` (`renderSalesDocHtml`, sudah ada sebelum
F15, generik semua `doc_type`) ternyata **tidak pernah punya BFF wrapper di
web** — endpoint API-nya hidup tapi tak ada tombol yang memanggilnya di UI
manapun. Ditambahkan wrapper `apps/web/src/app/api/export/sales-doc/[id]` +
tombol "🖨️ Export / Print PDF" di tiap kartu `/sales-docs`. **Bukan generate
PDF otomatis** (repo ini sengaja "tanpa lib PDF", lihat komentar
`exportdoc.ts`) — Admin Penawaran klik tombol print browser manual. Deviasi
sadar dari kata "PDF" literal di blueprint, konsisten dgn arsitektur yang
sudah ada.

## Kenapa disambiguasi 22-nama-duplikat TIDAK jadi masalah di jalur WEB

`product_pricelist.nama` tidak unik (22 nama × varian beda harga). Jalur web
**tidak melakukan resolusi nama** — AM memilih baris katalog lewat picker
(`GET /pricebook/items?q=`) yang mengembalikan `id` + `jumlahHarga` (berapa
SKU lain pakai nama sama). Form intake mengirim `pricelist_item_id`, jadi
ambiguitas structural tak pernah terjadi di titik itu — TAPI baris yang
"berpotensi salah pilih" itu tetap kena gate §3 di atas sebelum finalize,
sbg pengaman kedua yang independen dari kehati-hatian AM.

## Enforcement diskon & floor

- **Diskon Maks (tier 5/10/20%)**: divalidasi di `repo/sph.ts createSphDraft`
  — kalau `diskon_requested` > `diskon_maks` snapshot SKU itu, **insert
  ditolak keras** (400, tidak ada draft tersimpan, berlaku sama di WA & web).
- **Harga Nett floor**: karena `harga_nett` (F142) = `ROUND(price_list *
  (1 - diskon_maks))`, dan diskon_requested selalu ≤ diskon_maks (poin di
  atas), secara matematis `harga_nett_efektif` (hasil hitung per line)
  **tidak akan pernah** turun di bawah floor lewat jalur diskon% normal.
  Flag `belowFloor` tetap dihitung & dikembalikan di response (jaga-jaga,
  bukan diasumsikan) tapi murni informasional — tidak ada gate approval
  terpisah (poin 3 keputusan Direktur).
- PPN 11% dari nett: rumus sama dgn `pricebook.ts` (`ROUND(nett * 1.11)`),
  tidak reimplement.

## Skema DB (migrasi 152_sph_generator.sql)

- `sales_doc` (existing, 003_sales_crm.sql): + kolom `hod_reviewed_by`,
  `hod_reviewed_at`. Status baru `hod_review` (tanpa CHECK constraint di
  kolom `status`, jadi tidak perlu ALTER utk enum).
- `sph_line_item` (baru): `sales_doc_id` FK, `pricelist_item_id` FK ke
  `product_pricelist`, `qty`, `diskon_requested`, SNAPSHOT (`nama_snapshot`,
  `price_list`, `diskon_maks_snapshot`, `harga_nett`, `nett_ppn`), +
  `variant_confirmed`/`variant_confirmed_by`/`variant_confirmed_at`
  (HANDOVER §6 gate).

## Alur API

```
POST /sph                       → buat draft (form web / #SPH WA)
GET  /sph/:id                    → detail + line items + total
POST /sph/:id/review             → tahap 1/2: HOD Business (draft → hod_review)
POST /sph/:id/confirm-variant    → Admin Penawaran konfirmasi 1 baris nama-kembar
POST /sales/docs/:id/approve     → tahap 2/2: Admin Penawaran finalize
                                    (hod_review → approved, gate variant; doc_type
                                     lain tetap draft → approved)
POST /sales/docs/:id/send        → kirim WA (existing, tidak diubah)
POST /sales/docs/:id/cancel      → batalkan (existing, tidak diubah)
GET  /export/sales-doc/:id       → HTML print-to-PDF (existing, sekarang ada BFF+tombol)
```

## UI

- `/sph/new` — form intake: pilih/isi customer, cari item Price Book,
  keranjang item (qty + diskon% per baris), total nett/PPN, submit → draft.
- `/sales-docs` — tombol "+ Buat SPH"; status `draft` (sph) → "Kirim ke HOD
  Business"; status `hod_review` → daftar item pending confirm + tombol
  konfirmasi + "Finalisasi"; semua kartu → tombol "Export/Print PDF".

## Testing (lokal, data dummy dihapus setelah verifikasi)

- Diskon melebihi diskon_maks → ditolak 400 (web & WA). ✅
- Draft multi-item, harga/PPN benar; regresi doc_type lain tetap 1-tahap. ✅
- Variant-gate: item nama-kembar → approve ditolak sebelum confirm, sukses
  sesudah; item non-ambigu tak kena gate. ✅
- LLM live (dry-run, AI service jalan) → teks AI + tabel sistem nempel;
  LLM mati (`ECONNREFUSED`) → fallback deterministik, `model_used=NULL`. ✅
- `#PRICING`/`#SPH` via WA: query sukses, create sukses, DAN 4 skenario
  error (diskon tanpa %, kode tak ketemu, format salah, diskon>maks) semua
  balas pesan jelas, tak ada crash. ✅
- `pnpm typecheck`/`lint`/`build` (api+web) — semua clean.

## Yang SENGAJA di luar scope

- Override harga manual oleh Admin Penawaran (di luar % diskon standar) —
  tidak dibangun, konsisten dgn "abaikan" utk floor-breach approval scheme.
- Deal linkage (`deal_id`) opsional, tidak wajib — SPH bisa dibuat tanpa
  deal existing (`customer_id`/`customer_name` cukup).
- PDF generation otomatis (lib PDF baru) — repo ini sengaja tanpa lib PDF di
  semua fitur lain juga, print-to-PDF manual dianggap cukup konsisten.
- `#SPH` multi-item / cari-by-nama via WA — perlu format yang lebih rumit,
  sama alasan QW1 ditunda ke onsite.
