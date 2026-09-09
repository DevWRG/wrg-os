# Runbook — Tumpukan DEV di server

Supaya pengujian berjalan di kode `dev` dan database `dev`, bukan menumpang
prod. Ketiga lapis (tumpukan dev, routing WA masuk, allowlist WA keluar) sudah
mendarat — tapi **dev tetap bisu sampai `WA_DEV_GROUPS` diisi** di `.env.prod`;
lihat bagian "Menghidupkan uji WhatsApp di dev" di bawah.

| | prod | dev |
|---|---|---|
| Branch | `main` | `dev` |
| Checkout | `~/DevWRG/wrg-os` | `~/DevWRG/wrg-os-dev` |
| Database | `wrg_os_prod` | `wrg_os_dev` (atau `_demo`) |
| ai · api · web | 8100 · 4100 · 3100 | 8300 · 4300 · 3300 |
| Kirim WA | ya | hanya ke grup di `WA_DEV_GROUPS`; bisu kalau kosong |
| Scheduler | ya | mati |

## Dua penjaga yang ditegakkan di `ecosystem.config.cjs`

Keduanya di file, bukan diserahkan ke disiplin mengisi `.env`:

1. **Dev tak akan menyala menunjuk database prod.** Kalau `.env.dev` tak ada,
   `DATABASE_URL`-nya kosong, atau namanya bukan `*_dev`/`*_demo`, entri dev
   **dihilangkan sepenuhnya** — prod tetap jalan seperti biasa. Lebih baik tak
   ada tumpukan dev daripada tumpukan dev yang menulis ke prod.
2. **Dev tak bisa mengirim WhatsApp.** `WA_DRY_RUN=true` dan `WA_SEND_URL=""`
   ditetapkan **sesudah** sebaran `.env.dev`, jadi isi `.env.dev` tak bisa
   menimpanya.

**Yang TIDAK dijaga di sana: port.** Lihat bagian berikutnya — itu satu-satunya
cara tumpukan dev bisa "berhasil" tapi sebenarnya mati.

## Peta port mesin ini — periksa sebelum `pm2 start`

Ada **tiga** tumpukan di Mac mini, bukan dua:

| Tumpukan | ai · api · web | Konfigurasi |
|---|---|---|
| prod | 8100 · 4100 · 3100 | `ecosystem.config.cjs` (repo) |
| demo | — · 4200 · 3200 | `~/DevWRG/wrg-os-demo/ecosystem.demo.config.cjs` (**di luar repo**) |
| dev | 8300 · 4300 · 3300 | `ecosystem.config.cjs` (repo) |

Dev semula memakai 8200/4200/3200 dan menabrak demo. Ketahuan 9 Sep 2026 sebelum
dinyalakan; dev digeser ke 83xx/43xx/33xx supaya demo tak perlu disentuh.

**Kenapa ini layak satu langkah tersendiri:** penjaga di ecosystem tidak
memeriksa port. Kalau ada bentrok, `pm2 start` tetap mendaftarkan prosesnya dan
melaporkan `online`, lalu proses itu gagal bind, autorestart 10×, dan berhenti di
`errored` — sementara URL yang kamu buka **tetap menampilkan tumpukan lain** yang
memegang port itu. Kelihatan berhasil, padahal tidak.

```bash
cd ~/DevWRG/wrg-os && scripts/ops/cek-port-tumpukan.sh dev
```

Keluar 0 = aman. Keluar 1 = ada bentrok **atau ada `script` yang tak ada di
jalur yang di-resolve pm2** (`cwd` + `script`), dan barisnya menyebut yang mana.
Skrip itu membaca port, `cwd`, dan `script` **dari ecosystem**, jadi ia tak bisa
menyimpang dari konfigurasi yang benar-benar dipakai pm2.

Cek `script` ditambahkan sesudah 9 Sep 2026: ketiga entri dev memakai
`cwd: DEV_ROOT` sementara artefaknya ada di `apps/api`, `apps/web`,
`services/ai`. Port bebas, penjaga `devSiap` lulus, preflight exit 0 — dan
ketiga proses tetap mati. Dua gerbang hijau di atas tumpukan yang tak pernah
hidup.

## Setup sekali jalan

