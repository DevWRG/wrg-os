# F139 — GA Helpdesk Ticket System (Ticketing Kendala Operasional)

| | |
|---|---|
| Domain | GA (General Affairs) |
| Hashtag | #HELPDESK aktif; **#TICKET (brief) sengaja belum diaktifkan** |
| FR | FR-GA-139 |
| Tier | R1 |
| Prioritas | MUST |
| Sprint | S14 |
| Owner | Husni (HoD BD & GA) · Dito (assignee dispatcher, Accountable BSC) |
| Branch | `feat/f139-ga-helpdesk-ticket`, standalone dari `dev` (migrasi 092) |

## Ringkasan

Ticketing kendala operasional (bukan sempit "keluhan fasilitas AC/lampu/WiFi"
— itu cuma contoh kategori; kategori sendiri bebas diisi Admin via CRUD).
Reporter = siapa pun (karyawan), assignee = Admin GA/Teknisi cabang. State
machine sederhana (5 status forward + cancelled), SLA otomatis per kategori,
**tracking progres via timeline** (arahan Direktur — reporter bisa lihat
riwayat status dari awal sampai sekarang, bukan cuma badge terakhir).

> **Reframing dari Direktur** (setelah draft plan awal): brief awal terlalu
> sempit ("Helpdesk Ticket System" utk keluhan fasilitas). Direktur klarifikasi
> ini lebih tepat "ticketing kendala operasional" secara umum + wajib bisa
> lihat tracking progres. Ini yang mendasari keputusan desain timeline di bawah.

## Keputusan desain (dikonfirmasi user via AskUserQuestion sebelum coding)

1. **State machine ikut brief (simpel), BUKAN source asli `gais/tickets.js`**
   (7 status termasuk `assigned`+`waiting_vendor`, boleh mundur bebas). Brief
   dipilih krn lebih simpel — konsekuensi: F139 **tidak** butuh FK ke `ga_vendor`
   (F137), jadi **standalone dari `dev`**, bukan di atas lineage GA F132/F133/F137.
2. **Assignee/reporter reuse `/app-users`** (picker generik, endpoint yang
   sama baru saja di-dedupe ke F132 sesi ini) — **BUKAN** roster khusus baru
   spt `teknisi_capacity` (F8). Hybrid: FK `*_user_id` + `*_name_override`
   (pola PIC F132), jadi tetap bisa isi nama bebas kalau orangnya belum punya
   akun `app_user`.
3. **HoD escalation = FIXED Husni**, bukan resolver dinamis per-assignee.
   Riset membuktikan **tidak ada sumber data "siapa atasan siapa"** di sistem
   — `app_user.hod_key` artinya KEBALIK (utk HoD scope timnya sendiri, bukan
   link bawahan→atasan), dan HoD sendiri (`hod-resolver.ts` `HODS` array)
   tidak punya baris di tabel `employee`. Resolve via
   `app_user WHERE hod_key='husni' LIMIT 1` — cocok RACI brief (1 HoD utk
   seluruh proses F139).
4. **Hanya `#HELPDESK` diaktifkan.** Brief sebut 2 hashtag (`#TICKET
   #HELPDESK`) — `#TICKET` SENGAJA didiamkan (bukan dihapus dari brief, cuma
   belum di-scope sesi ini).
5. **SLA kalender biasa**, BUKAN `businessHoursFromNow` (F52, 24/5 khusus IT
   asset). Brief F139 tak sebut 24/5 sama sekali.

## Cara kerja

- **Tabel** (`infra/postgres/init/092_ga_helpdesk_ticket_system.sql`):
  - `ga_ticket_categories` — kode+nama+icon+SLA default (jam)+prioritas
    default. Pola persis `ga_asset_categories` (F132) + 2 kolom SLA baru.
    Seed 1 kategori fallback `UMUM` (dipakai `#HELPDESK` yang belum sempat
    pilih kategori spesifik).
  - `ga_tickets` — `ticket_no` auto-gen `TKT-YYYY-NNNNN` (pola `ga_assets.
    asset_code`), hybrid reporter/assignee via `app_user`, `status` CHECK
    (`open/in_progress/waiting/completed/closed/cancelled`), timestamp per
    stage, `rating` (1-5, post-completion), `sla_alert_sent_at` (anti-broadcast).
  - `ga_ticket_comments` — internal vs eksternal (`is_internal`).
  - `ga_ticket_status_log` — **1 baris per transition sukses**, termasuk
    siklus berulang `waiting⇄in_progress` — sumber timeline, BUKAN kolom
    timestamp tetap yang cuma nampung 1× per stage.
- **State machine** (`apps/api/src/repo/ga-helpdesk.ts`, `TRANSITIONS` map
  in-code): `open→in_progress→waiting⇄in_progress→completed→closed`,
  `cancelled` dari `open/in_progress/waiting`. Endpoint tunggal
  `POST /ga-tickets/:id/transition {to}`.
- **SLA**: `sla_due_at = now + (sla_hours_override ?? category.
  default_sla_hours) jam` (kalender). Overdue: `GET /ga-tickets?overdue=1`.
- **Timeline progres**: `GET /ga-tickets/:id/timeline` — union
  `ga_ticket_status_log` + `ga_ticket_comments`, urut waktu. Ditampilkan di
  web sbg dialog vertical timeline (`GaTicketTimelineButton`).
- **Alert overdue** (cron `ga-helpdesk-overdue`, flag `GA_HELPDESK_OVERDUE_ENABLED`,
  default `15 7 * * *`): WA ke assignee (`app_user.wa_number`) **+ fixed
  Husni** (`app_user WHERE hod_key='husni'`). Anti-broadcast: `sla_alert_sent_at`
  ditulis HANYA kalau `gateway.sent && !gateway.stub && !gateway.dryRun`
  (pola F52/F38). Trigger manual: `POST /ga-tickets/overdue-alert/run`.
