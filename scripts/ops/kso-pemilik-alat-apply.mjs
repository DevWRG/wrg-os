#!/usr/bin/env node
// Isi `kso_asset.pemilik_alat` dari JSON hasil kso-pemilik-alat-to-json.py.
//
// ATURAN (user, 2026-08-19):
//   alat yang ada di "LAPORAN PEMBELIAN KSO DARI PENYEDIA"  -> PRINCIPAL
//   selebihnya                                              -> WRG
//
// DEFAULT DRY-RUN. Tanpa --apply tidak menulis apa pun.
//
// PAKAI:
//   pnpm --filter @wrg/api build
//   python3 scripts/ops/kso-pemilik-alat-to-json.py <xlsx> --out ~/kso-pemilik.json
//   node scripts/ops/kso-pemilik-alat-apply.mjs --file ~/kso-pemilik.json           # pratinjau
//   node scripts/ops/kso-pemilik-alat-apply.mjs --file ~/kso-pemilik.json --apply
//
// ── DUA SUMBER, BUKAN SATU, DAN ITU DISENGAJA ─────────────────────────────────────
// Selain file laporan, `kso_asset.paket = 'ASET PENYEDIA'` sudah lebih dulu menandai
// alat bermodal penyedia di sheet Populasi KSO. Keduanya digabung karena TIDAK saling
// mencakup: diperiksa pada data 2026-08-19, SN 000262802 ditandai ASET PENYEDIA di
// sheet tapi TIDAK ada di file (file justru memuat 000262803 tanpa customer — nomor
// berurutan, vendor & alat sama, kemungkinan besar salah ketik).
//
// Kalau hanya file yang dipakai, unit itu tercap milik WRG — bertentangan dengan
// penandaan sheet-nya sendiri, dan menggelembungkan basis modal WRG tanpa satu pun
// error muncul. Asal tiap baris dilaporkan supaya keputusannya bisa dianulir.
//
// ── YANG TIDAK DILAKUKAN SKRIP INI ────────────────────────────────────────────────
// SN yang tidak cocok TIDAK dipetakan lewat kemiripan. Beberapa memang mirip sekali
// (BGA102241220079 vs BGA1022412200799 di customer & alat yang sama), tapi kecocokan
// fuzzy pada nomor seri adalah cara yang sama persis dengan yang nyaris melempar
// revenue RS Blitar ke RS Gresik saat pencocokan customer. Yang meleset dilaporkan
// dengan kandidat terdekatnya untuk diputuskan manusia.
//
// ARAH KESALAHANNYA TIDAK SIMETRIS, dan itu perlu diketahui sebelum --apply:
// karena aturannya "selebihnya = WRG", setiap alat penyedia yang GAGAL dicocokkan
// akan tercatat sebagai modal WRG. Melewatkan satu berarti melebih-lebihkan investasi
// kita, bukan sekadar kehilangan data.

import { readFileSync } from "node:fs";
import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
const i = process.argv.indexOf("--file");
const FILE = i > -1 ? process.argv[i + 1] : null;

if (!FILE) {
  console.error("Pakai: node scripts/ops/kso-pemilik-alat-apply.mjs --file <path.json> [--apply]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set.");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(FILE, "utf8"));
const penyedia = payload.penyedia ?? [];
if (!penyedia.length) {
  console.error("JSON tidak memuat `penyedia`. Salah file?");
  process.exit(1);
}

const sql = db();

// Kemiripan sederhana untuk MELAPORKAN kandidat, bukan untuk memutuskan.
const mirip = (a, b) => {
  if (Math.abs(a.length - b.length) > 3) return 0;
  const n = Math.min(a.length, b.length);
  let sama = 0;
  for (let k = 0; k < n; k++) if (a[k] === b[k]) sama++;
  return sama / Math.max(a.length, b.length);
};

