# Onboarding Tim Outsource — WRG-OS

Selamat datang. Dokumen ini **wajib dibaca sebelum menyentuh kode**. Aturan di
sini bukan saran — ini pagar (gate) yang ditetapkan Direktur. Melanggar =
PR ditolak.

> Ringkas: kerja **hanya di branch `dev`** lewat PR, **jangan pernah** sentuh
> `main`, **jangan** kerjakan domain terlarang (Management, Infrastruktur, CRM,
> HR), **selalu** pakai database dummy lokal, dan **kabari Direktur** kalau PR
> butuh perubahan/migrasi database.

---

## 1. Aturan Branch (PALING PENTING)

```
feature/*  ──PR──▶  dev   ──(hanya Direktur)──▶  main  ──▶ auto-deploy prod
```

- **`main` = HARAM disentuh tim outsource.** Branch ini terproteksi; push langsung
  diblokir. Promosi `dev → main` **hanya** dilakukan Direktur (dia yang buka &
  approve PR-nya). Jangan pernah buka PR dengan base `main`.
- **Semua kerjaan lewat `dev`:**
  1. `git checkout dev && git pull`
  2. `git checkout -b feat/f<NN>-deskripsi-singkat` (sertakan **F-number** dari
     board — lihat §5)
  3. Buka PR dengan **base `dev`** (default). Tunggu CI hijau.
  4. Setelah di-review Direktur/lead, di-merge ke `dev`.
- Rilis ke prod adalah urusan Direktur. Tim outsource **berhenti di `dev`**.

---

## 2. Domain TERLARANG (jangan dikerjakan)

Tim outsource **tidak boleh** membuat/mengubah fitur di 4 domain ini. Kalau tugas
yang diberikan ternyata menyentuh salah satunya → **STOP, tanya Direktur dulu.**

| Domain | Contoh area/kode yang OFF-LIMITS |
|---|---|
| **Management / Managerial** | RBAC & scope (`apps/api/src/repo/access-scope.ts`, `rbac.ts`), endpoint `/admin/*`, dashboard eksekutif (`/dashboard/overview`, executive), OKR/KPI, provisioning user, rollup manajerial `monitor_digest` |
| **Infrastruktur** | `infra/`, `.github/workflows/`, `scripts/ops/*` (deploy/auto-deploy), `scripts/db/migrate.sh` (runner), `docker-compose*.yml`, `ecosystem.config.cjs`, Dockerfile, `.env*`, LaunchAgent/poller, GHCR |
| **CRM** | `apps/api/src/repo/{account,customer,deal,contact}.ts`, tabel `crm_*`, endpoint `/accounts` `/customers` `/deals`, menu Accounts/Customers/Pipeline/Orders/Shipments, mirror Accurate (`accurate_*`), kepemilikan/scope (`owner_am_id`) |
| **HR** | `master_user`, `app_user`, `user_leave`, HRD, roster karyawan, plan/report karyawan, `monitor_member`, `/admin/users` |

**Yang BOLEH:** fitur produk yang diberikan Direktur/lead lewat item board (F-number)
yang **di luar** 4 domain di atas — mis. perbaikan UI non-sensitif, widget laporan
biasa, bug fix di area yang ditugaskan. Kalau ragu apakah suatu tugas masuk domain
terlarang → **anggap terlarang, tanya dulu.**

### Di mana daftar fitur & tugasmu?
Fitur dilacak di board **WRG-OS Roadmap** (item ber-F-number, status otomatis dari PR).
**Kamu tidak otomatis dapat akses board penuh** — Direktur memberi **F-number spesifik /
view yang sudah difilter** untuk tugasmu. Kerjakan hanya F-number yang ditugaskan (dan di
luar domain terlarang di atas). Belum jelas F-number-mu? Tanya Direktur.

---

## 3. Gate Direktur yang WAJIB ditegakkan

Setiap PR harus lolos SEMUA ini (bukan opsional):

1. **CI hijau** (otomatis jalan di PR ke `dev`):
   - `Lint · Typecheck · Build (pnpm)` — `pnpm lint`, `pnpm typecheck`, `pnpm build`
   - `services/ai import check`
   PR tidak boleh di-merge sebelum kedua check hijau.
2. **Conventional Commits.** Pesan commit: `feat:`, `fix:`, `chore(scope): …`,
   `docs:`, `refactor:`. Ini menentukan auto-versioning saat rilis. Jangan asal.
