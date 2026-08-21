#!/usr/bin/env node
// F67 — seed tier UT + batas bulanan per AM ke `insentif_am_config` (migrasi 093).
//
// KENAPA SKRIP, BUKAN SEED DI MIGRASI:
// Sumber tier (AM_META di `wrg_incentive_console_v2.jsx`) memakai kode tiga huruf —
// LRI, CHS, ARF, dst. Itu kode SALESMAN Accurate, BUKAN master_user.am_id (am_id =
// user_id legacy, bentuknya angka). Menulisnya langsung di migrasi = FK gagal =
// deploy prod berhenti, karena migrasi di-apply otomatis saat deploy sejak v1.105.0.
//
// Skrip ini memetakan kode → am_id lewat accurate_salesman.number → master_user_id,
// jalur yang sama dengan joinAmFromSalesman. Default DRY-RUN: tampilkan hasil resolusi,
// jangan tulis apa-apa. Tulis hanya dengan --apply.
//
// Pakai (WAJIB build dulu — skrip ini memakai apps/api/dist, sama seperti npk-compare-metode.mjs):
//   pnpm --filter @wrg/api build
//   node scripts/ops/insentif-seed-tier.mjs              # pratinjau
//   node scripts/ops/insentif-seed-tier.mjs --apply      # tulis
//
// cap_bulanan = 2 x gaji pokok per tier (sumber AM_META): P3 7jt, P2 5,5jt, P1 4,5jt, P0 4jt.

import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");

const CAP_PER_TIER = { P3: 14_000_000, P2: 11_000_000, P1: 9_000_000, P0: 8_000_000, OSP: 0 };

// Kode salesman → tier. Sumber: AM_META wrg_incentive_console_v2.jsx.
const SEED = [
  ["LRI", "P3"], ["CHS", "P3"], ["ARF", "P3"],
  ["WDA", "P2"], ["AUL", "P2"], ["GGA", "P2"], ["FMA", "P2"],
  ["VIC", "P1"], ["YGO", "P1"], ["IQB", "P1"], ["SID", "P1"],
  ["DOD", "P0"],
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set.");
  process.exit(1);
}
const sql = db();

try {
  const rows = [];
  const gagal = [];

  for (const [kode, tier] of SEED) {
    // Resolusi berlapis: kode = accurate_salesman.number, lalu turun ke master_user.
    // Sebagian roster juga memakai kode itu sebagai panggilan, jadi dicoba sebagai
    // cadangan — tapi HANYA kalau jalur salesman gagal, supaya tidak salah orang.
    const [viaSalesman] = await sql`
      SELECT mu.am_id, mu.nama
      FROM accurate_salesman acs
      JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE upper(acs.number) = ${kode.toUpperCase()}
      LIMIT 1`;

    let hit = viaSalesman;
    let jalur = "accurate_salesman.number";

    if (!hit) {
      const [viaPanggilan] = await sql`
        SELECT am_id, nama FROM master_user
        WHERE upper(panggilan) = ${kode.toUpperCase()} AND aktif IS NOT FALSE
        LIMIT 1`;
      if (viaPanggilan) {
        hit = viaPanggilan;
        jalur = "master_user.panggilan (cadangan)";
      }
    }

    if (!hit) {
      gagal.push(kode);
      continue;
    }
    rows.push({ kode, tier, am_id: hit.am_id, nama: hit.nama, cap: CAP_PER_TIER[tier], jalur });
  }

  console.log(`\nResolusi ${rows.length}/${SEED.length} kode:\n`);
  for (const r of rows) {
    console.log(
      `  ${r.kode}  ->  am_id ${String(r.am_id).padEnd(8)} ${String(r.nama).padEnd(22)} ` +
        `tier ${r.tier}  cap ${r.cap.toLocaleString("id-ID")}   [${r.jalur}]`,
    );
  }

  if (gagal.length) {
    console.log(`\n⚠️  TIDAK ter-resolve (${gagal.length}): ${gagal.join(", ")}`);
    console.log("   Kode ini tidak ketemu di accurate_salesman.number maupun master_user.panggilan.");
    console.log("   Jangan dipaksa — cek dulu apakah kodenya berubah atau orangnya sudah tidak aktif.");
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. Tambahkan --apply untuk menulis.\n");
    process.exit(0);
  }

  let ditulis = 0;
  for (const r of rows) {
    // ON CONFLICT DO NOTHING: tier yang sudah disetel manual di prod jangan ditimpa seed.
    const res = await sql`
      INSERT INTO insentif_am_config (am_id, tier_ut, cap_bulanan, updated_by)
      VALUES (${r.am_id}, ${r.tier}, ${r.cap}, 'seed-tier-script')
      ON CONFLICT (am_id) DO NOTHING`;
    if (res.count > 0) ditulis++;
  }

  console.log(`\n✅ ${ditulis} baris ditulis, ${rows.length - ditulis} dilewati (sudah ada).\n`);
} finally {
  await sql.end();
}
