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
  ],
};
