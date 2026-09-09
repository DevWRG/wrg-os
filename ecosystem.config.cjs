// pm2 ecosystem — WRG-OS produksi NATIVE (Phase 1, co-locate Mac, tanpa Docker).
// Membaca .env.prod (gitignored) saat runtime → tak ada secret di file ini.
// Port prod terpisah dari dev (3000/4000/8000) & legacy (8090-8092):
//   ai 8100 · api 4100 · web 3100.
//
//   pm2 start ecosystem.prod.cjs
//   pm2 save && pm2 startup   # auto-boot
//   pm2 logs / pm2 status / pm2 stop ecosystem.prod.cjs

const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const env = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    /* .env.prod belum ada → app pakai default (mode dev/stub) */
  }
  return env;
}

const ROOT = __dirname;
const base = loadEnv(path.join(ROOT, ".env.prod"));

// ── Tumpukan DEV di server ────────────────────────────────────────────────
// Supaya pengujian (dashboard web, dan nanti WA) berjalan di kode `dev` dan
// database `dev` — bukan menumpang prod. Checkout terpisah, port terpisah,
// .env terpisah.
//
// PETA PORT DI MESIN INI — periksa peta ini sebelum menambah tumpukan baru:
//
//   prod  8100 · 4100 · 3100   ecosystem.config.cjs (file ini)
//   demo  ---- · 4200 · 3200   ~/DevWRG/wrg-os-demo/ecosystem.demo.config.cjs
//   dev   8300 · 4300 · 3300   file ini
//
// Dev SEMULA memakai 8200/4200/3200 dan itu menabrak tumpukan demo yang sudah
// jalan — ketahuan 9 Sep 2026 sebelum dinyalakan. Sengaja juga BUKAN
// 8000/4000/3000: itu konvensi dev di laptop, menabraknya bikin bingung saat
// seseorang menjalankan dev lokal di mesin yang sama.
//
// ⚠️ Penjaga di bawah TIDAK memeriksa port, dan itu disengaja. Pemeriksaan port
// di sini akan melihat port yang dipegang oleh proses dev ITU SENDIRI saat
// `pm2 restart`, lalu menghapus entri dev — restart biasa berubah jadi mati
// total. Ketersediaan port diperiksa SEBELUM start, oleh
// `scripts/ops/cek-port-tumpukan.sh`. Jangan pindahkan cek itu ke sini.
//
// DUA SIFAT KEAMANAN, keduanya ditegakkan di file ini, bukan diserahkan ke
// disiplin pengisian .env:
//
//   1. Tumpukan dev TIDAK AKAN MENYALA menunjuk database prod. Kalau
//      .env.dev tak ada, atau DATABASE_URL-nya tidak berakhiran _dev/_demo,
//      entri dev DIHILANGKAN sepenuhnya dari ecosystem. Lebih baik tak ada
//      tumpukan dev daripada tumpukan dev yang menulis ke prod.
//
//   2. Dev hanya boleh mengirim WhatsApp ke GRUP YANG DI-ROUTE KE DEV, dan
//      hanya kalau daftar itu tidak kosong. Ditegakkan dua kali: allowlist di
//      wasend.ts (#1260) DAN penjaga di bawah yang menolak menyalakan izin
//      kirim saat daftarnya kosong. Nilainya ditulis SESUDAH sebaran .env.dev
//      supaya isi .env.dev tak bisa menimpanya.
//
// Jalankan: pm2 start ecosystem.config.cjs --only wrg-dev-api,wrg-dev-web,wrg-dev-ai
const DEV_ROOT = process.env.WRG_DEV_ROOT || path.join(path.dirname(ROOT), "wrg-os-dev");
const devBase = loadEnv(path.join(DEV_ROOT, ".env.dev"));

// Penjaga: hanya database yang jelas-jelas dev/demo yang diterima.
const devDbAman = /_(dev|demo)(\?|$)/.test(devBase.DATABASE_URL || "");
const devSiap = fs.existsSync(DEV_ROOT) && Boolean(devBase.DATABASE_URL) && devDbAman;

if (!devSiap) {
  const sebab = !fs.existsSync(DEV_ROOT)
    ? `checkout dev tak ada di ${DEV_ROOT}`
    : !devBase.DATABASE_URL
      ? `DATABASE_URL kosong di ${DEV_ROOT}/.env.dev`
      : `DATABASE_URL bukan database _dev/_demo — DITOLAK demi keamanan`;
  console.warn(`[ecosystem] tumpukan dev TIDAK didaftarkan: ${sebab}`);
}

