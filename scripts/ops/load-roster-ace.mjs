#!/usr/bin/env node
// Muat Roster Program ACE (WRG_NPK_Sales_Roster.pdf Bagian 6) ke sistem:
//   master_user.golongan          ← kolom "Level Saat Ini"
//   sales_target_am.target_customer ← kolom "Target Program" (jumlah faskes)
//   sales_target_am.target         ← kolom "Target Program" (Rupiah) — HANYA dgn --with-revenue
//
// DRY-RUN ADALAH DEFAULT. Tanpa --apply tak ada satu baris pun ditulis; script
// hanya melaporkan siapa yang cocok, siapa yang tidak, dan apa yang akan berubah.
//
// Pakai:
//   node scripts/ops/load-roster-ace.mjs                    # lihat rencana (aman)
//   node scripts/ops/load-roster-ace.mjs --apply            # tulis golongan + target customer
//   node scripts/ops/load-roster-ace.mjs --apply --with-revenue --year 2026
//
// ── DUA HAL YANG BELUM DIJAWAB DIREKTUR (klarifikasi ADR-040) ───────────────
// 1. "AM Senior" di Roster tak terpecah I/II, sedangkan SK Pasal 2.1 punya AM-2
//    (Senior I) & AM-3 (Senior II). Script memakai AM-2 — yang LEBIH RENDAH.
//    Untuk NPK ini tidak berpengaruh (target New Customer Sr=2 sama di AM-2/AM-3),
//    tapi berpengaruh untuk kelayakan naik golongan & rate insentif nanti.
// 2. "Target Program" Rupiah tidak menyebut satuan waktunya. Membacanya sebagai
//    TAHUNAN konsisten dgn skala Roster sendiri (Bagian 1: AM Senior ≥Rp 3M/thn),
//    tapi TIDAK konsisten dgn SK Pasal 2.1 yang memakai satuan per BULAN
//    (AM-2 Rp 750jt/bln = Rp 9M/thn). Karena angka ini langsung menggerakkan aspek
//    Revenue (bobot 25), penulisannya dikunci di balik --with-revenue.
//
// Target CUSTOMER tidak punya ambiguitas itu (jumlah faskes aktif = stock, bukan
// akumulasi periode), jadi ikut ditulis secara default.

import { db } from "../../apps/api/dist/db.js";
import { GOLONGAN_DARI_ROSTER } from "../../apps/api/dist/lib/npk-golongan.js";

// Roster Bagian 6, apa adanya. `kode` = kode salesman Accurate (dipakai verifikasi).
const ROSTER = [
  { area: "Jember",        nama: "Luri",   kode: "LRI", level: "AM Senior", revenue: 10_000_000_000, customer: 50, kso: 26 },
  { area: "Malang",        nama: "Firman", kode: "FMA", level: "AM Senior", revenue:  5_000_000_000, customer: 40, kso: 26 },
  { area: "NTB",           nama: "Vicky",  kode: "VIC", level: "AM Jr II",  revenue:  3_500_000_000, customer: 25, kso: 14 },
  { area: "NTT",           nama: "Dodi",   kode: "DOD", level: "AM Jr II",  revenue:  2_000_000_000, customer: 12, kso:  9 },
  { area: "Bali",          nama: "Ari",    kode: null,  level: "AM Jr I",   revenue:  1_500_000_000, customer: 20, kso:  8 },
  { area: "Kediri",        nama: "Aulia",  kode: "AUL", level: "AM Senior", revenue:  6_000_000_000, customer: 32, kso: 27 },
  { area: "Madura",        nama: "Angga",  kode: "GGA", level: "AM Senior", revenue:  5_500_000_000, customer: 19, kso: 16 },
  { area: "Surabaya 2",    nama: "Arif",   kode: "ARF", level: "AM Senior", revenue:  9_000_000_000, customer: 71, kso: 34 },
  { area: "Madiun",        nama: "Wildha", kode: "WDA", level: "AM Senior", revenue:  7_000_000_000, customer: 19, kso: 18 },
  { area: "Lamongan",      nama: "Irul",   kode: "CHS", level: "AM Senior", revenue:  9_000_000_000, customer: 38, kso: 29 },
  { area: "Solo & Jogja",  nama: "Sidqi",  kode: "SID", level: "AM Jr I",   revenue:  1_500_000_000, customer: 20, kso: 13 },
  { area: "Palembang",     nama: "Yugo",   kode: "YGO", level: "AM Jr II",  revenue:  2_000_000_000, customer: 14, kso: 12 },
  { area: "Cirebon",       nama: "Iqbal",  kode: "IQB", level: "AM Jr II",  revenue:  2_000_000_000, customer: 20, kso:  7 },
  { area: "Jakarta",       nama: "Ibnu",   kode: null,  level: "AM Jr I",   revenue:  2_500_000_000, customer: 17, kso: 18 },
];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const withRevenue = args.includes("--with-revenue");
const yearArg = args.indexOf("--year");
const year = yearArg >= 0 ? Number(args[yearArg + 1]) : new Date().getFullYear();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set. Contoh: set -a; . ./.env.prod; set +a");
  process.exit(2);
}

const sql = db();
const rp = (n) => "Rp " + new Intl.NumberFormat("id-ID").format(n);
const pad = (s, n) => String(s ?? "").padEnd(n);

