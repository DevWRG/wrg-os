#!/usr/bin/env node
// Smoke test permukaan BACA apps/api terhadap DB nyata.
//
// Memukul SETIAP route GET tanpa parameter di apps/api/src/index.ts, plus tiap
// route `:id` (id-nya diambil dari route list padanannya). Yang dicari: handler
// yang MELEDAK karena SQL-nya menyebut kolom/tabel yang tak ada, join salah,
// atau enum tak cocok — kelas kegagalan yang cuma muncul kalau query-nya
// benar-benar dieksekusi ke skema nyata, dan yang lolos dari lint/typecheck/CI.
//
// Dibuat saat mempersiapkan promosi 43 fitur batch magang (33 menu baru) yang
// belum pernah dijalankan sekali pun. Daftar route diekstrak dari SOURCE, bukan
// dihardcode, supaya tak basi begitu ada fitur baru.
//
// Pakai:
//   node scripts/qa/smoke-api-read.mjs
//   DATABASE_URL=postgres:///wrg_os_dev node scripts/qa/smoke-api-read.mjs
//   SMOKE_PORT=4199 node scripts/qa/smoke-api-read.mjs
//
// Prasyarat: pnpm --filter @wrg/api build (skrip menjalankan dist/index.js).
// Exit 1 kalau ada 5xx, gagal koneksi, atau non-2xx yang TIDAK terdaftar di
// HARAPAN_NON_2XX di bawah.
//
// AMAN untuk DB berisi data: hanya GET, tak ada tulis. Scheduler dimatikan
// (AGENT_SCHEDULE_ENABLED=false) dan WA dry-run, jadi tak ada cron/kirim WA
// yang ikut jalan.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.env.SMOKE_PORT || 4199);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "smoke-token-lokal";

// Route yang non-2xx-nya BENAR — bukan cacat. Nilainya status yang diharapkan.
// Sengaja eksplisit per-route (bukan "abaikan semua 4xx"): begitu ada route
// BARU yang balas 4xx, ia tak ada di daftar ini → langsung jadi temuan.
const HARAPAN_NON_2XX = {
  // Butuh query param wajib — 400-nya itu validasi yang bekerja.
  "/klasifikasi/next-kode": 400,
  "/kso/produktivitas/export.xlsx": 400,
  "/leave/check": 400,
  "/media": 400,
  "/monitor/stats": 400,
  "/report/drilldown": 400,
  // Butuh identitas user (header x-user-id / JWT), bukan service-token.
  "/auth/me": 401,
  "/sales-analytics/alerts": 401,
  "/sales-analytics/views": 401,
  // Scope menolak service-token tanpa identitas — gate bekerja.
  "/insentif/list": 403,
  "/insentif/self": 403,
  // Status bisnis, bukan error: melaporkan mirror Accurate basi. Di DB dev yang
  // tak pernah di-sync ini SELALU 503, dan itu jawaban yang benar.
  "/health/mirror": 503,
};

// Sama, tapi untuk route `:id` — dikunci pada TEMPLATE-nya (bukan jalur yang
// sudah terisi id), supaya tak bergantung pada id apa yang kebetulan terambil.
const HARAPAN_NON_2XX_DETAIL = {
  // Item SO/SJ TIDAK di-mirror — ditarik on-demand dari API Accurate, jadi di
  // dev (tanpa kredensial) 503 itu jawaban yang benar. Di prod ini 2xx.
  "/accurate/sales-orders/:id/items": 503,
  "/accurate/shipments/:id/items": 503,
  // Butuh query param wajib — validasi yang bekerja.
  "/employee-spine/employees/:id/measurements": 400,
};