```bash
# 1. Checkout terpisah di branch dev — JANGAN pakai checkout deploy (itu di main)
git clone https://github.com/DevWRG/wrg-os.git ~/DevWRG/wrg-os-dev
cd ~/DevWRG/wrg-os-dev && git checkout dev

# 2. Database dev
createdb wrg_os_dev
DATABASE_URL=postgres:///wrg_os_dev bash scripts/db/migrate.sh
psql -d wrg_os_dev -f scripts/db/seed-dev.sql
psql -d wrg_os_dev -f scripts/db/seed-dev-full.sql   # urutan WAJIB — yang kedua merujuk am_id dari yang pertama

# 3. .env.dev (gitignored, pola sama .env.prod)
cat > .env.dev <<'EOF'
DATABASE_URL=postgres:///wrg_os_dev
API_SERVICE_TOKEN=<token bebas, beda dari prod>
JWT_SECRET=<acak, beda dari prod>
AUTH_ENABLED=true
WEB_NOINDEX=1
EOF
chmod 600 .env.dev

# 4. Build
pnpm install
pnpm --filter @wrg/api build
pnpm --filter @wrg/web build
# .venv HARUS di services/ai — pm2 menjalankan wrg-dev-ai dengan
# cwd: services/ai dan script: ".venv/bin/uvicorn" (sama seperti prod).
( cd services/ai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt )

# 5. Nyalakan — dijalankan dari checkout PROD, karena ecosystem-nya di sana
cd ~/DevWRG/wrg-os
scripts/ops/cek-port-tumpukan.sh dev      # WAJIB — lihat bagian peta port di atas
pm2 start ecosystem.config.cjs --only wrg-dev-ai,wrg-dev-api,wrg-dev-web
pm2 save
```

Dashboard dev: `http://localhost:3300` (atau lewat Tailscale ke mesin ini).

Sesudah `pm2 start`, jangan berhenti di kata `online` — pm2 mencetak itu sebelum
proses sempat bind. Yang membuktikan hidup:

```bash
pm2 list | grep wrg-dev            # status harus tetap online sesudah ~15 detik
curl -s localhost:3300 -o /dev/null -w '%{http_code}\n'
```

## Menyegarkan dev setelah ada merge ke `dev`

```bash
cd ~/DevWRG/wrg-os-dev
git fetch origin dev && git checkout origin/dev -- . && git checkout dev && git pull
pnpm --filter @wrg/api build && pnpm --filter @wrg/web build
DATABASE_URL=postgres:///wrg_os_dev bash scripts/db/migrate.sh   # migrasi baru
cd ~/DevWRG/wrg-os && pm2 restart ecosystem.config.cjs --only wrg-dev-api,wrg-dev-web --update-env
```

⚠️ `auto-deploy` hanya melayani `main`. Penyegaran dev **manual** — atau
dibuatkan jalurnya sendiri nanti.

## Memeriksa penjaganya masih hidup

```bash
cd ~/DevWRG/wrg-os
node -e "const c=require('./ecosystem.config.cjs');
  const a=c.apps.find(x=>x.name==='wrg-dev-api');
  console.log(a ? 'dev terdaftar · WA_DRY_RUN='+a.env.WA_DRY_RUN : 'dev TIDAK terdaftar (lihat peringatan di atas)');"
```

Kalau mencetak `dev TIDAK terdaftar`, baris peringatannya menyebut sebabnya:
checkout tak ada, `DATABASE_URL` kosong, atau database bukan `_dev`/`_demo`.

## Menghidupkan uji WhatsApp di dev

Ketiga lapis sudah mendarat. Yang tersisa cuma mengisi **satu daftar** di
`.env.prod` — dan daftar itu dipakai dua kali dari SATU sumber: bridge memakainya
untuk memilih tujuan pesan **masuk**, dan tumpukan dev memakainya sebagai batas
tujuan pesan **keluar**.

```bash
# .env.prod (di checkout PROD)
WA_DEV_GROUPS=<jid grup Research>
WRG_WEBHOOK_URL_DEV=http://127.0.0.1:4300/webhooks/wa
WRG_WEBHOOK_SECRET_DEV=<WA_WEBHOOK_SECRET dari .env.dev>

# lalu
pm2 restart ecosystem.config.cjs --only wrg-prod-wabridge,wrg-dev-api --update-env
```

Periksa dua baris log ini:

```
[bridge]     routing dev: 1 grup → http://127.0.0.1:4300/webhooks/wa (...)
[ecosystem]  dev boleh kirim WA — DIBATASI ke: <jid grup Research>
```

Kalau `WA_DEV_GROUPS` dibiarkan kosong, dev tetap **bisu** dan ecosystem
mengatakannya — itu keadaan aman, bukan setengah jalan.

⚠️ **Jangan menyalakan `WA_DRY_RUN=false` di `.env.dev`.** Tidak akan berpengaruh
(ecosystem menimpanya), dan yang menentukan tetap ada-tidaknya `WA_DEV_GROUPS`.

## Yang BELUM tercakup

- **Penyegaran otomatis** setelah merge ke `dev` — `auto-deploy` hanya melayani
  `main`; dev masih manual.
- **Akses publik** — dashboard dev hanya lokal/Tailscale, tidak lewat Cloudflare
  Tunnel. Itu disengaja.
