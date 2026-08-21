#!/usr/bin/env node
// Pagar regresi Simulator KSO: bandingkan rumus di apps/web/src/lib/kso terhadap
// angka acuan hasil implementasi ASLI di `github.com/info-WL707/runningcost-zybio`
// (aplikasi yang digabung jadi menu /kso-simulator).
//
// KENAPA ADA: rumus di sini menghitung harga penawaran KSO yang dikirim ke faskes.
// Salah satu angkanya meleset = penawaran salah, dan layarnya tetap tampil wajar —
// tidak ada yang gagal, tidak ada yang merah. Pernah kejadian: mode Check-XR
// EXZ8000 memakai harga control XN (setengah harga sebenarnya) dan baru ketahuan
// setelah dipakai (PR #803). Pagar ini menangkap yang seperti itu.
//
// Angka acuannya di `kso-parity-golden.json`. Harga di fixture itu SINTETIS, bukan
// harga master — repo ini publik. Yang nyata cuma kode reagen, volume kemasan, dan
// hasil rumusnya.
//
// Pakai:
//   node scripts/ops/kso-parity.mjs            # bandingkan (exit 1 kalau meleset)
//
// Membangkitkan ULANG fixture (hanya kalau perilaku rujukan memang berubah):
//   1. git clone --depth 1 https://github.com/info-WL707/runningcost-zybio
//   2. cp runningcost-zybio/lib/data.js runningcost-zybio/lib/data.mjs
//   3. jalankan pembangkit yang menghitung `harap` dari calc()/det() rujukan,
//      lalu timpa kso-parity-golden.json.
//   Jangan pernah menyetel ulang fixture supaya "lulus" — kalau meleset, yang
//   salah rumusnya, bukan acuannya.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(DIR, '..', '..');
const SRC = join(REPO, 'apps', 'web', 'src', 'lib', 'kso');
const TSC = join(REPO, 'apps', 'web', 'node_modules', '.bin', 'tsc');

// formula.ts & model.ts ditulis untuk bundler Next (impor relatif tanpa ekstensi),
// jadi tidak bisa langsung di-import Node. Kompilasi dulu ke folder sementara.
function kompilasi() {
  const out = mkdtempSync(join(tmpdir(), 'kso-parity-'));
  execFileSync(TSC, [
    join(SRC, 'formula.ts'), join(SRC, 'model.ts'),
    '--outDir', out, '--module', 'esnext', '--target', 'es2022',
    '--moduleResolution', 'bundler', '--skipLibCheck',
  ], { stdio: 'pipe' });
  const model = join(out, 'model.js');
  writeFileSync(model, readFileSync(model, 'utf8').replace(/from "\.\/formula"/g, 'from "./formula.js"'));
  return out;
}

const golden = JSON.parse(readFileSync(join(DIR, 'kso-parity-golden.json'), 'utf8'));
const out = kompilasi();
let F, M;
try {
  F = await import(pathToFileURL(join(out, 'formula.js')).href);
  M = await import(pathToFileURL(join(out, 'model.js')).href);
} finally {
  process.on('exit', () => rmSync(out, { recursive: true, force: true }));
}

let uji = 0;
const meleset = [];
// Toleransi relatif — beda pembulatan floating point antar mesin, bukan beda rumus.
const cek = (label, got, want) => {
  uji++;
  const ok = typeof want === 'number'
    ? Number.isFinite(got) && Math.abs(got - want) <= Math.max(1e-9, Math.abs(want) * 1e-9)
    : got === want;
  if (!ok) meleset.push(`${label}\n      port  = ${got}\n      acuan = ${want}`);
};

const analyzerOf = (id) => golden.analyzers[id];