try {
  const aset = await sql`
    SELECT id, sn_key, sn_raw, customer_raw, nama_alat, paket, pemilik_alat
    FROM kso_asset`;
  if (!aset.length) {
    console.error("kso_asset kosong. Jalankan importer sheet dulu.");
    process.exit(1);
  }

  const bySn = new Map(aset.map((a) => [String(a.sn_key), a]));
  const dariFile = new Set();
  const meleset = [];
  for (const p of penyedia) {
    if (bySn.has(p.snKey)) dariFile.add(p.snKey);
    else meleset.push(p);
  }

  // Sumber kedua: penandaan yang sudah ada di sheet Populasi KSO.
  const dariSheet = aset
    .filter((a) => String(a.paket ?? "").toUpperCase() === "ASET PENYEDIA")
    .map((a) => String(a.sn_key));
  const tambahanSheet = dariSheet.filter((s) => !dariFile.has(s));

  const principal = new Set([...dariFile, ...dariSheet]);
  const wrg = aset.filter((a) => !principal.has(String(a.sn_key)));

  console.log("=== Sumber ===");
  console.log(`  file laporan penyedia   : ${penyedia.length} baris`);
  console.log(`    cocok ke kso_asset    : ${dariFile.size}`);
  console.log(`    TIDAK cocok           : ${meleset.length}`);
  console.log(`  paket='ASET PENYEDIA'   : ${dariSheet.length}  (tambahan di luar file: ${tambahanSheet.length})`);
  console.log(`\n=== Rencana tulis ===`);
  console.log(`  pemilik_alat = PRINCIPAL : ${principal.size}`);
  console.log(`  pemilik_alat = WRG       : ${wrg.length}`);
  console.log(`  total aset               : ${aset.length}`);

  const sudahDiisi = aset.filter((a) => a.pemilik_alat !== null).length;
  if (sudahDiisi) {
    console.log(`\n  CATATAN: ${sudahDiisi} aset pemilik_alat-nya SUDAH terisi dan akan DITIMPA.`);
  }

  if (tambahanSheet.length) {
    console.log(`\n=== Dari sheet, TIDAK ada di file (periksa) ===`);
    for (const s of tambahanSheet) {
      const a = bySn.get(s);
      console.log(`  ${String(a.sn_raw ?? s).padEnd(20)} ${String(a.customer_raw).slice(0, 40).padEnd(42)} ${a.nama_alat ?? ""}`);
    }
  }

  if (meleset.length) {
    console.log(`\n=== SN di file yang TIDAK cocok — akan tercatat WRG kalau dibiarkan ===`);
    for (const p of meleset) {
      const kand = aset
        .map((a) => ({ a, s: mirip(p.snKey, String(a.sn_key)) }))
        .sort((x, y) => y.s - x.s)
        .filter((x) => x.s >= 0.8)
        .slice(0, 2);
      console.log(`  ${p.snRaw.padEnd(20)} ${String(p.peruntukan ?? "(tanpa customer)").slice(0, 40).padEnd(42)} ${p.keterangan ?? ""}`);
      for (const k of kand) {
        console.log(`      ~ ${String(k.a.sn_raw ?? k.a.sn_key).padEnd(20)} ${String(k.a.customer_raw).slice(0, 40).padEnd(42)} ${k.a.nama_alat ?? ""}`);
      }
      if (!kand.length) console.log("      ~ (tidak ada yang mirip di kso_asset)");
    }
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. Tidak ada yang ditulis. Tambahkan --apply untuk mengeksekusi.");
    process.exit(0);
  }

  const ids = [...principal].map((s) => bySn.get(s)?.id).filter(Boolean);
  await sql`UPDATE kso_asset SET pemilik_alat = 'PRINCIPAL', updated_at = now()
            WHERE id = ANY(${ids})`;
  await sql`UPDATE kso_asset SET pemilik_alat = 'WRG', updated_at = now()
            WHERE NOT (id = ANY(${ids}))`;

  const cek = await sql`
    SELECT COALESCE(pemilik_alat, '(kosong)') AS pemilik, count(*)::int AS n
    FROM kso_asset GROUP BY 1 ORDER BY 2 DESC`;
  console.log("\nSELESAI. Sebaran pemilik_alat sekarang:");
  for (const r of cek) console.log(`  ${String(r.pemilik).padEnd(12)} ${r.n}`);
  console.log(
    "\nIngat: aturan 'selebihnya = WRG' membuat setiap alat penyedia yang belum tercocokkan\n" +
    "tercatat sebagai modal WRG. Sisir daftar tidak-cocok di atas sebelum angka ini dipakai.");
} finally {
  await sql.end({ timeout: 5 });
}
