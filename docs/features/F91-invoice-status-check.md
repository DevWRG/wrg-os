# F91 — Invoice Status Check `#FAKTUR` (FINANCE)

Finance/AM kirim `#FAKTUR <no_invoice>` di WA → bot balas status invoice
(**Open / Paid / Overdue**) + jatuh tempo + nominal + customer. Ditambah cron
reminder jatuh tempo **D-7 / D-day** ke Finance + AM, plus rekap **overdue mingguan** ke Finance. Level
per-INVOICE, pelengkap AR Watch (A2) & F30 AR Aging yang level per-customer.

- **Domain**: FINANCE · Hashtag `#FAKTUR` · FR-KMP-91 · R0 · MUST · Sprint B1
- **Owner (board)**: Finance Ika · Fafa · 12 AM
- **Menu**: tidak ada menu baru — dialog detail invoice di `/ar` ikut menampilkan
  jatuh tempo + status turunan
- **Migrasi**: tidak ada (due date dari `accurate_invoice.raw`, dedupe di `notif_state`)
- **Bukan** F149 Fakturis (penerbitan faktur) / F31 Tukar Faktur / F27 Faktur Pajak.

## 1. Status invoice

`deriveInvoiceStatus` (`apps/api/src/repo/ar.ts`) — satu definisi untuk WA,
reminder, dan web:

| Kondisi | Status |
|---|---|
| `status = 'PAID'` **atau** `outstanding ≤ 0` | PAID |
| OPEN & due date < hari ini (WIB) | OVERDUE N hari |
| OPEN & due date tak diketahui | OPEN (jatuh tempo tidak tercatat) — **tidak** dianggap overdue |
| sisanya | OPEN |

**Due date = `raw->>'dueDate'`** (format Accurate `dd/MM/yyyy`, diparse
`normalizeAccurateDate`). Sengaja **bukan** `ar_aging_mv.due_date`:
`mapAccurateInvoice` mengisinya dengan `transDate` bila `dueDate` kosong → invoice
tanpa termin tampak overdue palsu. Kolom `days_overdue` di MV juga beku sejak
ingest, jadi jumlah hari selalu dihitung ulang.

## 2. `#FAKTUR <no_invoice>`

- Handler di `inbound.ts` (kind `faktur`), balasan dari `buildFakturReply` (`repo/faktur.ts`)
  yang memakai `invoiceDetail` — sama dengan dialog web.
- Akses: pengirim **dikenal & aktif** (`resolveSender`), setara `#CEK`; tanpa scope
  per-AM (keputusan user 2026-09-28). Pengirim tak dikenal → tidak dibalas.
- Nomor dicocokkan case-insensitive, token pertama saja (`#FAKTUR SI.1 tolong cek` → `SI.1`).
- `#FAKTURIS…` / `#FAKTUR123` **tidak** memicu (regex `\b`, dites di `inbound-kind-filter.test.ts`).

## 3. Reminder jatuh tempo

Dua job, satu flag `INVOICE_REMINDER_ENABLED` (dilewati di hari libur `master_holiday`).

### 3a. Harian `invoice-reminder` — D-day & D-7

`INVOICE_REMINDER_CRON` default `0 8 * * 1-5`. Manual: `POST /ar/invoice-reminder/run {"dry_run": true}`.

| Tahap | Rentang | Frekuensi |
|---|---|---|
| `d0` | hari ini | sekali per invoice × penerima |
| `d7` | 1–7 hari lagi | sekali per invoice × penerima |

Rentang (bukan tepat H-7) supaya hari yang terlewat (libur, cron mati) tetap tertangkap.
**Overdue TIDAK ikut harian** (keputusan 11 Okt 2026) — lihat 3b.

- **Penerima** — satu digest per penerima: Finance → `INVOICE_REMINDER_FINANCE_TARGET`
  (kosong → dilewati, tidak di-broadcast); AM → DM `master_user.wa_number` (nonaktif /
  tanpa nomor → dilewati, tanpa fallback ke grup).
- **Prioritas** (`byUrgency`) — D-day dulu, lalu D-7 terdekat. Dipakai untuk memilih
  batch re-sync DAN urutan baris pesan.
- **Batas pesan** — maks `MAX_LINES_PER_MESSAGE` (30) invoice per pesan; sisanya ditulis
  "…dan N invoice lainnya" dan **tidak** ditandai terkirim → ikut run berikutnya.
- **Dedupe** — `notif_state` key `f91:<tahap>:<invoice_id>:<fin|am>`, hanya untuk invoice
  yang tampil, dan hanya setelah kirim **sungguhan** (bukan stub/dry-run gateway).

### 3b. Mingguan `invoice-overdue-recap` — overdue, Finance saja

`INVOICE_OVERDUE_RECAP_CRON` default `5 8 * * 1-5`: dicek tiap hari kerja, terkirim
**sekali per minggu ISO** (key `f91:odrecap:<YYYY-Www>:fin`) → Senin libur = terkirim
Selasa. Manual: `POST /ar/invoice-overdue-recap/run {"dry_run": true}`.

Isi: jumlah & total sisa, ember umur (1–30 / 31–60 / 61–90 / >90 hari), dan 30 invoice
dengan sisa terbesar (beserta AM). Bukan ke AM.

**Kenapa dipisah** — di prod (11 Okt 2026) ada ±1.260 invoice overdue vs ±140 yang
jatuh tempo ≤7 hari. Selama overdue ikut antrean harian (re-sync maks 100/run, urut
paling lama tak tersinkron), D-7/D-day selalu kalah antre — bisa tak pernah terkirim —
dan digest Finance gabungan mencapai ±180 ribu karakter (batas WA ±65 ribu).

### Anti data basi (kedua job)

`accurate-sync` hanya menarik ulang invoice ≤7 hari, jadi invoice lama bisa tercatat
OPEN padahal sudah lunas. Sebelum kirim, kandidat ditarik ulang
(`syncAccurateInvoices({invoiceId})`, read-only), maks `INVOICE_REMINDER_RESYNC_LIMIT`
(default 100) per run: harian = urut prioritas (yang tak kebagian ikut run berikutnya);
rekap = sisa terbesar dulu (yang tampil di daftar). Tanpa kredensial Accurate / limit
`0` → pakai mirror apa adanya. Gagal tarik ulang satu invoice → pakai data mirror.

## 4. Uji

- Tes murni: `apps/api/src/repo/faktur.test.ts` (status, tahap, jadwal ulang, format).
- Manual (DB dummy lokal): fixture invoice D-7 / D-0 / overdue / sisa 0 / tanpa due /
  PAID / jauh → hanya 3 pertama yang jadi kandidat; run kedua kosong; overdue terkirim
  lagi setelah 7 hari; gateway mati → tidak ditandai.
