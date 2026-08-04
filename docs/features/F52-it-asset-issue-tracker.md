# F52 — IT Asset & Issue Tracker

| | |
|---|---|
| Domain | OPS |
| FR | FR-ES-52 |
| Tier | R1 |
| Prioritas | MUST |
| Sprint | B1 |
| Status | DRAFT-SB1 |
| Owner | Dito, Husni, Sari (fakturis) |
| Branch | `feat/f52-it-asset-issue-tracker` (dari `dev`, standalone) |

## Ringkasan

Ticket system per aset IT (PC ID, masalah, PIC, SLA <2 jam untuk aset kritis).
Motivasi nyata: PC Fakturis pernah offline 11+ jam tanpa sistem pelacakan.

## ⚠️ Update — diserap ke F132 GA Aset Master (2026-08-04)

Arahan Direktur: F132 (GA Aset Master) jadi single source of truth SEMUA
aset kantor, F52 diserap ke situ. Tabel `it_asset` yang dirancang di bawah
**TIDAK PERNAH dibuat** — `it_ticket.asset_id` FK langsung ke `ga_assets`
(F132, migrasi 086), `is_critical` dibaca dari `ga_assets.is_critical`. CRUD
master aset (termasuk aset IT) pindah ke halaman `/ga-aset`; halaman
`/it-asset` sekarang cuma tiket (tanpa tab Aset). Detail lengkap:
`docs/features/F132-ga-aset-master.md`. Sisa dokumen di bawah ini historis
(desain awal sebelum diserap) — bagian tabel `it_asset`/`/it-assets` sudah
tidak berlaku, bagian `it_ticket`/SLA/cron tetap berlaku persis.

## Cara kerja

- **Master aset** — sekarang `ga_assets` (F132), BUKAN `it_asset` sendiri
  lagi (lihat update di atas). CRUD via halaman `/ga-aset`.
- **`is_critical`** — flag PERMANEN per-aset (bukan per-tiket), kolom
  `ga_assets.is_critical`. PC Fakturis ditandai kritis sekali di data aset;
  semua tiket dari aset itu otomatis dapat SLA 2 jam tanpa perlu
  diingat-ingat tiap lapor.
- **Tabel `it_ticket`** — transaksional, status `open` → `in_progress` →
  `resolved`. `sla_due_at` dihitung SEKALI saat create (bukan recompute
  live), dari `businessHoursFromNow()`.
- **SLA "24/5"** (arahan user, ditafsirkan dari deskripsi board): dihitung
  HARI KERJA (Senin–Jumat, skip `master_holiday` sama seperti F14/F45) —
  setiap hari kerja dihitung **24 jam PENUH**, bukan jam kantor 9–5. Akhir
  pekan/libur nasional dilewati TOTAL (tidak menambah durasi SLA sama sekali).
  Default: kritis **2 jam**, normal **24 jam** (`IT_TICKET_SLA_KRITIS_JAM` /
  `IT_TICKET_SLA_NORMAL_JAM`, adjustable).
- **Cron `it-ticket-sla`** (default tiap 30 menit, gate
  `IT_TICKET_SLA_ENABLED`) — alert WA ke `IT_TICKET_SLA_WA_TARGET` untuk
  tiket yang lewat `sla_due_at` & belum `resolved`. Target kosong = skip
  (anti broadcast tak sengaja). Anti-spam: `sla_alert_sent_at` hanya
  ditandai kalau WA benar-benar terkirim (`sent && !stub && !dryRun` —
  pola yang sama dgn fix F37/F45/F50, diterapkan dari awal di sini).
- **Web**: `/it-assets` (grup Operations, CRUD aset) + `/it-tickets` (grup
  Operations, lapor & pantau tiket, badge SLA lewat/on-track).
- **Tanpa hashtag WA** — deskripsi board eksplisit "Hashtag —", semua input
  lewat web.

## Keputusan desain (dikonfirmasi user sebelum coding)

1. **Master aset via CRUD web**, bukan seed — beda dari F50 karena skala
   & frekuensi perubahan lebih tinggi.
2. **Kritis = flag permanen per-aset**, bukan pilihan manual per-tiket.
3. **"24/5" = hari kerja (Senin-Jumat)**, bukan jam operasional 24 jam
   tanpa jeda — ditafsirkan dari klarifikasi user.

## Verifikasi (2026-08-03, lokal)

- `businessHoursFromNow()` diuji langsung (bypass HTTP): start Jumat 23:00
  WIB + 2 jam kritis → Senin 01:00 WIB (weekend dilewati total, cocok
  dengan trace manual). Start Senin 10:00 WIB + 24 jam normal → Selasa
  10:00 WIB (tanpa weekend crossing, hasil sama jam keesokan hari).
- Ticket kritis vs normal: `sla_due_at` beda sesuai `is_critical` aset.
- Transisi status `open` → `in_progress` → `resolved`, `resolved_at` &
  `resolved_note` tersimpan.
- `sla_overdue` terdeteksi benar (tes: mundurkan `sla_due_at` manual).
- Cron alert: tanpa target → 0 alert; target diisi tapi gateway stub →
  tetap 0 alert & `sla_alert_sent_at` TIDAK ditandai (anti-spam bekerja
  sejak awal, bukan ditambal belakangan spt fitur lain).
- Validasi: status invalid → 400; `masalah`/`asset_id` kosong → 400;
  `asset_code` duplikat → 400; ticket ke aset tak ada/nonaktif → 400.
- Typecheck + lint (api & web) bersih. Data uji dihapus.
