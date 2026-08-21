#!/usr/bin/env node
// Bandingkan NPK metode LINIER lama (calcNPK, ≤v1.165.x) vs TABEL BERJENJANG SK
// Pasal 3.2 (calcNpkSk, ≥v1.166.0) — READ-ONLY, tidak menulis apa pun ke DB.
//
// Kenapa ada: pergeseran metode mengubah angka NPK yang dipakai HR (gate jenjang
// karir Pasal 2 & bonus tahunan Pasal 6). Angka barunya harus bisa dilihat DULU,
// per HoD per aspek, sebelum recompute menimpa baris prod.
//
// Input dikumpulkan lewat gatherAspectInput() YANG SAMA dengan compute — bukan
// query salinan — supaya yang dibandingkan benar-benar metode skornya saja.
//
// Pakai (di Mac mini, repo prod):
//   node scripts/ops/npk-compare-metode.mjs                 # semester berjalan
//   node scripts/ops/npk-compare-metode.mjs 2026 S1         # periode tertentu
//   node scripts/ops/npk-compare-metode.mjs --am            # jalur AM, bukan HoD
// Butuh DATABASE_URL (mis. `set -a; . ./.env.prod; set +a`) dan `pnpm --filter @wrg/api build`.

import { db } from "../../apps/api/dist/db.js";
import { calcNPK, DEFAULT_BOBOT } from "../../apps/api/dist/lib/npk-calc.js";
import { calcNpkSk } from "../../apps/api/dist/lib/npk-sk.js";
import { currentPeriod, gatherAspectInput, hodCabangSet } from "../../apps/api/dist/repo/npk.js";
import { HODS } from "../../apps/api/dist/hod-resolver.js";

const args = process.argv.slice(2);
const modeAm = args.includes("--am");
const pos = args.filter((a) => !a.startsWith("--"));
const cur = currentPeriod();
const year = Number(pos[0]) || cur.year;
const period = (pos[1] ?? "").toUpperCase() === "S1" ? "S1" : (pos[1] ?? "").toUpperCase() === "S2" ? "S2" : cur.period;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set. Contoh: set -a; . ./.env.prod; set +a");
  process.exit(2);
}

const sql = db();
const now = new Date();
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6) => (v == null ? "–" : (Math.round(v * 100) / 100).toFixed(2)).padStart(n);

// Kumpulkan (subjek, input, avail) untuk jalur yang diminta.
async function subjek() {
  if (!modeAm) {
    const out = [];
    for (const h of HODS) {
      const cabang = await hodCabangSet(sql, h.key);
      const g = await gatherAspectInput(sql, h.key, cabang, year, period, now);
      out.push({ nama: h.name, ...g });
    }
    return out;
  }
  // Jalur AM: import dinamis supaya script tetap jalan walau modul AM belum ter-build.
  const { listAmSubjects, gatherAmInput } = await import("../../apps/api/dist/repo/npk-am.js");
  const ams = await listAmSubjects(sql);
  const out = [];
  for (const am of ams) {
    const g = await gatherAmInput(sql, am, year, period, now);
    out.push({ nama: am.nama, ...g });
  }
  return out;
}

const rows = await subjek();

console.log(`\nNPK ${modeAm ? "AM" : "HoD"} — ${year} ${period} · metode LINIER (lama) vs TABEL SK Pasal 3.2 (baru)`);
console.log("Δ = baru − lama. Angka NPK, bukan poin per aspek.\n");
console.log(`${pad("Subjek", 22)} ${pad("Cov", 5)} ${pad("LAMA", 7)} ${pad("BARU", 7)} ${pad("Δ", 8)} predikat lama → baru`);
console.log("─".repeat(86));

let naik = 0, turun = 0, samaSaja = 0;
const perAspek = {};
for (const r of rows) {
  const lama = calcNPK(r.input, DEFAULT_BOBOT, r.avail);
  const baru = calcNpkSk(r.input, r.avail);
  const d = Math.round((baru.npk - lama.npk) * 100) / 100;
  if (d > 0) naik++; else if (d < 0) turun++; else samaSaja++;
  const tanda = d > 0 ? "+" : "";
  const ubahPredikat = lama.predikat === baru.predikat ? "" : "  ⚠ PREDIKAT BERUBAH";
  console.log(
    `${pad(r.nama.slice(0, 21), 22)} ${pad(`${baru.available_count}/7`, 5)} ${num(lama.npk, 7)} ${num(baru.npk, 7)} ${pad(`${tanda}${d.toFixed(2)}`, 8)} ${lama.predikat} → ${baru.predikat}${ubahPredikat}`,
  );
  // Rekap per aspek: hanya aspek yang benar-benar ada datanya.
  for (const a of baru.aspects) {
    if (!a.available) continue;
    const l = lama.aspects.find((x) => x.key === a.key);
    (perAspek[a.key] ??= []).push(Math.round((a.contribution - l.contribution) * 100) / 100);
  }
}

console.log("─".repeat(86));
console.log(`${rows.length} subjek: ${naik} naik · ${turun} turun · ${samaSaja} tetap\n`);

console.log("Pergeseran POIN per aspek (hanya aspek yang ada datanya):");
for (const [k, ds] of Object.entries(perAspek)) {
  const min = Math.min(...ds), max = Math.max(...ds);
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  console.log(`  ${pad(k, 10)} n=${pad(ds.length, 4)} rata-rata ${num(avg)} · min ${num(min)} · maks ${num(max)}  (bobot ${DEFAULT_BOBOT[k]})`);
}
console.log("\nTidak ada baris DB yang diubah. Untuk menerapkan: POST /npk/compute?year=…&period=…\n");
process.exit(0);
