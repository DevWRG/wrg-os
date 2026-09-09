#!/usr/bin/env node
// Tes penjaga tumpukan dev di ecosystem.config.cjs.
//   node scripts/qa/uji-ecosystem-dev.mjs     (exit 0 = lulus)
//
// Penjaganya ADALAH isi fitur ini, jadi harus terbukti — bukan cuma tertulis di
// komentar. Tiga hal yang dijaga:
//   1. Dev tak menyala menunjuk database prod.
//   2. .env.dev tak bisa menimpa keputusan kirim WA.
//   3. Izin kirim tak menyala saat WA_DEV_GROUPS kosong — kalau lolos, allowlist
//      jadi kosong dan kosong berarti TANPA BATAS di wasend.ts, yang membalikkan
//      makna lapis 3 sepenuhnya.
//
// Cara memuat: ecosystem.config.cjs membaca .env.prod dari direktori file itu
// sendiri, jadi tes menulis .env.prod SEMENTARA di root worktree, memuat config
// dengan cache require dibersihkan, lalu memulihkannya.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, unlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const CONFIG = join(ROOT, "ecosystem.config.cjs");
const ENV_PROD = join(ROOT, ".env.prod");

const RESEARCH = "120363000000000001@g.us";

function muat({ envProd = "", envDev = null }) {
  // .env.prod asli (kalau ada) diselamatkan dulu.
  const adaAsli = existsSync(ENV_PROD);
  const asli = adaAsli ? readFileSync(ENV_PROD, "utf8") : null;
  const devRoot = mkdtempSync(join(tmpdir(), "devroot-"));
  try {
    writeFileSync(ENV_PROD, envProd);
    if (envDev !== null) {
      mkdirSync(devRoot, { recursive: true });
      writeFileSync(join(devRoot, ".env.dev"), envDev);
    }
    process.env.WRG_DEV_ROOT = envDev === null ? join(devRoot, "tak-ada") : devRoot;
    delete require.cache[require.resolve(CONFIG)];
    const warnAsli = console.warn;
    const pesan = [];
    console.warn = (...a) => pesan.push(a.map(String).join(" "));
    try {
      const cfg = require(CONFIG);
      const api = cfg.apps.find((a) => a.name === "wrg-dev-api");
      return {
        api,
        pesan,
        apps: cfg.apps,
        prodAda: cfg.apps.filter((a) => a.name.startsWith("wrg-prod-")).length,
      };
    } finally {
      console.warn = warnAsli;
    }
  } finally {
    if (adaAsli) writeFileSync(ENV_PROD, asli);
    else unlinkSync(ENV_PROD);
    rmSync(devRoot, { recursive: true, force: true });
    delete process.env.WRG_DEV_ROOT;
    delete require.cache[require.resolve(CONFIG)];
  }
}

const DEV_OK = "DATABASE_URL=postgres:///wrg_os_dev\n";

test("WA_DEV_GROUPS kosong → dev BISU, dan itu diberitahukan", () => {
  const { api, pesan } = muat({ envProd: "", envDev: DEV_OK });
  assert.ok(api, "entri dev harus terdaftar");
  assert.equal(api.env.WA_DRY_RUN, "true");
  assert.equal(api.env.WA_SEND_URL, "");
  assert.match(pesan.join("\n"), /BISU/);
});

test("WA_DEV_GROUPS terisi → boleh kirim, DIBATASI ke daftar itu", () => {
  const { api, pesan } = muat({ envProd: `WA_DEV_GROUPS=${RESEARCH}\n`, envDev: DEV_OK });
  assert.equal(api.env.WA_DRY_RUN, "false");
  assert.equal(api.env.WA_SEND_ALLOWED_TARGETS, RESEARCH);
  assert.notEqual(api.env.WA_SEND_URL, "");
  assert.match(pesan.join("\n"), /DIBATASI/);
});

