#!/usr/bin/env node
// Menolak nomor migrasi ganda sebelum ter-merge.
//
// Migrasi dieksekusi menurut urutan ABJAD NAMA FILE — scripts/db/migrate.sh:
// `for f in "$INIT_DIR"/*.sql`. Jadi nomor di depan nama itu penentu urutan
// eksekusi, bukan label. Tiga nomor pernah terpakai ganda oleh PR fitur yang
// masuk paralel (095, 096, 097 — dibereskan di PR #990) dan tak ada satu pun
// gerbang yang gagal: baru terlihat waktu deploy hampir menyentuh skema prod.
//
// Cek ini menutup celah itu. Dijalankan di CI (.github/workflows/ci.yml).
import { readdirSync } from "node:fs";

const DIR = "infra/postgres/init";
const POLA = /^(\d{3})_[a-z0-9_]+\.sql$/;

// Duplikat historis yang SENGAJA dibiarkan dan tak boleh "dirapikan":
// keempat file ini sudah applied di prod. Ledger schema_migrations memakai nama
// file, jadi me-rename file yang sudah applied membuatnya tampak pending lalu
// DIEKSEKUSI ULANG saat deploy berikutnya. Urutannya sudah terjadi dan tercatat,
// jadi duplikatnya tak berbahaya.
//
// Dikunci per NAMA FILE, bukan per nomor. Versi pertama cek ini memakai nomor
// ("043","069") dan itu menyembunyikan dua duplikat nyata: 069_atk_stock_movement
// dan 069_maintenance_schedule masih pending, tapi seluruh nomor 069 ikut
// dikecualikan. Dengan kunci nama file, file BARU di nomor 043/069 tetap gagal.
const WARISAN = new Set([
  "043_pricelist.sql",
  "043_watchpoint_husni_milestones.sql",
  "069_pipeline_stage_7.sql",
  "069_seed_master_holiday_2026.sql",
]);

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const salahPola = [];
const perNomor = new Map();

for (const f of files) {
  const m = POLA.exec(f);
  if (!m) { salahPola.push(f); continue; }
  const n = m[1];
  if (!perNomor.has(n)) perNomor.set(n, []);
  perNomor.get(n).push(f);
}

const ganda = [...perNomor.entries()]
  .filter(([, fs]) => fs.length > 1 && fs.some((f) => !WARISAN.has(f)))
  .sort();

if (salahPola.length === 0 && ganda.length === 0) {
  const dipakai = [...perNomor.keys()].map(Number);
  console.log(
    `✓ ${files.length} migrasi, nomor unik (kecuali ${WARISAN.size} file warisan yang sudah applied). ` +
      `Tertinggi: ${String(Math.max(...dipakai)).padStart(3, "0")}.`,
  );
  process.exit(0);
}

if (salahPola.length > 0) {
  console.error(`✗ ${salahPola.length} nama file tak berpola NNN_nama_snake_case.sql:`);
  for (const f of salahPola) console.error(`    ${f}`);
}

if (ganda.length > 0) {
  console.error(`✗ ${ganda.length} nomor migrasi terpakai ganda:`);
  for (const [n, fs] of ganda) {
    const tandai = fs.map((f) => (WARISAN.has(f) ? `${f} (warisan)` : f));
    console.error(`    ${n} → ${tandai.join("  ·  ")}`);
  }
  const dipakai = [...perNomor.keys()].map(Number);
  const berikut = String(Math.max(...dipakai) + 1).padStart(3, "0");
  console.error(
    `\n  Perbaikan: rename file yang BELUM diterapkan ke nomor bebas, mulai ${berikut}.` +
      `\n  Cek dulu ledger sebelum rename — file yang SUDAH applied jangan disentuh:` +
      `\n    psql -d wrg_os_prod -c "SELECT filename FROM schema_migrations WHERE filename LIKE '<nomor>%'"` +
      `\n  Ledger memakai nama file: me-rename yang sudah applied = dieksekusi ulang saat deploy.`,
  );
}

process.exit(1);
