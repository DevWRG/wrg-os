# F22 — Instalasi Alat Lifecycle

| | |
|---|---|
| Domain | AFTERSALES |
| FR | FR-ES-22 |
| Tier | R2 |
| Prioritas | MUST |
| Sprint | B2 |
| Status | DRAFT-SB2 |
| Branch | `feat/f22-instalasi-alat-lifecycle` |

## Ringkasan

Checklist digital per alat (unit medis) yang sedang diinstal di lokasi customer,
dengan 5 langkah **sekuensial** — tiap langkah cuma bisa ditandai selesai kalau
langkah sebelumnya sudah selesai:

```
PO control → SJ (Surat Jalan) → Teknisi assign → Training done → BAST
```

BAST = lifecycle selesai (alat resmi terinstal & diserah-terimakan).

## Cara kerja

- **Tabel**: `installation_unit` (`infra/postgres/init/068_installation_lifecycle.sql`).
  Self-contained — `teknisi_name`/`customer_name`/`po_number`/`bast_number` semua
  kolom teks bebas, tanpa FK ke domain lain, kecuali kolom `sj_number` (lihat
  bagian "Integrasi Accurate" di bawah).
- **API**: `apps/api/src/repo/installation.ts` + routes di `apps/api/src/index.ts`
  (`POST/GET /installations`, `POST /installations/:id/<step>`). Tiap fungsi
  transisi (`markPoControl`, `markSj`, dst) validasi manual: langkah sebelumnya
  harus `*_done = true` dulu, kalau belum → error 400 pesan jelas.
- **Web**: halaman `/installations` (grup nav Operations) — tabel + progress
  dots 5 langkah + dialog aksi per-langkah (`installation-row-actions.tsx`).

## Integrasi Accurate (SJ)

Langkah **SJ** sumber datanya dari mirror Accurate (`accurate_delivery_order`),
**bukan** input teks bebas — dropdown pilih dari SJ yang sudah ke-sync, via
proxy baru `GET /api/shipments` → `GET /accurate/shipments` (endpoint backend
sudah ada sebelumnya, dipakai fitur Shipments).

Ini **exception domain CRM/Accurate yang disetujui Direktur khusus untuk F22**
(domain CRM/Accurate normalnya off-limits buat magang, lihat `ONBOARDING.md`
§2). Scope-nya dijaga sempit:
- **Read-only lookup saja** — tidak ada FK ke `accurate_delivery_order.id`,
  tidak nampilin detail SJ Accurate di halaman F22.
- Nilai tetap disimpan sebagai teks (`installation_unit.sj_number` = string
  `accurate_delivery_order.number`), skema tabel `installation_unit` tidak
  berubah.
- **Fallback graceful**: kalau mirror Accurate kosong/gagal fetch, dropdown
  otomatis balik jadi input teks manual — tidak nge-block user.

> ⚠️ Exception ini SPESIFIK untuk SJ F22. Jangan dianggap "boleh" utk fitur lain
> yang mau baca data CRM/Accurate lainnya (Customers/Orders/dst) tanpa
> konfirmasi Direktur yang sama.

## Keputusan desain

1. **Urutan ketat** — tidak bisa skip langkah, tidak bisa mundur.
2. **PO number ditangkap saat create**, tapi `po_control_done` tetap butuh
   aksi eksplisit terpisah (bukan auto-complete saat create).
3. **Tidak ada fungsi delete** — ini record lifecycle/audit, bukan data yang
   perlu dihapus.
4. **`training_notes` opsional** — cuma PO/SJ/BAST yang punya nomor referensi.

## Verifikasi

```bash
# buat unit baru
curl -X POST localhost:4000/installations -H 'content-type: application/json' \
  -d '{"alat_name":"USG X1","customer_name":"RS Test"}'

# urutan salah (harus 400)
curl -X POST localhost:4000/installations/<id>/sj -d '{"sj_number":"SJ-1"}' \
  -H 'content-type: application/json'
# → {"ok":false,"error":"PO control belum selesai — selesaikan langkah sebelumnya dulu"}

# urutan benar
curl -X POST localhost:4000/installations/<id>/po-control -d '{"po_number":"PO-1"}' -H 'content-type: application/json'
curl -X POST localhost:4000/installations/<id>/sj -d '{"sj_number":"SJ-1"}' -H 'content-type: application/json'
# → 200
```

Browser: `/installations` — create via sheet, jalankan tiap langkah lewat row
action (langkah SJ pakai dropdown Accurate).

## Terkait

- [F24 — PM & Kalibrasi Schedule](./F24-pm-kalibrasi-schedule.md) — dibangun DI
  ATAS branch F22 (butuh `installation_unit.bast_at`).
- [F26 — Service Ticket Triage](./F26-service-ticket-triage.md) — berdiri
  sendiri, tidak terhubung ke F22.
