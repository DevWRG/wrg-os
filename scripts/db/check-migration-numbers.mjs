#!/usr/bin/env node
// Menolak nomor migrasi ganda BARU sebelum ter-merge.
//
// Migrasi dieksekusi menurut urutan ABJAD NAMA FILE — scripts/db/migrate.sh:
// `for f in "$INIT_DIR"/*.sql`. Jadi nomor di depan nama itu penentu urutan
// eksekusi, bukan label. Dua orang yang memilih nomor sama membuat urutan
// bergantung pada sisa nama file, dan tak ada satu pun gerbang yang gagal:
// baru terlihat saat deploy hampir menyentuh skema prod.
//
// Cek ini dijalankan di CI (.github/workflows/ci.yml).
//
// ── Kenapa ada BASELINE, bukan langsung bersih ────────────────────────────────
// Saat cek ini dipasang, dev sudah punya 11 nomor bertabrakan (32 file) dari
// PR fitur yang masuk paralel, dan jumlahnya masih bertambah beberapa menit
// sekali. Memblokir semuanya sekaligus akan membekukan PR seluruh tim sampai
// penomoran dibereskan. Jadi kondisi saat itu dicatat sebagai BASELINE —
// ditoleransi sebagai utang — sementara tabrakan BARU tetap ditolak.
//
// Aturannya: satu nomor gagal kalau punya >1 file DAN ada file yang bukan
// baseline. Jadi menambah file ke nomor yang sudah bertabrakan pun ditolak.
//
// Dikunci per NAMA FILE, bukan per nomor. Versi pertama cek ini memakai nomor
// dan itu menyembunyikan duplikat nyata: dua file di 069 masih pending, tapi
// seluruh nomor 069 ikut dikecualikan.
//
// ── Utang dilunasi sebagian: 45 file → 4 ─────────────────────────────────────
// 28 file batch OPS/GA/Purchasing yang belum pernah applied di mana pun sudah
// dinomori ulang ke 127–154 (ekor), sehingga tabrakan tinggal 2 nomor / 4 file.
// Sisanya TIDAK bisa dibereskan: keempatnya sudah applied di prod, dan ledger
// schema_migrations memakai NAMA FILE — file applied yang di-rename akan tampak
// pending lalu DIEKSEKUSI ULANG. Jadi 043 dan 069 permanen begini.
//
// Kalau nanti perlu membereskan sisa baseline, periksa dulu:
//   psql -d wrg_os_prod -c "SELECT filename FROM schema_migrations WHERE filename LIKE '0XX%'"
// Dan jaga ketergantungan saat memilih nomor baru — beberapa migrasi merujuk
// tabel yang dibuat migrasi lain, dan urutannya sekarang benar hanya karena
// kebetulan nomornya berurutan. Cara membuktikannya (dipakai saat penomoran
// ulang di atas): jalankan SELURUH direktori urut nama file ke database kosong,
// lalu bandingkan `pg_dump --schema-only` sebelum vs sesudah — harus identik.
import { readdirSync } from "node:fs";

const DIR = "infra/postgres/init";
const POLA = /^(\d{3})_[a-z0-9_]+\.sql$/;

const BASELINE = new Set([
  // Utang permanen: keempatnya SUDAH applied di prod, jadi tak bisa di-rename.
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
  if (!perNomor.has(m[1])) perNomor.set(m[1], []);
  perNomor.get(m[1]).push(f);
}

const baru = [...perNomor.entries()]
  .filter(([, fs]) => fs.length > 1 && fs.some((f) => !BASELINE.has(f)))
  .sort();

const utang = [...perNomor.entries()].filter(([, fs]) => fs.length > 1).length;
const dipakai = [...perNomor.keys()].map(Number);
const berikut = String(Math.max(...dipakai) + 1).padStart(3, "0");

if (salahPola.length === 0 && baru.length === 0) {
  console.log(
    `\u2713 ${files.length} migrasi, tak ada nomor ganda baru. ` +
      `Utang baseline: ${utang} nomor. Nomor bebas berikutnya: ${berikut}.`,
  );
  process.exit(0);
}

if (salahPola.length > 0) {
  console.error(`\u2717 ${salahPola.length} nama file tak berpola NNN_nama_snake_case.sql:`);
  for (const f of salahPola) console.error(`    ${f}`);
}

if (baru.length > 0) {
  console.error(`\u2717 ${baru.length} nomor migrasi bertabrakan (di luar baseline):`);
  for (const [n, fs] of baru) {
    console.error(`    ${n} → ${fs.map((f) => (BASELINE.has(f) ? `${f} (baseline)` : `${f}  \u2190 BARU`)).join("  ·  ")}`);
  }
  console.error(
    `\n  Pakai nomor bebas: ${berikut} atau lebih.` +
      `\n  Nomor menentukan urutan eksekusi — kalau migrasimu merujuk tabel yang` +
      `\n  dibuat migrasi lain, pastikan nomornya lebih besar dari migrasi itu.`,
  );
}

process.exit(1);