// Cocokkan nama Roster → master_user, DUA TAHAP dan berhenti di tahap pertama
// yang membuahkan hasil:
//   1. persis  — panggilan atau nama sama persis
//   2. kata utuh — nama memuat kata itu sebagai KATA (regex batas kata)
// Pencocokan "mengandung" bebas SENGAJA TIDAK dipakai: uji di dev membuktikan "Ari"
// ikut menyambar "Sari Demo" dan "Dewi Lestari". Kandidat ganda tidak pernah dipilih
// otomatis — menebak identitas orang untuk data HR tak boleh dilakukan diam-diam.
async function cocokkan(nama) {
  const persis = await sql`
    SELECT am_id, nama, panggilan, role, cabang, golongan
    FROM master_user
    WHERE aktif IS NOT FALSE
      AND (lower(panggilan) = lower(${nama}) OR lower(nama) = lower(${nama}))`;
  if (persis.length) return persis;
  return await sql`
    SELECT am_id, nama, panggilan, role, cabang, golongan
    FROM master_user
    WHERE aktif IS NOT FALSE
      AND nama ~* ${"(^|\\s)" + nama + "($|\\s)"}`;
}

const rencana = [];
const bermasalah = [];

for (const r of ROSTER) {
  const kandidat = await cocokkan(r.nama);
  const golongan = GOLONGAN_DARI_ROSTER[r.level.toUpperCase()];
  if (!golongan) { bermasalah.push({ ...r, sebab: `level "${r.level}" tak dikenal` }); continue; }
  if (kandidat.length === 0) { bermasalah.push({ ...r, sebab: "tak ada di master_user" }); continue; }
  if (kandidat.length > 1) {
    bermasalah.push({ ...r, sebab: `ambigu — ${kandidat.length} kandidat: ${kandidat.map((k) => `${k.nama} (${k.am_id})`).join(", ")}` });
    continue;
  }
  const m = kandidat[0];
  const [t] = await sql`
    SELECT target::float8 AS target, COALESCE(target_customer,0)::float8 AS target_customer
    FROM sales_target_am WHERE year = ${year} AND am_id = ${m.am_id}`;
  rencana.push({
    ...r, golongan, am_id: m.am_id, mu_nama: m.nama, mu_cabang: m.cabang,
    golongan_lama: m.golongan, target_lama: Number(t?.target ?? 0), cust_lama: Number(t?.target_customer ?? 0),
  });
}

console.log(`\nRoster Program ACE → sistem · tahun target ${year} · mode ${apply ? "APPLY (menulis)" : "DRY-RUN (tidak menulis)"}`);
console.log(`Revenue: ${withRevenue ? "IKUT ditulis (asumsi angka Roster = TAHUNAN)" : "TIDAK ditulis (pakai --with-revenue bila sudah pasti satuannya)"}\n`);
console.log(`${pad("AM", 10)} ${pad("am_id", 8)} ${pad("cabang", 12)} ${pad("golongan", 16)} ${pad("target cust", 16)} target revenue`);
console.log("─".repeat(100));
for (const p of rencana) {
  const gol = p.golongan_lama === p.golongan ? `${p.golongan} (tetap)` : `${p.golongan_lama ?? "—"} → ${p.golongan}`;
  const cust = p.cust_lama === p.customer ? `${p.customer} (tetap)` : `${p.cust_lama || "—"} → ${p.customer}`;
  const rev = !withRevenue ? "(dilewati)" : p.target_lama === p.revenue ? `${rp(p.revenue)} (tetap)` : `${p.target_lama ? rp(p.target_lama) : "—"} → ${rp(p.revenue)}`;
  console.log(`${pad(p.nama, 10)} ${pad(p.am_id, 8)} ${pad(p.mu_cabang ?? "—", 12)} ${pad(gol, 16)} ${pad(cust, 16)} ${rev}`);
}

if (bermasalah.length) {
  console.log(`\n⚠ ${bermasalah.length} baris TIDAK diproses — perlu keputusan manusia:`);
  for (const b of bermasalah) console.log(`  ${pad(b.nama, 10)} ${pad(b.area, 14)} ${b.sebab}`);
  console.log("  (Ari/Bali & Ibnu/Jakarta memang ditandai 'konfirmasi HOD' di Roster-nya sendiri.)");
}

if (!apply) {
  console.log(`\nDRY-RUN — tidak ada yang ditulis. Jalankan lagi dengan --apply untuk menerapkan ${rencana.length} baris.\n`);
  process.exit(0);
}

let golUpd = 0, tgtUpd = 0;
for (const p of rencana) {
  await sql`UPDATE master_user SET golongan = ${p.golongan} WHERE am_id = ${p.am_id}`;
  golUpd += 1;
  if (withRevenue) {
    await sql`
      INSERT INTO sales_target_am (year, am_id, target, target_customer, updated_at)
      VALUES (${year}, ${p.am_id}, ${p.revenue}, ${p.customer}, now())
      ON CONFLICT (year, am_id) DO UPDATE
        SET target = EXCLUDED.target, target_customer = EXCLUDED.target_customer, updated_at = now()`;
  } else {
    // Tanpa --with-revenue: JANGAN sentuh kolom target revenue yang sudah ada.
    await sql`
      INSERT INTO sales_target_am (year, am_id, target, target_customer, updated_at)
      VALUES (${year}, ${p.am_id}, 0, ${p.customer}, now())
      ON CONFLICT (year, am_id) DO UPDATE
        SET target_customer = EXCLUDED.target_customer, updated_at = now()`;
  }
  tgtUpd += 1;
}

console.log(`\n✅ golongan: ${golUpd} baris · sales_target_am: ${tgtUpd} baris (tahun ${year}).`);
console.log("Jalankan recompute agar skor ikut berubah: POST /npk/am/compute?year=&period=\n");
process.exit(0);
