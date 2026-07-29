# F26 — Service Ticket Triage (LLM-assisted)

| | |
|---|---|
| Domain | AFTERSALES |
| FR | FR-ES-26 |
| Tier | R1 |
| Prioritas | SHOULD |
| Sprint | B3 |
| Status | DRAFT-SB3 |
| Branch | `feat/f26-service-ticket-triage` (dari `dev` langsung — berdiri sendiri, tidak bergantung F22/F24) |

## Ringkasan

LLM classify customer complaint → severity tag → auto-assign teknisi (by area)
+ ETA. Cara kerja produksi: semua customer & teknisi ada di **1 grup WA** yang
sama; customer ngetik komplain, AI langsung kasih severity + assign teknisi +
ETA, balas otomatis ke grup.

> ⚠️ **Grup WA-nya belum ada saat fitur ini dibuat.** Jalur WA (poin di bawah)
> code-complete tapi **belum bisa diverifikasi live**. Diverifikasi via
> simulasi langsung panggil fungsi (tanpa lewat webhook sungguhan).

## Cara kerja

- **Tabel** (`infra/postgres/init/070_service_ticket_triage.sql`):
  - `teknisi_roster` — roster teknisi + area cover. **Di-seed via
    `scripts/db/seed-dev-full.sql`** (5 teknisi dummy), TIDAK ada halaman
    kelola/CRUD (keputusan: "untuk magang sekarang disuruh seed" — data
    referensi kecil & statis, beda kasus dgn data transaksional).
  - `service_ticket` — 1 baris per komplain, `wa_message_id UNIQUE` (idempotensi
    kalau webhook WA re-deliver pesan yang sama).
  - Keduanya **self-contained**, tidak FK ke `installation_unit` (F22) sekalipun
    konsepnya berdekatan (alat yang komplain mungkin pernah diinstal via F22).
- **`services/ai`**: endpoint baru `POST /triage-ticket` (`services/ai/app/main.py`)
  — LLM classify severity + extract area dari teks komplain, fallback aman
  `severity="sedang"` kalau LLM gagal/tanpa `OPENROUTER_API_KEY`.
- **API**: `apps/api/src/repo/serviceticket.ts` — `createTicket` (classify →
  auto-assign teknisi least-loaded by area → hitung ETA → notify WA teknisi +
  ack grup), `resolveTicket`.
- **Hook WA inbound** (`apps/api/src/repo/inbound.ts`, ADDITIVE): gated env
  `F26_COMPLAINT_GROUP_JID` (kosong-by-default = no-op murni, tidak ganggu
  fitur `#plan/#report/#leads/#update/#sales` yang sudah ada). Begitu grup
  dibuat & env diisi, otomatis aktif tanpa perlu ubah kode.
- **Web**: halaman `/service-tickets` (create manual/testing + resolve).

## Severity & ETA

- 4 tingkat: `rendah` / `sedang` / `tinggi` / `kritis` (Bahasa Indonesia).
- ETA = SLA tetap per severity (jam), **bukan** estimasi rute/jarak riil.
  Default: kritis 2j / tinggi 4j / sedang 24j / rendah 72j — override via env
  `TICKET_ETA_HOURS_<SEVERITY>`.

## Limitasi yang dicatat eksplisit (bukan bug)

- **Identitas pengirim di grup WA tidak reliable** (`sender_jid` = group jid,
  bukan personal). Bedain customer vs teknisi pakai fuzzy `ILIKE` `sender_name`
  ke `teknisi_roster.nama` — best-effort saja.
- **Area/lokasi** di-extract LLM dari teks komplain (atau override manual di
  form). Kalau tak ketemu/tak match teknisi manapun, tetap assign teknisi
  paling sedikit beban, tapi `needs_review=true` biar admin cek manual.
- **Severity di dev selalu "sedang"** — dry-run fallback krn tak ada
  `OPENROUTER_API_KEY` lokal. Differensiasi asli cuma kelihatan di production
  dgn API key live.

## Verifikasi

```bash
curl -X POST localhost:4000/service-tickets -H 'content-type: application/json' \
  -d '{"complaint_text":"alat rontgen mati total, tolong segera!","customer_name":"RS Test"}'
```
Simulasi jalur WA (tanpa webhook sungguhan): panggil `createTicket({source:'wa', ...})`
langsung via `npx tsx` — idempotensi `wa_message_id` UNIQUE terbukti jalan
(re-delivery return ticket yang sama, tidak dobel).

## Terkait

- [F22 — Instalasi Alat Lifecycle](./F22-instalasi-alat-lifecycle.md) — domain
  berdekatan (alat yang komplain), tapi SENGAJA tidak di-FK (lihat limitasi).