test("mode live TAK PERNAH menyala bersama allowlist kosong", () => {
  // Inti PR ini. Kosong = tanpa batas di wasend.ts, jadi kombinasi
  // WA_DRY_RUN=false + allowlist kosong akan membalikkan makna lapis 3.
  for (const envProd of ["", "WA_DEV_GROUPS=\n", "WA_DEV_GROUPS=   \n"]) {
    const { api } = muat({ envProd, envDev: DEV_OK });
    const live = api.env.WA_DRY_RUN === "false";
    const daftarKosong = !api.env.WA_SEND_ALLOWED_TARGETS;
    assert.ok(!(live && daftarKosong), `kombinasi terlarang untuk envProd=${JSON.stringify(envProd)}`);
  }
});

test(".env.dev tak bisa menimpa keputusan kirim", () => {
  const nekat = `${DEV_OK}WA_DRY_RUN=false\nWA_SEND_URL=http://jangan\nWA_SEND_ALLOWED_TARGETS=\n`;
  const { api } = muat({ envProd: "", envDev: nekat });
  assert.equal(api.env.WA_DRY_RUN, "true", ".env.dev berhasil menimpa — penjaga bocor");
  assert.equal(api.env.WA_SEND_URL, "");
});

test("DATABASE_URL prod → entri dev DIHILANGKAN, prod tetap utuh", () => {
  const { api, prodAda } = muat({ envProd: `WA_DEV_GROUPS=${RESEARCH}\n`, envDev: "DATABASE_URL=postgres:///wrg_os_prod\n" });
  assert.equal(api, undefined, "dev tak boleh terdaftar menunjuk prod");
  assert.ok(prodAda >= 4, `entri prod harus tetap ada, dapat ${prodAda}`);
});

// Port tumpukan demo (~/DevWRG/wrg-os-demo, DI LUAR repo ini). Dev semula
// memakai 4200/3200 dan menabraknya — pm2 tetap melapor "online" lalu prosesnya
// mati diam-diam sementara URL-nya menyajikan demo. Angka ini ditulis di sini
// supaya bentrok yang sama tertangkap CI, bukan di server.
const PORT_DEMO = ["4200", "3200"];

test("port dev tidak menabrak prod maupun demo", () => {
  const { apps } = muat({ envProd: "", envDev: DEV_OK });
  const portDari = (a) => a.env?.PORT || (a.args || "").match(/(?:-p|--port)\s+(\d+)/)?.[1];

  const dev = apps.filter((a) => a.name.startsWith("wrg-dev-"));
  assert.equal(dev.length, 3, "ketiga entri dev harus ada");

  const prod = apps.filter((a) => a.name.startsWith("wrg-prod-")).map(portDari).filter(Boolean);
  const terlarang = new Set([...prod, ...PORT_DEMO]);

  for (const a of dev) {
    const p = portDari(a);
    assert.ok(p, `${a.name} tak punya port yang bisa dibaca`);
    assert.ok(!terlarang.has(p), `${a.name} memakai port ${p} — sudah dipegang tumpukan lain`);
  }

  // Dan tidak saling menabrak sesama dev.
  const pDev = dev.map(portDari);
  assert.equal(new Set(pDev).size, pDev.length, `port dev kembar: ${pDev.join(",")}`);
});

test("args dan env.PORT satu angka — web bind ke -p, bukan ke PORT", () => {
  // next start memakai `-p`; kalau env.PORT beda, yang menang adalah args dan
  // API_BASE_URL/log bisa menunjuk port yang salah tanpa ada yang gagal.
  const { apps } = muat({ envProd: "", envDev: DEV_OK });
  for (const a of apps) {
    const dariArgs = (a.args || "").match(/(?:-p|--port)\s+(\d+)/)?.[1];
    if (dariArgs && a.env?.PORT) {
      assert.equal(a.env.PORT, dariArgs, `${a.name}: env.PORT=${a.env.PORT} tapi args pakai ${dariArgs}`);
    }
  }
});

