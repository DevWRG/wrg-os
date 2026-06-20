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

### 5. (Opsional, hardening lanjut) least-privilege DB role
Saat ini app konek via `DATABASE_URL` (role default). Untuk batasi blast-radius:
- Buat role **app** = DML saja (SELECT/INSERT/UPDATE/DELETE), **tanpa** DDL/DROP.
- Role **readonly** untuk analitik.
- DDL/migrasi hanya via role owner (dipakai `migrate.sh --prod` manual).
- Belum diterapkan — lihat checklist di bawah bila mau.

## Checklist saat menambah anggota outsource
- [ ] Invite ke repo sebagai **Write** (bukan Admin/Maintain).
- [ ] Pastikan branch protection `main`: require PR review + **Code Owners** ON.
- [ ] JANGAN bagikan `.env.prod`, kredensial DB prod, atau dump data prod.
- [ ] Arahkan ke `docs/LOCAL-DEV.md` (setup DB lokal sendiri).
- [ ] Mereka develop di branch → PR → `dev`; promote ke `main` tetap owner.
- [ ] (Opsional) terapkan least-privilege DB role di prod.

Lihat juga: `docs/LOCAL-DEV.md`, `docs/MIGRATIONS.md`.
