# Auto-Deploy ke Mac mini (launchd poller)

Promote `dev → main` → dalam ≤2 menit server **otomatis deploy**. Tanpa GitHub
runner, tanpa scope token — cukup 1 script + 1 LaunchAgent di Mac mini (pola sama
dgn pm2 `com.PM2`).

Alur: `scripts/ops/auto-deploy.sh` (dipanggil launchd tiap 120 dtk) → `git fetch
origin main` → kalau maju dari HEAD lokal → deploy **KODE** via
`scripts/ops/deploy-prod.sh --yes --skip-migrate` (pull → build → restart
`wrg-prod-api`/`wrg-prod-web` → smoke test).

> **Migrasi DB = alert-only, BUKAN auto-apply** (prinsip `MIGRATIONS.md`: skema
> prod hanya diubah manusia + `pg_dump` backup). Kamu apply manual saat siap:
> `bash scripts/ops/deploy-prod.sh` (atau langsung `migrate.sh --prod --backup`).

### 🔔 Gate migrasi (biar tidak "silent break")
Sebelumnya poller hanya menulis peringatan ke **log file** → deploy migrasi bisa
lolos diam-diam (kode nge-500 sampai ada yg sadar). Sekarang poller:

1. **Deteksi akurat (pre-pull):** banding daftar `infra/postgres/init/*.sql` di
   `origin/main` vs tabel `schema_migrations` prod. (Deteksi lama baca *working
   tree lama* → migrasi yg baru di-push luput. Ini yg bikin 050 & 051–053 lolos.)
2. **Alert WA LOUD:** kalau ada pending → kirim WA ke `WRG_DEPLOY_ALERT_TO`
   (nomor/JID di `.env.prod`) lewat gateway openclaw (`WA_SEND_URL` + `x-wa-secret`).
   **Edge-trigger:** hanya dikirim saat set pending *berubah* (tak spam tiap siklus).
   Kalau `WRG_DEPLOY_ALERT_TO` kosong → jatuh ke log-only (perilaku lama).
3. **Opsi blok:** set env `WRG_DEPLOY_BLOCK_ON_PENDING=1` (di plist
   `EnvironmentVariables`) → poller **menahan deploy KODE** selama ada migrasi
   pending, sampai di-apply manual. Default `0` = deploy kode tetap jalan (alert-only).

Set tujuan alert (sekali, di `.env.prod` prod):
```bash
echo 'WRG_DEPLOY_ALERT_TO=6285733048855' >> ~/DevWRG/wrg-os/.env.prod   # nomor/JID ops/HoD
```

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
