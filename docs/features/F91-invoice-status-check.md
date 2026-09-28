# F91 — Invoice Status Check `#FAKTUR` (FINANCE)

Finance/AM kirim `#FAKTUR <no_invoice>` di WA → bot balas status invoice
(**Open / Paid / Overdue**) + jatuh tempo + nominal + customer. Ditambah cron
reminder jatuh tempo **D-7 / D-day / overdue** ke Finance + AM. Level
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

## 3. Reminder jatuh tempo (`invoice-reminder`)

Job scheduler hari kerja (`INVOICE_REMINDER_ENABLED`, `INVOICE_REMINDER_CRON`
default `0 8 * * 1-5`, dilewati di hari libur `master_holiday`). Trigger manual:
`POST /ar/invoice-reminder/run {"dry_run": true}`.

| Tahap | Rentang | Frekuensi |
|---|---|---|
| `d7` | 1–7 hari lagi | sekali per invoice |
| `d0` | hari ini | sekali per invoice |
| `od` | sudah lewat | pertama kali, lalu tiap `INVOICE_REMINDER_OVERDUE_EVERY_DAYS` (default 7) selama outstanding |

Rentang (bukan tepat H-7) supaya hari yang terlewat (libur, cron mati) tetap tertangkap.

**Penerima** — satu digest per penerima, bukan satu pesan per invoice:
- Finance → `INVOICE_REMINDER_FINANCE_TARGET` (JID grup/nomor, ditentukan user).
  Kosong → digest Finance **dilewati**, tidak di-broadcast.
- AM → DM `master_user.wa_number` (AM via `joinAmFromSalesman`). AM nonaktif / tanpa
  nomor → dilewati, **tanpa** fallback ke grup (invoice tetap ada di digest Finance).

**Dedupe** — `notif_state` key `f91:<tahap>:<invoice_id>:<fin|am>`; ditandai hanya
setelah kirim **sungguhan** (bukan stub/dry-run gateway), jadi gagal kirim dicoba
lagi run berikutnya.

**Anti data basi** — `accurate-sync` hanya menarik ulang invoice ≤7 hari, jadi invoice
lama bisa tercatat OPEN padahal sudah lunas. Sebelum kirim, setiap kandidat ditarik
ulang (`syncAccurateInvoices({invoiceId})`, read-only), maks
`INVOICE_REMINDER_RESYNC_LIMIT` (default 100) per run — sisanya ditunda ke run
berikutnya (urut yang paling lama tak tersinkron). Tanpa kredensial Accurate / limit
`0` → pakai mirror apa adanya. Gagal tarik ulang satu invoice → pakai data mirror.

## 4. Uji

- Tes murni: `apps/api/src/repo/faktur.test.ts` (status, tahap, jadwal ulang, format).
- Manual (DB dummy lokal): fixture invoice D-7 / D-0 / overdue / sisa 0 / tanpa due /
  PAID / jauh → hanya 3 pertama yang jadi kandidat; run kedua kosong; overdue terkirim
  lagi setelah 7 hari; gateway mati → tidak ditandai.
