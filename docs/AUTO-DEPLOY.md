# Auto-Deploy ke Mac mini (launchd poller)

Promote `dev → main` → dalam ≤2 menit server **otomatis deploy**. Tanpa GitHub
runner, tanpa scope token — cukup 1 script + 1 LaunchAgent di Mac mini (pola sama
dgn pm2 `com.PM2`).

Alur: `scripts/ops/auto-deploy.sh` (dipanggil launchd tiap 120 dtk) → `git fetch
origin main` → kalau maju dari HEAD lokal → `scripts/ops/deploy-prod.sh --yes`
(pull → migrasi `--backup` → build → restart `wrg-prod-api`/`wrg-prod-web` →
smoke test).

**Hanya** menyentuh `wrg-prod-api` & `wrg-prod-web`. Layanan Python legacy
(8090–8092) & wa-bridge **tidak pernah** disentuh.

---

## ⚠️ Prasyarat WAJIB (sekali, di Mac mini)

### 1. Baseline tabel migrasi prod (sekali)
Tanpa ini `migrate.sh --prod` coba apply ulang SEMUA file (idempoten tapi mubazir).
```bash
cd ~/DevWRG/wrg-os            # repo prod
git pull
bash scripts/db/migrate.sh --prod --dry-run    # lihat pending
bash scripts/db/migrate.sh --prod --baseline   # tandai semua existing = applied
```
> Kalau `044_rbac.sql` belum pernah di-apply ke prod: jalankan
> `bash scripts/ops/deploy-prod.sh` manual **sekali** dulu (apply 044 + backup),
> baru baseline + aktifkan poller.

### 2. Pasang LaunchAgent (sekali)
```bash
cd ~/DevWRG/wrg-os
chmod +x scripts/ops/auto-deploy.sh scripts/ops/deploy-prod.sh
mkdir -p ~/DevWRG/ops
cp infra/launchd/com.wrg.autodeploy.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.wrg.autodeploy.plist
```
- Jika repo prod **bukan** di `~/DevWRG/wrg-os`: edit path di plist + set
  `WRG_PROD_DIR` (mis. tambahkan `<key>EnvironmentVariables</key>` di plist).
- Jika username server **bukan** `development`: ganti `/Users/development/...`
  pada `StandardOutPath`/`StandardErrorPath` di plist.
- Pastikan `pnpm pm2 psql node` ada di PATH login shell (`which pnpm pm2 psql`).

---

## Cara kerja sehari-hari
1. `feature/* → PR → dev` (CI hijau, merge).
2. Promote `dev → main` (butuh 1 approval — branch protection).
3. ≤2 menit kemudian poller mendeteksi `main` maju → deploy otomatis → live.
   (`release.yml` tetap cut tag; footer ikut versi rilis.)

## Pantau / jalankan manual
```bash
tail -f ~/DevWRG/ops/auto-deploy.log         # log tiap siklus & deploy
bash scripts/ops/auto-deploy.sh              # paksa cek+deploy sekarang
bash scripts/ops/deploy-prod.sh --dry-run    # lihat rencana tanpa eksekusi
```

## Aman & rollback
- `deploy-prod.sh` selalu `pg_dump` **backup** sebelum migrasi → `~/DevWRG/ops/db-backups/`.
- `lockdir` mencegah deploy tumpang-tindih; deploy gagal otomatis dicoba lagi siklus berikut.
- Rollback: `git checkout <tag-lama> && bash scripts/ops/deploy-prod.sh --yes --skip-migrate`
  (migrasi additive/idempoten; restore DB dari backup bila perlu).

## Matikan auto-deploy
```bash
launchctl unload -w ~/Library/LaunchAgents/com.wrg.autodeploy.plist
```

---

### Alternatif: GitHub Actions (self-hosted runner)
Kalau lebih suka event-driven + log di tab Actions: bisa pakai workflow
`deploy.yml` di runner self-hosted. Butuh `gh auth refresh -s workflow` (scope
`workflow`) utk push file workflow, lalu daftar runner label `wrg-prod`. Tidak
dipakai default karena poller ini nol-friksi. Minta kalau mau di-setup.
