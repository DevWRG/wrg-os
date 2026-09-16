// pm2 ecosystem — WRG-OS DEMO (data sintetis, terpisah total dari prod).
// Membaca .env.demo (gitignored) → tak ada secret di file ini.
// Port demo: api 4200 · web 3200 (prod: 4100/3100 · dev: 4000/3000).
//
// NAMA FILE penting: pm2 hanya memperlakukan berkas sebagai config kalau namanya
// berpola *.config.{js,cjs}. Dinamai 'ecosystem.demo.cjs' → pm2 menjalankannya
// sebagai SKRIP biasa (satu proses bernama 'ecosystem.demo', app-nya tak pernah
// naik).
//
// DEMO TIDAK punya proses AI & WA — by design: tak boleh ada panggilan keluar
// (OpenRouter/WhatsApp/Accurate) dari environment yang kredensialnya dibagikan.
//
//   pm2 start ecosystem.demo.config.cjs
//   pm2 restart ecosystem.demo.config.cjs --update-env
//   pm2 logs wrg-demo-api

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
    /* .env.demo belum ada → app pakai default (stub) */
  }
  return env;
}

const ROOT = __dirname;
const base = loadEnv(path.join(ROOT, ".env.demo"));

module.exports = {
  apps: [
    {
      name: "wrg-demo-api",
      cwd: path.join(ROOT, "apps/api"),
      script: "dist/index.js",
      env: { ...base, PORT: "4200" },
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: "wrg-demo-web",
      cwd: path.join(ROOT, "apps/web"),
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3200 -H 127.0.0.1",
      interpreter: "node",
      env: { ...base, PORT: "3200" },
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