test("scheduler dev tetap mati walau izin kirim menyala", () => {
  // Kalau scheduler hidup di dev DAN dev boleh kirim, cron dev bisa
  // mem-broadcast ke grup Research tanpa ada yang memicunya.
  const { api } = muat({ envProd: `WA_DEV_GROUPS=${RESEARCH}\n`, envDev: DEV_OK });
  assert.equal(api.env.AGENT_SCHEDULE_ENABLED, "false");
  assert.equal(api.env.REMINDER_SCHEDULE_ENABLED, "false");
});

// ── cwd & nama env ──────────────────────────────────────────────────────────
// Dua bug yang lolos semua gerbang dan baru ketahuan di Mac mini 9 Sep 2026.
// Keduanya diuji dari BENTUK config, bukan dari server, supaya CI yang menangkap.

test("cwd dev per-app, bentuknya sama dengan prod", () => {
  // pm2 me-resolve `script` relatif ke `cwd`. Dengan cwd: DEV_ROOT, ketiga
  // artefak (apps/api/dist, apps/web/node_modules, services/ai/app) tak
  // ditemukan — dan gagalnya SENYAP: preflight port tetap 0, penjaga devSiap
  // tetap "terdaftar", prosesnya autorestart 10× lalu `errored`.
  const { apps } = muat({ envProd: "", envDev: DEV_OK });
  const sufiks = (a) => {
    const i = a.cwd.indexOf("/apps/") >= 0 ? a.cwd.indexOf("/apps/") : a.cwd.indexOf("/services/");
    return i >= 0 ? a.cwd.slice(i + 1) : null;
  };
  for (const bagian of ["ai", "api", "web"]) {
    const dev = apps.find((a) => a.name === `wrg-dev-${bagian}`);
    const prod = apps.find((a) => a.name === `wrg-prod-${bagian}`);
    assert.ok(dev && prod, `entri ${bagian} harus ada di dev dan prod`);
    assert.equal(
      sufiks(dev),
      sufiks(prod),
      `wrg-dev-${bagian}.cwd tak sebentuk dengan prod — script "${dev.script}" takkan ditemukan`,
    );
    assert.ok(sufiks(dev), `wrg-dev-${bagian}.cwd masih menunjuk root checkout, bukan subdirektori app`);
  }
});

test("nama env dev = nama yang DIBACA kode, bukan *_BASE_URL", () => {
  // apps/api/src/ai.ts       → process.env.AI_URL  ?? http://localhost:8000
  // apps/web/src/lib/gateway → process.env.API_URL ?? http://localhost:4000
  // Nama yang salah tak memicu error apa pun: prosesnya naik lalu menembak
  // port kosong. Dev api pernah menembak :8000 dan dev web :4000 karena ini.
  const { apps } = muat({ envProd: "", envDev: DEV_OK });
  const api = apps.find((a) => a.name === "wrg-dev-api");
  const web = apps.find((a) => a.name === "wrg-dev-web");
  const portDari = (a) => a.env?.PORT || (a.args || "").match(/(?:-p|--port)\s+(\d+)/)?.[1];

  assert.match(api.env.AI_URL ?? "", /:\d+$/, "wrg-dev-api butuh AI_URL (bukan AI_BASE_URL)");
  assert.equal(api.env.AI_BASE_URL, undefined, "AI_BASE_URL tak dibaca kode mana pun — hapus");
  assert.match(web.env.API_URL ?? "", /:\d+$/, "wrg-dev-web butuh API_URL (bukan API_BASE_URL)");
  assert.equal(web.env.API_BASE_URL, undefined, "API_BASE_URL tak dibaca kode mana pun — hapus");

  // Dan URL-nya harus menunjuk port tumpukan DEV, bukan prod/demo/default.
  assert.ok(api.env.AI_URL.endsWith(`:${portDari(apps.find((a) => a.name === "wrg-dev-ai"))}`),
    `AI_URL=${api.env.AI_URL} tak menunjuk port wrg-dev-ai`);
  assert.ok(web.env.API_URL.endsWith(`:${portDari(api)}`),
    `API_URL=${web.env.API_URL} tak menunjuk port wrg-dev-api`);
});
