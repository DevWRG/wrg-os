#!/usr/bin/env node
// F67 — seed tier UT + batas bulanan per AM ke `insentif_am_config` (migrasi 093).
//
// KENAPA SKRIP, BUKAN SEED DI MIGRASI:
// Sumber tier (AM_META di `wrg_incentive_console_v2.jsx`) memakai kode tiga huruf —
// LRI, CHS, ARF, dst. Itu kode SALESMAN Accurate, BUKAN master_user.am_id (am_id =
// user_id legacy, bentuknya angka). Menulisnya langsung di migrasi = FK gagal =
// deploy prod berhenti, karena migrasi di-apply otomatis saat deploy sejak v1.105.0.
//
// Skrip ini memetakan kode → am_id lewat accurate_salesman → master_user_id, jalur yang
// sama dengan joinAmFromSalesman. Default DRY-RUN: tampilkan hasil resolusi, jangan tulis
// apa-apa. Tulis hanya dengan --apply.
//
// ⚠️ KOLOM accurate_salesman TERTUKAR DI MIRROR PROD (diperiksa 2026-09-20):
//   `name`   berisi KODE tiga huruf  — LRI, CHS, ARF, …
//   `number` berisi NAMA LENGKAP     — "Luri Anpulan Mulia Pohan", …
// Versi pertama skrip ini mencocokkan kode ke `number` saja, jadi di prod ia me-resolve
// NOL dari 12 kode — dan karena nol bukan error, ia keluar dengan tenang dan
// insentif_am_config tetap kosong. Tanpa tier, computePeriode melewati AM itu tanpa
// bersuara: seluruh fitur diam tanpa satu pesan gagal pun.
// Karena itu kode dicocokkan ke KEDUA kolom, dan kegagalan resolusi total dianggap
// kondisi yang harus diteriakkan (exit code 1), bukan hasil.
//
// Pakai (WAJIB build dulu — skrip ini memakai apps/api/dist, sama seperti npk-compare-metode.mjs):
//   pnpm --filter @wrg/api build
//   node scripts/ops/insentif-seed-tier.mjs              # pratinjau
//   node scripts/ops/insentif-seed-tier.mjs --apply      # tulis
//
// cap_bulanan = 2 x gaji pokok per tier (sumber AM_META): P3 7jt, P2 5,5jt, P1 4,5jt, P0 4jt.
//
// Flag:
//   --apply              tulis ke DB (default: pratinjau)
//   --termasuk-nonaktif  ikut menulis AM yang master_user.aktif = false

import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
const TERMASUK_NONAKTIF = process.argv.includes("--termasuk-nonaktif");

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
    // Kode dicocokkan ke KEDUA kolom salesman (lihat catatan kolom tertukar di atas),
    // lalu turun ke master_user. Sebagian roster juga memakai kode sebagai panggilan,
    // jadi dicoba sebagai cadangan terakhir — HANYA kalau jalur salesman gagal, supaya
    // tidak salah orang.
    const [viaSalesman] = await sql`
      SELECT mu.am_id, mu.nama, mu.aktif,
             CASE WHEN upper(acs.name) = ${kode.toUpperCase()} THEN 'accurate_salesman.name'
                  ELSE 'accurate_salesman.number' END AS jalur
      FROM accurate_salesman acs
      JOIN master_user mu ON mu.am_id = acs.master_user_id::text
      WHERE upper(acs.name) = ${kode.toUpperCase()} OR upper(acs.number) = ${kode.toUpperCase()}
      LIMIT 1`;

    let hit = viaSalesman;
    let jalur = viaSalesman?.jalur ?? "";

    if (!hit) {
      const [viaPanggilan] = await sql`
        SELECT am_id, nama, aktif FROM master_user
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
    rows.push({
      kode, tier, am_id: hit.am_id, nama: hit.nama, cap: CAP_PER_TIER[tier], jalur,
      aktif: hit.aktif !== false,
    });
  }

  console.log(`\nResolusi ${rows.length}/${SEED.length} kode:\n`);
  for (const r of rows) {
    console.log(
      `  ${r.kode}  ->  am_id ${String(r.am_id).padEnd(8)} ${String(r.nama).padEnd(26)} ` +
        `tier ${r.tier}  cap ${r.cap.toLocaleString("id-ID")}` +
        `${r.aktif ? "" : "  [NONAKTIF]"}   [${r.jalur}]`,
    );
  }

  if (gagal.length) {
    console.log(`\n⚠️  TIDAK ter-resolve (${gagal.length}): ${gagal.join(", ")}`);
    console.log("   Kode ini tidak ketemu di accurate_salesman (name/number) maupun master_user.panggilan.");
    console.log("   Jangan dipaksa — cek dulu apakah kodenya berubah atau orangnya sudah tidak aktif.");
  }

  // Nol resolusi = pemetaannya yang salah, bukan rosternya yang kosong. Ini pernah
  // terjadi (kolom tertukar) dan lolos tanpa gejala karena skripnya keluar normal.
  if (rows.length === 0) {
    console.error("\n❌ TIDAK ADA satu pun kode yang ter-resolve. Pemetaan kode → am_id patah;");
    console.error("   memakai hasil ini berarti insentif_am_config tetap kosong dan SELURUH");
    console.error("   perhitungan insentif diam tanpa error. Perbaiki dulu, jangan lanjut.");
    process.exit(1);
  }

  const nonaktif = rows.filter((r) => !r.aktif);
  if (nonaktif.length) {
    console.log(`\nℹ️  ${nonaktif.length} AM nonaktif di roster: ${nonaktif.map((r) => r.kode).join(", ")}`);
    console.log(
      TERMASUK_NONAKTIF
        ? "   --termasuk-nonaktif diberikan → tetap ditulis."
        : "   DILEWATI. Pakai --termasuk-nonaktif kalau memang mau dihitung insentifnya.",
    );
  }

  // AM aktif yang TIDAK ada di daftar tier. Penting diteriakkan: AM tanpa baris config
  // dilewati computePeriode tanpa suara — insentifnya nol, dan tak ada yang memberi tahu
  // dia maupun HoD-nya kenapa.
  const tanpaTier = await sql`
    SELECT mu.am_id, mu.nama, mu.cabang FROM master_user mu
    WHERE upper(mu.role) = 'AM' AND mu.aktif IS NOT FALSE
      AND mu.am_id <> ALL(${rows.map((r) => String(r.am_id))}::text[])
    ORDER BY mu.nama`;
  if (tanpaTier.length) {
    console.log(`\n⚠️  ${tanpaTier.length} AM AKTIF tanpa tier di daftar ini:`);
    for (const t of tanpaTier) console.log(`     am_id ${t.am_id}  ${t.nama}  (${t.cabang ?? "-"})`);
    console.log("   Mereka TIDAK akan dapat insentif sama sekali sampai tier-nya ditetapkan.");
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. Tambahkan --apply untuk menulis.\n");
    process.exit(0);
  }

  let ditulis = 0;
  for (const r of rows) {
    if (!r.aktif && !TERMASUK_NONAKTIF) continue;
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