for (const k of golden.kasus) {
  const u = k.analyzer ? F.perUnitOf(analyzerOf(k.analyzer), k.harga) : null;

  switch (k.fn) {
    case 'hematoCost': {
      const got = F.hematoCost(analyzerOf(k.analyzer).kode, k.tests, k.workDays, u, k.mode ?? undefined);
      cek(`${k.id} · total`, got.total, k.harap.total);
      cek(`${k.id} · cyc`, got.cyc, k.harap.cyc);
      cek(`${k.id} · fix`, got.fix, k.harap.fix);
      for (const [kode, v] of Object.entries(k.harap.pr)) {
        cek(`${k.id} · pr.${kode}.c`, got.pr[kode]?.c, v.c);
        cek(`${k.id} · pr.${kode}.f`, got.pr[kode]?.f, v.f);
      }
      break;
    }
    case 'ccDetergent': {
      const got = F.ccDetergent(k.kodeAnalyzer, k.tests, k.workDays, k.concPerMl, k.probePerMl, k.batch);
      for (const f of ['total', 'conc', 'probe']) cek(`${k.id} · ${f}`, got[f], k.harap[f]);
      break;
    }
    case 'crossmatchCost': {
      const got = F.crossmatchCost(analyzerOf(k.analyzer).kode, k.tests, k.workDays, u, k.metode);
      cek(`${k.id} · total`, got.total, k.harap.total);
      for (const [kode, v] of Object.entries(k.harap.pr)) cek(`${k.id} · pr.${kode}`, got.pr[kode], v);
      break;
    }
    case 'hplcCost': {
      const got = F.hplcCost(k.tests, k.workDays, u);
      cek(`${k.id} · total`, got.total, k.harap.total);
      cek(`${k.id} · cyc`, got.cyc, k.harap.cyc);
      cek(`${k.id} · fix`, got.fix, k.harap.fix);
      for (const [kode, v] of Object.entries(k.harap.pr)) {
        cek(`${k.id} · pr.${kode}.c`, got.pr[kode]?.c, v.c);
        cek(`${k.id} · pr.${kode}.f`, got.pr[kode]?.f, v.f);
      }
      break;
    }
    case 'elektroCost': {
      const got = F.elektroCost(k.tests, k.workDays, k.calAVol, k.hargaPaket);
      for (const f of ['cpt', 'runDays', 'totalTests']) cek(`${k.id} · ${f}`, got[f], k.harap[f]);
      break;
    }
    case 'defaultMetode': {
      // Bukan rumus, tapi ikut menentukan angka: metode default = kolom terbanyak.
      const m = [...analyzerOf(k.analyzer).meta.methods].sort((a, b) => b.cols - a.cols)[0];
      cek(`${k.id} · id`, m.id, k.harap.id);
      break;
    }
    case 'hitungHemato': {
      const capex = M.hitungCapex({
        harga: { price: k.set.price, disc: k.set.disc },
        ups: k.umum.ups, lis: k.umum.lis, backup: null,
        ksoBulan: k.set.kso, testsPerMonth: k.set.tests, workDays: k.umum.workDays,
      });
      const got = M.hitungHemato(
        analyzerOf(k.analyzer), k.harga, capex, k.set.tests, k.umum.workDays, k.set.markup,
        k.kontrol, k.mode,
      );
      cek(`${k.id} · capex/test`, capex.perTest, k.harap.capexPerTest);
      for (const f of ['reagenPerTest', 'overheadKontrol', 'baseCost', 'sellPerTest']) {
        cek(`${k.id} · ${f}`, got[f], k.harap[f]);
      }
      break;
    }
    default:
      meleset.push(`${k.id} · jenis kasus tidak dikenal: ${k.fn}`);
  }
}

console.log(`Paritas Simulator KSO — acuan: ${golden.meta.sumber}`);
if (meleset.length > 0) {
  console.error(`\n${meleset.length} dari ${uji} nilai MELESET:\n`);
  for (const m of meleset.slice(0, 25)) console.error(`  ✗ ${m}`);
  if (meleset.length > 25) console.error(`  … ${meleset.length - 25} lagi`);
  console.error('\nRumus di apps/web/src/lib/kso menyimpang dari aplikasi rujukan.');
  console.error('Perbaiki rumusnya — JANGAN menyetel ulang fixture supaya lulus.');
  process.exit(1);
}
console.log(`${uji}/${uji} nilai cocok (${golden.kasus.length} kasus) — paritas utuh.`);
