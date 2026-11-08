// F150 — impor data biaya hasil handover Direktur ke DB (kamus + baris biaya Jul–Okt 2026).
//
//   DATABASE_URL=postgres://... pnpm --filter @wrg/api exec tsx ../../scripts/db/import_f150_biaya.mts <folder> [--apply]
//
// <folder> berisi (nama file mengikuti paket Direktur): 1-daftar-akun-beban-hpp.csv,
// 2-biaya-jul-okt-2026-bertanda-area.csv, 3-kamus-kota-area.csv, 4-kamus-payee-biaya-operasional.csv.
// DATA TIDAK DI REPO (privat: nominal + nama asli) — skrip ini hanya membaca dari folder lokal.
// Dry-run default (tanpa --apply tak ada yang ditulis).
//
// Yang dimasukkan:
//   3 → biaya_kamus_alias_kota   (kata kunci kota → area; tak menimpa yang sudah ada)
//   4 → biaya_kamus_payee        (hanya baris yang kolom area_isi_manual-nya diisi)
//   2 → biaya_area_baris         (area DIHITUNG ULANG dengan aturan repo, bukan tebakan_area di CSV;
//                                 kelompok HPP dilewati). Baris impor ber-accurate_id NEGATIF supaya
//                                 terbedakan dari baris puller (ID Accurate positif) — hapus sebelum
//                                 puller menarik periode yang sama: DELETE FROM biaya_area_baris WHERE accurate_id < 0.
//   1 → hanya pemeriksaan konsistensi (kelompok akun di CSV vs kelompokAkun() di kode).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "../../apps/api/src/db.ts";
import { kelompokAkun, normArea, tebakArea, type SumberBiaya } from "../../apps/api/src/repo/biaya-area-rules.ts";
import { muatKonteksArea } from "../../apps/api/src/repo/biaya-area-sync.ts";

function csv(t: string): Record<string, string>[] {
  const rows: string[][] = [];
  let r: string[] = [], c = "", q = false;
  t = t.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { r.push(c); c = ""; }
    else if (ch === "\n") { r.push(c); rows.push(r); r = []; c = ""; }
    else if (ch !== "\r") c += ch;
  }
  if (c || r.length) { r.push(c); rows.push(r); }
  const [h, ...body] = rows;
  return body.filter((x) => x.some((v) => v !== "")).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i] ?? ""])));
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) { console.error("pemakaian: import_f150_biaya.mts <folder> [--apply]"); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL belum di-set"); process.exit(2); }
const baca = (n: string) => csv(readFileSync(join(dir, n), "utf8"));

const akun = baca("1-daftar-akun-beban-hpp.csv");
const kota = baca("3-kamus-kota-area.csv");
const payee = baca("4-kamus-payee-biaya-operasional.csv");
const biaya = baca("2-biaya-jul-okt-2026-bertanda-area.csv");

// ── pemeriksaan konsistensi akun (file 1) ──
const KEL_CSV: Record<string, string | null> = { SDM: "SDM", OPERASIONAL: "OPERASIONAL", "LUAR USAHA": "LUAR USAHA", HPP: null, PAJAK: null };
let akunBeda = 0;
for (const a of akun) {
  const harap = KEL_CSV[a.kelompok_f150] ?? null;
  if (a.akun.length > 4 && kelompokAkun(a.akun) !== harap) { akunBeda++; console.log(`  ⚠ akun ${a.akun}: CSV=${a.kelompok_f150} kode=${kelompokAkun(a.akun)}`); }
}
const akunDikenal = new Set(akun.map((a) => a.akun));
const akunAsing = [...new Set(biaya.map((b) => b.akun))].filter((x) => !akunDikenal.has(x));

const ADA_SUMBER: Record<string, SumberBiaya> = { "Pembayaran Lain": "other-payment", "Faktur Pembelian (biaya)": "purchase-invoice" };
const barisImpor = biaya.filter((b) => ADA_SUMBER[b.sumber] && kelompokAkun(b.akun));
const payeeManual = payee.filter((p) => p.area_isi_manual.trim());

console.log(`mode: ${apply ? "APPLY" : "dry-run"} · target: ${process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@")}`);
console.log(`akun (file 1): ${akun.length}, kelompok tak cocok: ${akunBeda}; akun di file 2 yang tak ada di file 1: ${akunAsing.length}`);
console.log(`kamus kota (file 3): ${kota.length} baris`);
console.log(`kamus payee (file 4): ${payee.length} payee, terisi manual: ${payeeManual.length}`);
console.log(`baris biaya (file 2): ${biaya.length}, akan diimpor: ${barisImpor.length} (HPP/lainnya dilewati: ${biaya.length - barisImpor.length})`);

if (!apply) { console.log("\n(dry-run — tambahkan --apply untuk menulis)"); process.exit(0); }

const sql = db();
for (const k of kota) {
  await sql`INSERT INTO biaya_kamus_alias_kota (kata_kunci, area, catatan) VALUES (${k.kata_kunci.toUpperCase()}, ${normArea(k.area)}, ${"impor F150: " + k.sumber})
            ON CONFLICT (kata_kunci) DO NOTHING`;
}
for (const p of payeeManual) {
  await sql`INSERT INTO biaya_kamus_payee (payee, area, catatan) VALUES (${p.payee.trim().toUpperCase()}, ${normArea(p.area_isi_manual)}, 'impor F150')
            ON CONFLICT (payee) DO UPDATE SET area = EXCLUDED.area`;
}
const ctx = await muatKonteksArea(); // setelah kamus masuk
let tertandai = 0, total = 0, multi = 0;
await sql.begin(async (tx) => {
  await tx`DELETE FROM biaya_area_baris WHERE accurate_id < 0`;
  let i = 0;
  for (const b of barisImpor) {
    i++;
    const sumber = ADA_SUMBER[b.sumber];
    const jumlah = Number(b.jumlah) || 0;
    const h = tebakArea({ sumber, tanggal: b.tanggal, akun: b.akun, keterangan: b.keterangan, payee: b.payee }, ctx);
    if (b.kelompok === "OPERASIONAL") { total += jumlah; if (h.tertandai) tertandai += jumlah; }
    if (h.bagi) multi++;
    await tx`
      INSERT INTO biaya_area_baris (sumber, accurate_id, seq, tanggal, nomor, akun, nama_akun, kelompok, jumlah, keterangan, payee, departemen, area, area_bagi, dasar, tertandai)
      VALUES (${sumber}, ${-i}, 0, ${b.tanggal}, ${b.nomor}, ${b.akun}, ${b.nama_akun}, ${b.kelompok}, ${jumlah}, ${b.keterangan}, ${b.payee}, NULL, ${h.area}, ${h.bagi}, ${h.dasar}, ${h.tertandai})`;
  }
});
console.log(`selesai: ${barisImpor.length} baris diimpor (multi-area ${multi}); OPERASIONAL tertandai ${total > 0 ? ((100 * tertandai) / total).toFixed(1) : 0}%`);
process.exit(0);
