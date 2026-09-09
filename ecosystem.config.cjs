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
// Port: prod 8100/4100/3100 · dev 8200/4200/3200. Sengaja BUKAN 8000/4000/3000
// — itu konvensi dev di laptop, dan menabraknya bikin bingung saat seseorang
// menjalankan dev lokal di mesin yang sama.
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
};

const appsDev = !devSiap ? [] : [
  {
    name: "wrg-dev-ai",
    cwd: DEV_ROOT,
    script: ".venv/bin/uvicorn",
    args: "app.main:app --host 127.0.0.1 --port 8200",
    interpreter: "none",
    env: { ...devEnv, PORT: "8200" },
    autorestart: true,
    max_restarts: 10,
  },
  {
    name: "wrg-dev-api",
    cwd: DEV_ROOT,
    script: "dist/index.js",
    interpreter: "node",
    env: { ...devEnv, PORT: "4200", AI_BASE_URL: "http://127.0.0.1:8200" },
    autorestart: true,
    max_restarts: 10,
  },
  {
    name: "wrg-dev-web",
    cwd: DEV_ROOT,
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3200",
    interpreter: "node",
    env: { ...devEnv, PORT: "3200", API_BASE_URL: "http://127.0.0.1:4200" },
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
