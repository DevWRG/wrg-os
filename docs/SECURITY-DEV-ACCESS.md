# Akses Dev & Proteksi Produksi (tim outsource)

Tujuan: tim dev (termasuk **outsource**) bisa develop penuh, **tanpa** bisa
menyentuh / merusak DB & sistem **produksi**. Model berlapis (defense-in-depth).

## Prinsip inti
> Outsource bekerja **100% di lokal** (DB sendiri di laptop). Mereka **tidak
> pernah** punya: kredensial prod, akses jaringan ke prod, data prod, atau
> kemampuan merge ke `main`.

## Lapisan proteksi

### 1. Isolasi jaringan prod (paling kuat)
- Postgres prod `listen_addresses=localhost` → bind `127.0.0.1`/`::1` saja.
  **Tidak ter-expose ke internet/LAN.** Akses hanya dari mesin server (atau via
  Tailscale tailnet untuk yg di-authorize).
- Outsource **tidak di tailnet** → secara fisik tak ada rute ke DB prod.
- Dashboard prod publik (Cloudflare) di-gate login app + (opsional) Cloudflare Access.

### 2. Tanpa kredensial / data prod di laptop outsource
- `.env.prod` **gitignored** — tidak pernah di-repo, tidak dibagikan.
- Outsource pakai **`.env` lokal** sendiri (dari `.env.example`, nilai lokal/dummy).
- Seed lokal = **sintetis** (`scripts/db/seed-dev.sql`), **bukan** dump prod.
  JANGAN pernah kirim dump DB prod ke laptop outsource.
- API key / secret prod (OpenRouter, WA, webhook, JWT) tak pernah dibagikan;
  lokal pakai nilai dummy / mode dry-run (`WA_DRY_RUN=true`, dst).

### 3. Gerbang GitHub (review wajib)
- Akses repo outsource = **Write** (push branch), **bukan** Admin.
- `main` **protected**: wajib PR + review; tidak bisa push langsung.
- **CODEOWNERS** (`.github/CODEOWNERS`): PR yang menyentuh `infra/`, `scripts/`,
  `ecosystem.config.cjs`, `.github/`, `.env*`, docker-compose, docs ops → **wajib
  approval @gspmna (Husni)**.
  - ⚙️ Aktifkan: Settings → Branches → `main` → **Require review from Code Owners** = ON.
- Promote `dev → main` = **hanya owner/Husni** (main-merge gate).

### 4. Migrasi DB tak pernah auto ke prod
- Auto-deploy (`scripts/ops/auto-deploy.sh`) **alert-only** untuk
  `infra/postgres/init/*` → schema prod TIDAK berubah otomatis.
- Migrasi ke prod = **manual, oleh owner, dengan backup**:
  `bash scripts/db/migrate.sh --prod --backup` (lihat `docs/MIGRATIONS.md`).
- Migrasi dari outsource masuk sebagai file di PR → di-review (CODEOWNERS) →
  baru owner apply ke prod.

### 5. Least-privilege DB role (migrasi `039_least_priv_roles.sql`)
App **default** konek sebagai superuser (`development`, peer auth) → punya
DDL/DROP penuh di prod. Migrasi `039` bikin role terbatas:
- **`wrg_app`** = DML saja (SELECT/INSERT/UPDATE/DELETE) + sequence. TANPA DDL/DROP.
- **`wrg_readonly`** = SELECT saja (analitik/debug).
- DDL/migrasi tetap role owner (`development`/`wrg`) via `migrate.sh --prod`.
- Role dibuat **tanpa password** (dormant) oleh migrasi — password di-set saat cutover.

#### Cutover prod ke `wrg_app` (manual, owner, dengan rollback)
```bash
# 1) apply migrasi 039 (bikin role dormant) — dgn backup
bash scripts/db/migrate.sh --prod --backup

# 2) set password wrg_app (HANYA di prod; simpan ke .env.prod, jangan commit)
PW=$(openssl rand -hex 24)
psql -d wrg_os_prod -c "ALTER ROLE wrg_app PASSWORD '$PW';"

# 3) pastikan pg_hba izinkan login TCP wrg_app (scram/md5). Cek:
#    psql -d wrg_os_prod -c "SHOW hba_file;"  → pastikan ada baris utk localhost
#    (kalau perlu tambah: host wrg_os_prod wrg_app 127.0.0.1/32 scram-sha-256
#     lalu: psql -c "SELECT pg_reload_conf();")

# 4) update .env.prod:
#    DATABASE_URL=postgres://wrg_app:<PW>@localhost:5432/wrg_os_prod

# 5) restart api (bentuk ecosystem → reload .env.prod)
pm2 restart ecosystem.config.cjs --only wrg-prod-api --update-env

# 6) VERIFIKASI: /health db=ok, login web, sebuah write (mis. #report) tercatat.
curl -s localhost:4100/health     # {"db":"ok"}

# ROLLBACK (kalau ada masalah, mis. permission denied):
#    kembalikan DATABASE_URL=postgres://localhost:5432/wrg_os_prod (peer=development)
#    pm2 restart ecosystem.config.cjs --only wrg-prod-api --update-env
```
> Belum di-cutover di prod sampai langkah di atas dijalankan sengaja oleh owner.
> Migrasi 039 sendiri AMAN (cuma bikin role dormant + grant, tak ubah koneksi app).

## Checklist saat menambah anggota outsource
- [ ] Invite ke repo sebagai **Write** (bukan Admin/Maintain).
- [ ] Pastikan branch protection `main`: require PR review + **Code Owners** ON.
- [ ] JANGAN bagikan `.env.prod`, kredensial DB prod, atau dump data prod.
- [ ] Arahkan ke `docs/LOCAL-DEV.md` (setup DB lokal sendiri).
- [ ] Mereka develop di branch → PR → `dev`; promote ke `main` tetap owner.
- [ ] (Hardening) cutover prod ke role `wrg_app` (least-privilege) — lihat §5.

Lihat juga: `docs/LOCAL-DEV.md`, `docs/MIGRATIONS.md`.