3. **Branch protection `main`** — jangan diakali. Tidak ada push langsung, tidak ada
   force-push, tidak ada bypass.
4. **Roadmap Project #2** — PR ber-F-number otomatis update status board
   (In Progress → Done). Selalu cantumkan F-number di nama branch & judul PR.
5. **Jangan bypass `pnpm minimumReleaseAge`** — dilarang trik `--lockfile`/downgrade
   demi lolos. Pakai lockfile apa adanya.
6. **Jangan sentuh sistem legacy Python (port 8090/8091/8092)** dan **jangan** sentuh
   prod / deploy / server. Itu ranah Direktur.
7. **Rahasia hanya di `.env`** (gitignored). Jangan commit/print secret. `.env.example`
   cuma placeholder.

---

## 4. Database Dummy Lokal (WAJIB per fitur)

**Dilarang** develop/test langsung ke DB prod. **Setiap** pengembangan fitur harus
pakai **Postgres dummy di laptop sendiri**, terpisah total dari prod.

Ikuti **`docs/LOCAL-DEV.md`**:
- **Cara A (rekomendasi):** Docker — `docker compose up -d postgres` (schema
  `infra/postgres/init/*.sql` auto-apply), lalu seed: `psql "$DATABASE_URL" -f scripts/db/seed-dev.sql`.
- **Cara B:** Postgres native + apply schema berurutan + seed.
- Reset kapan pun dengan `scripts/db/local-reset.sh`.

Verifikasi fitur jalan di DB dummy (`pnpm dev` → api:4000 web:3000 ai:8000) **sebelum**
buka PR. Kalau butuh data, pakai `seed-dev.sql` — **jangan** copy data prod.

---

## 5. Kalau fitur butuh perubahan / migrasi Database

Ini paling sering bikin masalah, jadi diatur ketat:

1. Migrasi = **file SQL BARU** di `infra/postgres/init/NNN_*.sql` (nomor tertinggi+1),
   **additive + idempoten** (`IF NOT EXISTS`, kolom nullable/DEFAULT). **Jangan**
   edit file migrasi lama. Ikuti **`docs/MIGRATIONS.md`** (expand-contract untuk
   perubahan berisiko).
2. **Test migrasi di DB dummy lokal dulu** (`bash scripts/db/migrate.sh`), pastikan
   app tetap jalan.
3. **WAJIB: kalau PR-mu menambah/mengubah struktur DB (tabel/kolom/migrasi baru),
   TULIS JELAS di deskripsi PR** — beri label/section **"⚠️ BUTUH MIGRASI DB"** +
   ringkas apa yang berubah — **dan kabari Direktur langsung.** Direktur yang
   meng-apply ke prod (dengan backup). Jangan pernah apply ke prod sendiri.
4. Tim outsource **tidak** mengurus deploy/apply prod sama sekali.

---

## 6. Checklist sebelum buka PR

- [ ] Branch dari `dev`, base PR = `dev` (bukan `main`).
- [ ] Nama branch & judul PR memuat **F-number** (mis. `feat/f210-...` / `feat(F210): ...`).
- [ ] Commit pakai **Conventional Commits**.
- [ ] Tidak menyentuh domain terlarang (Management/Infra/CRM/HR) — kalau iya, sudah izin Direktur.
- [ ] Diuji di **DB dummy lokal**, `pnpm lint/typecheck/build` lolos lokal.
- [ ] Kalau ada perubahan DB → section **"⚠️ BUTUH MIGRASI DB"** di PR + kabari Direktur.
- [ ] Tidak ada secret ter-commit; tidak menyentuh prod/legacy 8090–8092.

---

## 7. Kalau ragu / mentok

**Tanya Direktur dulu**, jangan asumsi. Lebih baik bertanya daripada menyentuh
sesuatu yang seharusnya tidak. Khususnya: apa pun yang berbau permission/scope,
data karyawan/pelanggan, deploy, atau struktur DB.

## Rujukan
- `CONTRIBUTING.md` — alur branch & auto-versioning
- `docs/LOCAL-DEV.md` — setup DB dummy lokal
- `docs/MIGRATIONS.md` — aturan migrasi schema
- `docs/AUTO-DEPLOY.md` — cara prod di-deploy (referensi; bukan tugas outsource)
- `docs/SECURITY-DEV-ACCESS.md` — batas akses dev