// ── Izin kirim WA untuk dev ───────────────────────────────────────────────
// SATU SUMBER: WA_DEV_GROUPS dibaca dari .env.prod (`base`), BUKAN .env.dev.
// Daftar itu juga dipakai bridge untuk memilih tujuan pesan MASUK (lapis 2,
// #1259). Kalau masing-masing baca file berbeda, keduanya bisa menyimpang — dan
// menyimpang di sini berarti dev boleh MENGIRIM ke grup yang tidak di-route ke
// dev, yaitu grup produksi.
const devGroups = (base.WA_DEV_GROUPS || "").trim();

// ⚠️ PENJAGA: izin kirim hanya dinyalakan kalau ada grup dev terdaftar.
// Tanpa ini, WA_SEND_ALLOWED_TARGETS jadi string kosong — dan kosong berarti
// TANPA BATAS di wasend.ts (sengaja begitu, supaya fitur allowlist tak bisa
// membuat prod bisu). Menyalakan WA_DRY_RUN=false dengan allowlist kosong akan
// membalikkan makna lapis 3 sepenuhnya: dev bisa mengirim ke grup mana pun.
const devBolehKirim = devGroups !== "";

if (devSiap) {
  console.warn(
    devBolehKirim
      ? `[ecosystem] dev boleh kirim WA — DIBATASI ke: ${devGroups}`
      : "[ecosystem] dev BISU (WA_DEV_GROUPS kosong di .env.prod) — isi daftar itu dulu kalau balasan uji perlu muncul di WhatsApp",
  );
}

const devEnv = {
  ...devBase,
  NODE_ENV: "production",
  // ⚠️ SESUDAH sebaran — .env.dev tak boleh bisa menimpa keputusan ini.
  WA_DRY_RUN: devBolehKirim ? "false" : "true",
  WA_SEND_URL: devBolehKirim ? devBase.WA_SEND_URL || "http://127.0.0.1:18080/send" : "",
  // Allowlist tujuan (lapis 3, #1260). Kosong = tanpa batas, karena itu
  // devBolehKirim di atas memastikan mode live tak pernah menyala bersama
  // daftar kosong.
  WA_SEND_ALLOWED_TARGETS: devGroups,
  // Scheduler mati di dev: cron yang jalan dua kali (prod + dev) atas data
  // berbeda cuma bikin bingung, dan sebagian job menulis ke tabel digest.
  AGENT_SCHEDULE_ENABLED: "false",
  REMINDER_SCHEDULE_ENABLED: "false",
  // Cookie sesi TIDAK ber-flag Secure di dev. NODE_ENV=production di atas wajib
  // (next start menjalankan build produksi), tapi dashboard dev dilayani lewat
  // http://<tailscale-ip>:3300 tanpa TLS — dan browser MEMBUANG cookie Secure di
  // koneksi http biasa. Tanpa ini, login berhasil di server lalu pengguna
  // dikembalikan ke /login tanpa pesan apa pun.
  // Opt-out ini dijaga di apps/web/src/lib/cookie-secure.ts: hanya dihormati
  // kalau DATABASE_URL benar-benar database _dev/_demo, jadi menyalinnya ke
  // .env.prod tidak melemahkan produksi.
  COOKIE_SECURE: "false",
};

