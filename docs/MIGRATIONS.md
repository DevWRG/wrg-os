# Database Migrations — Cara Aman Update Schema (tanpa ngerusak prod)

Schema = file SQL bernomor di `infra/postgres/init/` (`001_…` … `NNN_…`).
Di-apply berurutan, **idempoten** (`IF NOT EXISTS`). Runner `scripts/db/migrate.sh`
melacak yang sudah jalan di tabel `schema_migrations` → cuma apply yang baru.

## Aturan emas (biar prod aman)

1. **Jangan edit file migrasi yang sudah jalan.** `001…NNN` sudah ke-apply di
   prod — meng-edit-nya bikin drift. Perubahan = **file BARU** nomor berikutnya.
2. **Additive + idempoten.** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`.
   Kolom baru **nullable** atau punya **DEFAULT** → baris lama + app yg lagi jalan
   tidak rusak.
3. **Backward-compatible (expand-contract)** untuk perubahan berisiko
   (rename/drop/ubah tipe). Jangan langsung. Bertahap:
   - **Expand**: tambah struktur baru (kolom/tabel baru), app tulis ke dua-duanya.
   - **Migrate**: backfill data lama → baru.
   - **Switch**: deploy kode yg baca dari struktur baru.
   - **Contract**: setelah stabil, migrasi terpisah utk drop yg lama.
   → app tidak pernah ketemu kolom hilang/incompatible di tengah deploy.
4. **Test di lokal dulu**, jangan langsung prod. Lihat §Alur.
5. **Ke prod = sengaja + backup.** Auto-deploy **alert-only** untuk migrasi
   (tidak auto-apply). Saat ada file migrasi baru di-merge → owner dapat alert WA
   → jalankan runner dengan `--backup`.

## Alur kerja

```
# 1) DEV (laptop) — bikin migrasi baru
#    nomor = tertinggi+1, nama deskriptif
$EDITOR infra/postgres/init/039_tambah_kolom_xyz.sql   # additive + IF NOT EXISTS

# 2) apply ke DB lokal + test
bash scripts/db/migrate.sh            # apply pending ke .env (local)
pnpm dev                              # verifikasi app jalan dgn schema baru

# 3) commit → PR → dev → (promote) main
git add infra/postgres/init/039_*.sql && git commit -m "feat(db): 039 ..."

# 4) MERGE ke main → auto-deploy ALERT "ada migrasi, apply manual" (TIDAK auto-apply)

# 5) PROD (server) — apply sengaja, dgn backup
bash scripts/db/migrate.sh --prod --backup
#    (pg_dump dulu ke ~/DevWRG/ops/db-backups/, lalu apply yg pending)
#    restart app kalau perlu (biasanya auto-deploy sudah handle rebuild kode)
```

## Runner `scripts/db/migrate.sh`

| Perintah | Fungsi |
|---|---|
| `migrate.sh` | apply pending ke DB **local** (`.env`) |
| `migrate.sh --dry-run` | tampilkan yg pending, tanpa eksekusi |
| `migrate.sh --prod --backup` | **prod**: `pg_dump` dulu → apply pending |
| `migrate.sh --baseline` | tandai SEMUA file sekarang = applied **tanpa** jalankan |
| `DATABASE_URL=… migrate.sh` | target DB eksplisit |

- Tracking: tabel `schema_migrations(filename, applied_at)`.
- Per-file transaksional (`psql -1 ON_ERROR_STOP`) → gagal = rollback + berhenti.
- Idempoten: file yg sudah tercatat tidak diulang.

### Adopsi runner di DB yang sudah migrasi manual (sekali)
Prod & DB lama sudah punya schema (di-apply manual sebelum ada runner), tapi
tabel `schema_migrations` belum terisi. Jalankan **sekali**:
```
bash scripts/db/migrate.sh --prod --baseline   # tandai semua file existing = applied
```
Tanpa ini, run pertama akan "apply" ulang semua file (aman karena idempoten,
tapi mubazir). Setelah baseline, hanya migrasi baru yg akan jalan.

## Contoh migrasi yang AMAN vs HATI-HATI

```sql
-- AMAN (additive)
ALTER TABLE master_user ADD COLUMN IF NOT EXISTS email VARCHAR(200);
CREATE TABLE IF NOT EXISTS catatan (id BIGINT PRIMARY KEY, isi TEXT);
CREATE INDEX IF NOT EXISTS idx_x ON sales_plan (am_id, tanggal);

-- HATI-HATI (expand-contract; jangan satu langkah)
--  ❌ ALTER TABLE x DROP COLUMN lama;            -- app lama bisa crash
--  ❌ ALTER TABLE x RENAME COLUMN a TO b;         -- breaking
--  ✅ tahap 1: ADD COLUMN b; backfill b dari a; deploy kode baca b
--  ✅ tahap 2 (migrasi terpisah, setelah stabil): DROP COLUMN a
```

Lihat juga: `docs/LOCAL-DEV.md` (setup DB lokal), `scripts/migrate/README.md`
(ETL data legacy — beda dari migrasi schema).