// ── daftar route dari SOURCE ───────────────────────────────────────────────
const src = readFileSync(join(ROOT, "apps/api/src/index.ts"), "utf8");
const semua = [...new Set([...src.matchAll(/app\.get\("([^"]+)"/g)].map((m) => m[1]))].sort();
const tanpaParam = semua.filter((p) => !p.includes(":"));
const denganParam = semua.filter((p) => p.includes(":"));

// ── boot API ──────────────────────────────────────────────────────────────
const api = spawn(process.execPath, [join(ROOT, "apps/api/dist/index.js")], {
  cwd: ROOT,
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres:///wrg_os_dev",
    PORT: String(PORT),
    API_SERVICE_TOKEN: TOKEN,
    WA_DRY_RUN: "true",
    WA_INBOUND_PROCESS: "false",
    AGENT_SCHEDULE_ENABLED: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", (d) => (apiLog += d));
api.stderr.on("data", (d) => (apiLog += d));
const matikan = () => {
  try {
    api.kill();
  } catch {
    /* sudah mati */
  }
};
process.on("exit", matikan);

// Body dikembalikan UTUH; pemotongan hanya saat dicetak. Sempat dipotong di
// sini dan itu membuat pengambil id di bawah tak pernah bisa JSON.parse — tiap
// endpoint detail lalu dilaporkan "tabelnya kosong" padahal datanya ada, dan
// laporannya tetap exit 0. Kegagalan sunyi yang persis jenis yang dicari alat ini.
const get = async (p) => {
  try {
    const r = await fetch(BASE + p, { headers: { "x-service-token": TOKEN }, signal: AbortSignal.timeout(60000) });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: e.message };
  }
};
const potong = (s) => String(s).slice(0, 240);

let hidup = false;
for (let i = 0; i < 60; i += 1) {
  const r = await get("/health");
  if (r.status === 200) {
    hidup = true;
    break;
  }
  await new Promise((s) => setTimeout(s, 500));
}
if (!hidup) {
  console.error(`API gagal start di ${BASE}. Log:\n${apiLog.slice(-2000)}`);
  console.error("Sudah jalan `pnpm --filter @wrg/api build`?");
  matikan();
  process.exit(1);
}

// ── uji ───────────────────────────────────────────────────────────────────
const gagal = [];
let ok = 0;
let sesuaiHarapan = 0;

for (const p of tanpaParam) {
  const { status, body } = await get(p);
  const harap = HARAPAN_NON_2XX[p];
  if (status >= 200 && status < 300) {
    ok += 1;
  } else if (harap && status === harap) {
    sesuaiHarapan += 1;
  } else {
    gagal.push({ p, status, body: potong(body), harap });
    console.log(`✗ ${status}${harap ? ` (harap ${harap})` : ""} ${p}\n    ${potong(body)}`);
  }
}

// Endpoint detail: ambil id dari route list padanannya (prefix terpanjang yang
// ada di tanpaParam), lalu pukul. Tanpa data, detail-nya TAK diuji — itu
// dilaporkan, bukan dianggap lulus.
const idCache = new Map();
const ambilId = async (list) => {
  if (idCache.has(list)) return idCache.get(list);
  const { status, body } = await get(list);
  let id = null;
  if (status >= 200 && status < 300) {
    try {
      const d = JSON.parse(body);
      const rows = Array.isArray(d) ? d : Object.values(d).find((v) => Array.isArray(v)) ?? [];
      id = rows[0]?.id ?? null;
    } catch {
      /* bukan JSON → lewat */
    }
  }
  idCache.set(list, id);
  return id;
};

let detailOk = 0;
const detailTakTeruji = [];
for (const p of denganParam) {
  // /a/b/:id/c → cari route list terpanjang yang jadi prefix-nya
  const seg = p.split("/:")[0];
  const list = tanpaParam.filter((l) => seg === l).sort((a, b) => b.length - a.length)[0];
  if (!list) {
    detailTakTeruji.push(`${p} (tak ada route list padanan)`);
    continue;
  }
  const id = await ambilId(list);
  if (!id) {
    detailTakTeruji.push(`${p} (${list} kosong)`);
    continue;
  }
  const jalur = p.replace(/:[a-zA-Z]+/, id);
  if (jalur.includes(":")) {
    detailTakTeruji.push(`${p} (butuh >1 id)`);
    continue;
  }
  const { status, body } = await get(jalur);
  const harapDetail = HARAPAN_NON_2XX_DETAIL[p];
  if (status >= 200 && status < 300) detailOk += 1;
  else if (harapDetail && status === harapDetail) sesuaiHarapan += 1;
  else {
    gagal.push({ p: jalur, status, body: potong(body) });
    console.log(`✗ ${status}${harapDetail ? ` (harap ${harapDetail})` : ""} ${jalur}\n    ${potong(body)}`);
  }
}

matikan();

// ── laporan ───────────────────────────────────────────────────────────────
console.log("\n=========== SMOKE PERMUKAAN BACA apps/api ===========");
console.log(`DB: ${process.env.DATABASE_URL ?? "postgres:///wrg_os_dev"}`);
console.log(`route tanpa param : ${tanpaParam.length}  → 2xx=${ok}  non-2xx-sesuai-harapan=${sesuaiHarapan}`);
console.log(`route :id         : ${denganParam.length}  → 2xx=${detailOk}  tak-teruji=${detailTakTeruji.length}`);
console.log(`GAGAL             : ${gagal.length}`);

// Cakupan yang tak teruji harus kelihatan. Laporan "semua hijau" yang menyembunyikan
// puluhan endpoint tak tersentuh lebih berbahaya daripada laporan merah.
if (detailTakTeruji.length) {
  console.log(`\n── ${detailTakTeruji.length} endpoint detail TAK teruji (tabelnya kosong) ──`);
  for (const d of detailTakTeruji) console.log(`  · ${d}`);
  console.log("\nTabel kosong = kondisi wajar hari-1 untuk fitur baru, tapi ini");
  console.log("berarti join di endpoint detail itu belum pernah dieksekusi.");
}

process.exit(gagal.length === 0 ? 0 : 1);