// ⚠️ `cwd` HARUS per-app, sama bentuknya dengan blok prod di bawah — bukan
// DEV_ROOT. pm2 me-resolve `script` relatif terhadap `cwd`, dan artefaknya ada di
// subdirektori: apps/api/dist/index.js, apps/web/node_modules/next/…,
// services/ai/app/main.py. Dengan cwd: DEV_ROOT ketiganya tak ditemukan.
//
// Kegagalannya SENYAP di kedua gerbang yang kita punya: cek-port-tumpukan.sh
// tetap exit 0 (port memang bebas) dan penjaga devSiap tetap bilang "dev
// terdaftar" (checkout & DATABASE_URL memang benar) — sementara ketiga proses
// gagal, autorestart 10×, lalu berhenti di `errored`. Terbukti di Mac mini
// 9 Sep 2026; ketiga app jalan begitu cwd-nya dibetulkan.
//
// `.venv` ikut pindah ke services/ai/.venv (mengikuti prod) supaya
// `script: ".venv/bin/uvicorn"` tetap resolve dari cwd yang baru.
const appsDev = !devSiap ? [] : [
  {
    name: "wrg-dev-ai",
    cwd: path.join(DEV_ROOT, "services/ai"),
    script: ".venv/bin/uvicorn",
    args: "app.main:app --host 127.0.0.1 --port 8300",
    interpreter: "none",
    env: { ...devEnv, PORT: "8300" },
    autorestart: true,
    max_restarts: 10,
  },
  {
    name: "wrg-dev-api",
    cwd: path.join(DEV_ROOT, "apps/api"),
    script: "dist/index.js",
    interpreter: "node",
    // AI_URL, bukan AI_BASE_URL — apps/api/src/ai.ts membaca
    // `process.env.AI_URL ?? "http://localhost:8000"`. Nama yang salah bukan
    // sekadar tak berguna: dev api diam-diam menembak :8000.
    env: { ...devEnv, PORT: "4300", AI_URL: "http://127.0.0.1:8300" },
    autorestart: true,
    max_restarts: 10,
  },
  {
    name: "wrg-dev-web",
    cwd: path.join(DEV_ROOT, "apps/web"),
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3300",
    interpreter: "node",
    // API_URL, bukan API_BASE_URL — apps/web/src/lib/gateway.ts membaca
    // `process.env.API_URL ?? "http://localhost:4000"`. Dengan nama yang salah,
    // dashboard dev naik lalu gagal fetch tanpa sebab yang kelihatan.
    env: { ...devEnv, PORT: "3300", API_URL: "http://127.0.0.1:4300" },
    autorestart: true,
    max_restarts: 10,
  },
];

module.exports = {
  apps: [
    {
      name: "wrg-prod-ai",
      cwd: path.join(ROOT, "services/ai"),
      script: ".venv/bin/uvicorn",
      args: "app.main:app --host 127.0.0.1 --port 8100",
      interpreter: "none",
      env: { ...base, PORT: "8100" },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "wrg-prod-api",
      cwd: path.join(ROOT, "apps/api"),
      script: "dist/index.js",
      env: { ...base, PORT: "4100" },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "wrg-prod-web",
      cwd: path.join(ROOT, "apps/web"),
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3100 -H 127.0.0.1",
      interpreter: "node",
      env: { ...base, PORT: "3100" },
      autorestart: true,
      max_restarts: 10,
    },
    {
      // WA host-adapter (openclaw): /send (outbound) + tail capture → /webhooks/wa
      // (inbound). Sebelumnya dilaunch manual di luar ecosystem → restart via
      // ecosystem no-op & fix bridge sempat tak ke-deploy (insiden 16 Jun). Secret
      // diturunkan dari sisi api: bridge /send terima x-wa-secret=WA_SEND_SECRET;
      // bridge→webhook pakai WA_WEBHOOK_SECRET yg dicek api.
      name: "wrg-prod-wabridge",
      cwd: ROOT,
      script: "infra/wa-bridge/bridge.mjs",
      interpreter: "node",
      env: {
        ...base,
        WA_BRIDGE_PORT: "18080",
        WA_BRIDGE_SECRET: base.WA_SEND_SECRET,
        WRG_WEBHOOK_URL: "http://127.0.0.1:4100/webhooks/wa",
        WRG_WEBHOOK_SECRET: base.WA_WEBHOOK_SECRET,
        WA_BRIDGE_SEND_LIVE: "true",
      },
      autorestart: true,
      max_restarts: 10,
    },
    {
      // Cloudflare Tunnel: expose dashboard ke os.wahanalifeline.co.id (publik
      // HTTPS, tanpa Tailscale). Config + creds di ~/.cloudflared/ (gitignored,
      // di luar repo). Akses di-gate oleh login app (Cloudflare Access opsional,
      // belum dipasang). Didaftar di ecosystem biar restart/auto-boot konsisten.
      name: "wrg-prod-cftunnel",
      cwd: ROOT,
      script: "/opt/homebrew/bin/cloudflared",
      args: "tunnel --config /Users/development/.cloudflared/config.yml run",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
    },
    ...appsDev,
  ],
};
