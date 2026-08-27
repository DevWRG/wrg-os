# Local Dev Setup — Database & App

Panduan menyiapkan **DB lokal sendiri** di tiap laptop (kamu + tim), terpisah
dari prod di server. Tiap dev punya Postgres lokal → bebas trial tanpa nyentuh
data prod.

> Server prod (Mac `development`) auto-deploy setiap merge ke `main`. Develop di
> laptop masing-masing, jangan langsung di server.

---

## Cara A — Docker (REKOMENDASI untuk tim)

Paling konsisten: semua dapet Postgres 16 + pgvector identik, schema auto-apply.

```bash
# 1) Install Docker Desktop (sekali per laptop)

# 2) Clone + masuk repo
git clone https://github.com/DevWRG/wrg-os && cd wrg-os

# 3) Siapkan .env
cp .env.example .env
#    edit .env → set PG_PASSWORD (bebas, mis. wrg_dev_pw)
#    set DATABASE_URL (lihat catatan port di bawah):
#    DATABASE_URL=postgres://wrg:<PG_PASSWORD>@localhost:5433/wrg_os

# 4) Nyalakan Postgres — schema 38 file (infra/postgres/init/*.sql) auto-ter-apply
docker compose up -d postgres
docker compose logs -f postgres      # tunggu "database system is ready to accept connections"

# 5) Seed data demo (opsional, biar nggak kosong)
psql "$DATABASE_URL" -f scripts/db/seed-dev.sql

# 6) Jalankan app
pnpm install
pnpm dev          # api :4000, web :3000, ai :8000

# 7) Bikin user admin pertama (DB kosong → /auth/register boleh tanpa token)
curl -X POST http://localhost:4000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@wahanalifeline.co.id","password":"rahasia123","name":"You","role":"admin"}'
```

### ⚠️ Catatan port (PENTING)
`docker-compose.yml` memetakan Postgres ke **host port `5433`** (bukan 5432), DB
default **`wrg_os`** (`PG_DB`). Jadi saat app jalan **native** (`pnpm dev`) dan DB
di Docker, `DATABASE_URL` harus:

```
postgres://wrg:<PG_PASSWORD>@localhost:5433/wrg_os
```

Form `@postgres:5432` di `.env.example` hanya untuk saat **app juga jalan di
dalam Docker** (jaringan container).

---

## Cara B — Postgres native (tanpa Docker)

```bash
brew install postgresql@16 pgvector
brew services start postgresql@16

createuser -s wrg 2>/dev/null || true
createdb -O wrg wrg_os_dev

# apply schema berurutan 001..038
for f in infra/postgres/init/*.sql; do psql -d wrg_os_dev -f "$f"; done

# seed opsional
psql -d wrg_os_dev -f scripts/db/seed-dev.sql

# .env: DATABASE_URL=postgres://localhost:5432/wrg_os_dev (cocok .env.example)
```

pgvector wajib (extension `vector` di `001_extensions.sql`).

---

## Reset DB lokal (mulai bersih)

```bash
bash scripts/db/local-reset.sh        # Docker: hapus volume + re-init + seed
```

Lihat header script untuk opsi.

---

## Data & seed

- Schema saja TIDAK memuat data bisnis (cuma struktur + sedikit referensi
  governance). DB mulai kosong.
- `scripts/db/seed-dev.sql` → data **sintetis** kecil (beberapa AM demo + plan +
  report). Idempoten (boleh diulang). Bukan dump prod — nol data sensitif.
- Untuk login: bikin admin via `/auth/register` (bootstrap saat 0 user).

## Trial fitur inbound #PLAN/#REPORT lokal

Tanpa gateway WA, kirim pesan simulasi langsung ke endpoint:

```bash
# WA_INBOUND_PROCESS=true di .env biar diproses
curl -X POST http://localhost:4000/webhooks/wa -H 'content-type: application/json' \
  -d '{"group_jid":"120363000000000001@g.us","sender":"120363000000000001@g.us",
       "sender_name":"Budi","body":"#Report Budi\n1. kunjungan RS A - selesai","message_id":"demo-1"}'
```