- **BSC feed** (cron `ga-helpdesk-bsc-feed`, flag `GA_HELPDESK_BSC_ENABLED`,
  bulanan `15 2 1 * *`): `runGaHelpdeskBscFeed()` — kloning pola
  `runGaMaintenanceBscFeed` (F137), isi `kpi_measurement` KPI baru
  `employee_id='dito', name='SLA compliance % (Helpdesk Tiket)'`. Formula
  achievement: % tiket bulan itu yang `completed_at <= sla_due_at` —
  **ASUMSI teknis** (brief cuma sebut nama KPI, bukan rumus), gampang diganti
  tanpa ubah skema.
- **WA inbound `#HELPDESK`** (`apps/api/src/repo/inbound.ts`, EXTEND —
  regex baru di `detectKind()` + SQL pre-filter `processUnprocessed()`):
  buat `ga_tickets` langsung, kategori fallback `UMUM`, **reporter TIDAK
  di-resolve ke `app_user`** (tak ada roster/fuzzy-match reliable utk sender
  WA umum di luar AM/Teknisi) — pakai `reporter_name_override` = pushname WA
  apa adanya. **ASUMSI rancangan** (belum sempat dikonfirmasi user detail
  perilakunya, cuma scope on/off-nya `#HELPDESK` saja), gampang direvisi.
- **Web**: `/ga-helpdesk` (section nav "GA", item ke-1 — belum ada section
  GA lain di `dev` krn F132 belum merge), 2 tab (Tiket/Kategori), pola persis
  F132 `GaAssetView`. Filter status + toggle overdue client-side (bukan
  server round-trip — sederhana, cukup utk volume tiket GA).

## RBAC

Feature key `ga-helpdesk` (auto-derive dari slug route, `nav.ts`). Default
akses: siapa pun login (sesuai brief "reporter karyawan") — belum ada
pembatasan lebih granular (mis. CRUD kategori khusus admin) di rilis awal ini.

## Gotcha yang ditemukan & diperbaiki

1. **SQL pre-filter `processUnprocessed()` punya regex TERPISAH** dari
   `detectKind()` — nambah hashtag baru WAJIB update KEDUANYA
   (`inbound.ts` baris regex `body ~* '#\\s*(plan|report|...)'`). Sempat
   lupa update yang SQL, `#HELPDESK` terdeteksi benar oleh `detectKind()`
   tapi baris pesannya tidak pernah ke-SELECT sbg kandidat sama sekali
   (`processed:0` diam-diam, tanpa error) — ketahuan pas test end-to-end,
   sudah diperbaiki. **Pelajaran utk fitur WA hashtag berikutnya: cek 2
   tempat, bukan cuma `detectKind()`.**
2. **`sql\`${sql.unsafe(str)} WHERE ...\`` TIDAK reliable** (pelajaran lama
   F52, sempat mau dipakai lagi utk share SELECT+JOIN antar fungsi) — ditulis
   ulang jadi query lengkap per fungsi, bukan compose lewat `sql.unsafe`.
3. **Fragment `sql\`\`` (kosong) tetap truthy sbg object** — trik
   `cond ? sql\`, ${x}\` : sql\`\`` di `transitionTicket` awalnya bikin SQL
   invalid (trailing comma) utk transisi yang tak punya stage-timestamp.
   Diganti cabang if/else lengkap per status tujuan.

## Verifikasi (dilakukan end-to-end, data uji sudah dihapus)

Lifecycle penuh via curl: create → transition invalid (ditolak) → transition
valid berantai termasuk siklus `waiting→in_progress→waiting→in_progress` →
comment (internal) → completed → rate (1-5) → closed → transition dari
closed (ditolak). Timeline mencatat SEMUA transition termasuk siklus
berulang. `#HELPDESK` via simulasi `wa_message` → tiket tercipta, reporter =
pushname WA, balasan berisi `ticket_no`. Overdue alert: dipaksa `sla_due_at`
masa lalu, trigger manual, target Husni disimulasikan via `app_user.hod_key`
sementara — `alerts:0` & `sla_alert_sent_at` NULL di mode stub (anti-broadcast
benar). BSC feed: trigger manual (tsx script sekali pakai), `kpi_measurement`
ter-upsert (`achievement_pct` sesuai proporsi tiket on-time bulan itu).
Typecheck + lint + build (api & web) bersih.

## Belum dilakukan / open item

- Push + PR (menunggu review user, sesuai instruksi "kerjakan per fitur,
  jangan push dulu").
- `#TICKET` hashtag (brief) — sengaja belum diaktifkan.
- Perilaku detail `#HELPDESK` (resolusi reporter, kategori auto-classify
  dari teks) belum dikonfirmasi user — implementasi saat ini adalah asumsi
  rancangan minimal viable.
- RBAC granular (kategori CRUD admin-only) belum dibangun — semua user login
  saat ini bisa akses semua aksi di halaman ini.

## Terkait

- [[F132 GA Aset Master]] — pola hybrid PIC & tab-CRUD-in-1-page direplikasi
  dari sini, TAPI F139 standalone (tak FK ke tabel F132 apa pun).
- [[F52 IT Asset & Issue Tracker]] — pola anti-broadcast `sla_alert_sent_at`
  & `businessHoursFromNow` (yang justru TIDAK dipakai F139) berasal dari sini.
- [[F137 GA Maintenance Tracker]] — pola BSC-feed `kpi_measurement` (preseden
  pertama) direplikasi 1:1 di `runGaHelpdeskBscFeed`.