Response curl-nya cuma status pemrosesan, **bukan** isi balasan. Teks balasan
utuh dicetak ke **log server** (terminal `pnpm dev`), diapit `--- pesan ---`:

```
[wa] STUB (WA_SEND_URL kosong) — tidak kirim live → 120363000000000001@g.us
--- pesan ---
✅ Report Budi tercatat ...
--- selesai ---
```

Berlaku selama `WA_SEND_URL` kosong (stub) atau `WA_DRY_RUN != false` — dua-duanya
default di dev, jadi tak ada yang perlu di-set. `sender_name` harus cocok dengan
`master_user` (jalankan `scripts/db/seed-dev.sql` dulu — di situ ada AM demo
"Budi"), kalau tidak inbound balas `skipped: unknown-sender`.

---

## Trial `#CEK CUSTOMER` (QW3) lokal

Sama seperti trial di atas (tanpa gateway WA sungguhan) — `curl` saja sudah cukup,
balasan tercetak ke log server persis seperti dijelaskan di section sebelumnya.

```bash
# 1) WA_INBOUND_PROCESS=true di .env, lalu (re)start `pnpm dev`

# 2) Seed AM demo dulu — WAJIB, lihat "Jebakan" di bawah
psql "$DATABASE_URL" -f scripts/db/seed-dev.sql

# 3) Seed data dummy customer (sekali, idempoten)
psql "$DATABASE_URL" -f scripts/db/seed-cek-dev.sql

# 4) Kirim command — balasan tercetak di terminal pnpm dev (bukan di response curl)
curl -X POST http://localhost:4000/webhooks/wa -H 'content-type: application/json' \
  -d '{"group_jid":"120363000000000001@g.us","sender":"120363000000000001@g.us",
       "sender_name":"Budi","body":"#CEK CUSTOMER PT Testing","message_id":"demo-cek-1"}'
```

Nama customer dummy yang tersedia (`scripts/db/seed-cek-dev.sql`): `PT Testing` /
`RS Sehat Sentosa` (SO+SJ lengkap), `PT Alpha Order` (SO saja) / `CV Beta Kirim`
(SJ saja), `CV Sample Satu` / `CV Sample Dua` (nama sengaja mirip — demonstrasi
*known limitation* fuzzy-match independen SO/SJ, lihat
`docs/features/F4-cek-faktur-so-sj-cross-ref.md`).

### Jebakan

- **`seed-dev.sql` prasyarat keras, bukan opsional.** `#CEK` menolak pengirim tak
  dikenal karena balasannya berisi data komersial (`inbound.ts:747`). Resolusinya
  `resolveSender` Tier C pushname → `master_user` (`master.ts:287`). Tanpa AM demo
  "Budi" dari `seed-dev.sql`, hasilnya `skipped: unknown-sender` — bukan error,
  jadi gampang bikin bingung kalau langkah 2 di atas ke-skip.
- Port **4000** (dev), bukan 4100 (prod).
- Baris `· AM:` **tidak akan pernah muncul di lokal.** Itu live call ke Accurate
  (`getSalesOrderItems`), kredensial tidak tersedia di dev, dan `catch`-nya sengaja
  diam supaya balasan SO/SJ tetap jalan (`inbound-cek.ts:62-70`). Perilaku yang
  diharapkan, bukan kegagalan.

Selesai tes → kembalikan `WA_INBOUND_PROCESS=false` di `.env` (default aman). Data
seed boleh dibiarkan (dummy, id ≥ 900010, tak bentrok data asli, tak satu pun seed
lain punya cleanup script).

---

Lihat juga: `docs/runbook-gateway-recovery.md`, `scripts/migrate/README.md`
(migrasi data legacy — hanya relevan di server, butuh akses `wrg_crm_prod`).
