#!/usr/bin/env node
// Tautkan ulang laporan kunjungan lama (activity_log) ke faskes Accurate.
//
// Latar (13 Okt 2026): 3.999 dari 4.791 baris activity_log di prod tak punya
// account_id karena penaut lama membandingkan trigram nama utuh — gagal pada
// "Cust : Puskesmas X" vs Accurate "X, PKM KAB. Y". Akibatnya Timeline Accounts
// (filter Aktivitas AM) nyaris kosong. Penaut baru: apps/api/src/repo/akun-faskes.ts
// (jenis faskes = pembeda; ragu = tidak ditautkan).
//
// PAKAI (di Mac mini, sesudah `pnpm --filter @wrg/api build`):
//   node scripts/ops/tautkan-kunjungan-akun.mjs                      # pratinjau, tanpa tulis
//   node scripts/ops/tautkan-kunjungan-akun.mjs --csv /tmp/x.csv     # + lembar tinjauan
//   node scripts/ops/tautkan-kunjungan-akun.mjs --apply              # isi yang KOSONG saja
//   node scripts/ops/tautkan-kunjungan-akun.mjs --apply --perbaiki-lama
//        ^ juga MENGGANTI tautan lama yang berbeda dari hasil penaut baru tier 1
//          (mis. "PMI Kab Kediri" yang dulu tertaut ke "KRAS, PKM").
//
// --apply selalu menulis berkas pemulihan (id;account_id_lama;account_id_baru)
// ke /tmp/tautkan-kunjungan-<waktu>.csv. Idempoten: baris yang sudah tertaut
// tak disentuh kecuali --perbaiki-lama.

import { writeFileSync } from "node:fs";
import { db } from "../../apps/api/dist/db.js";
import { katalogFaskes, tautkanFaskes } from "../../apps/api/dist/repo/akun-faskes.js";

const APPLY = process.argv.includes("--apply");
const PERBAIKI = process.argv.includes("--perbaiki-lama");
const csvIdx = process.argv.indexOf("--csv");
const CSV = csvIdx > -1 ? process.argv[csvIdx + 1] : null;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set.");
  process.exit(1);
}

const sql = db();
const katalog = await katalogFaskes();
const baris = await sql`
  SELECT al.id, al.customer_name, al.account_id,
         COALESCE(NULLIF(ac.name,''), ac.raw->>'name') AS nama_lama
  FROM activity_log al LEFT JOIN accurate_customer ac ON ac.id = al.account_id
  WHERE al.customer_name IS NOT NULL`;

// Satu kali per nama unik — ribuan baris berbagi beberapa ratus nama.
const hasilNama = new Map();
for (const r of baris) {
  if (!hasilNama.has(r.customer_name)) hasilNama.set(r.customer_name, tautkanFaskes(r.customer_name, katalog));
}

const isi = []; // [id, lama, baru]
const ganti = [];
const hitung = { kosong: 0, tertaut_t1: 0, tertaut_t2: 0, ambigu: 0, tak_ketemu: 0, lama_sama: 0, lama_beda: 0, lama_pribadi: 0, lama_tak_yakin: 0 };
const tinjau = [];
for (const r of baris) {
  const h = hasilNama.get(r.customer_name);
  if (r.account_id == null) {
    hitung.kosong++;
    if (h.kind === "one") {
      hitung[h.tier === 1 ? "tertaut_t1" : "tertaut_t2"]++;
      isi.push([Number(r.id), null, h.id]);
    } else if (h.kind === "ambiguous") hitung.ambigu++;
    else hitung.tak_ketemu++;
  } else if (h.kind === "one" && h.id === Number(r.account_id)) hitung.lama_sama++;
  else if (h.kind === "one" && h.tier === 1) {
    // Tautan lama ke akun PRIBADI di instansi yang sama & sekota ("UUS, BU /
    // DINKES KAB. PAMEKASAN" untuk "Dinkes Pamekasan") dibiarkan: faktur instansi
    // itu bisa saja ditagihkan ke akun pribadi tersebut. Yang diganti hanya yang
    // jelas salah — beda jenis atau beda kota (PMI → PKM/PLN, Lombok Barat → Tengah).
    const lama = katalog.find((f) => f.id === Number(r.account_id));
    const baru = katalog.find((f) => f.id === h.id);
    const sekotaSejenis = lama && baru && lama.jenis.has("PRIBADI")
      && [...baru.jenis].some((j) => lama.jenis.has(j))
      && lama.kota_kata.join(" ") === baru.kota_kata.join(" ");
    if (sekotaSejenis) hitung.lama_pribadi++;
    else {
      hitung.lama_beda++;
      ganti.push([Number(r.id), Number(r.account_id), h.id]);
    }
  } else hitung.lama_tak_yakin++;
}

// Lembar tinjauan per NAMA (bukan per baris) — itu yang diperiksa manusia.
const perNama = new Map();
for (const r of baris) {
  const k = r.customer_name;
  const e = perNama.get(k) ?? { n: 0, lama: new Set() };
  e.n++;
  if (r.nama_lama) e.lama.add(r.nama_lama);
  perNama.set(k, e);
}
for (const [nama, e] of perNama) {
  const h = hasilNama.get(nama);
  const hasil = h.kind === "one" ? `tier${h.tier}` : h.kind;
  const ke = h.kind === "one" ? h.nama : h.kind === "ambiguous" ? h.names.join(" / ") : "";
  tinjau.push([nama, e.n, hasil, ke, [...e.lama].join(" / ")]);
}

console.log(`== Tautkan kunjungan → faskes (${APPLY ? "APPLY" : "PRATINJAU"}${PERBAIKI ? " + perbaiki-lama" : ""}) ==`);
console.log(`  baris activity_log        : ${baris.length}`);
console.log(`  belum tertaut             : ${hitung.kosong}`);
console.log(`    → tertaut nama lengkap  : ${hitung.tertaut_t1}`);
console.log(`    → tertaut nama sebagian : ${hitung.tertaut_t2}`);
console.log(`    → ambigu (dibiarkan)    : ${hitung.ambigu}`);
console.log(`    → tak ada di Accurate   : ${hitung.tak_ketemu}`);
console.log(`  sudah tertaut             : ${hitung.lama_sama + hitung.lama_beda + hitung.lama_pribadi + hitung.lama_tak_yakin}`);
console.log(`    → sama dgn penaut baru  : ${hitung.lama_sama}`);
console.log(`    → BEDA (penaut baru yakin): ${hitung.lama_beda}${PERBAIKI ? "  ← akan diganti" : "  (pakai --perbaiki-lama untuk mengganti)"}`);
console.log(`    → akun pribadi di instansi sama: ${hitung.lama_pribadi}  (dibiarkan)`);
console.log(`    → penaut baru tak yakin : ${hitung.lama_tak_yakin}  (dibiarkan)`);
const contohBeda = new Map();
for (const [id, lama, baru] of ganti) {
  const r = baris.find((x) => Number(x.id) === id);
  const k = `${r.customer_name}`;
  if (!contohBeda.has(k)) contohBeda.set(k, `${r.nama_lama}  →  ${katalog.find((f) => f.id === baru)?.nama}`);
}
for (const [k, v] of [...contohBeda].slice(0, 30)) console.log(`      ${k}:  ${v}`);

if (CSV) {
  const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  writeFileSync(CSV, "﻿sep=;\n" + [["tulisan_am", "jumlah", "hasil", "faskes_baru", "tautan_lama"], ...tinjau.sort((a, b) => b[1] - a[1])]
    .map((r) => r.map(q).join(";")).join("\n"));
  console.log(`  lembar tinjauan → ${CSV}`);
}

if (APPLY) {
  const tulis = PERBAIKI ? [...isi, ...ganti] : isi;
  const pulih = `/tmp/tautkan-kunjungan-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  writeFileSync(pulih, "id;account_id_lama;account_id_baru\n" + tulis.map((r) => r.map((x) => x ?? "").join(";")).join("\n"));
  let n = 0;
  await sql.begin(async (tx) => {
    for (const [id, lama, baru] of tulis) {
      // Penjaga balapan: hanya bila nilainya masih seperti saat dibaca.
      const r = lama == null
        ? await tx`UPDATE activity_log SET account_id = ${baru} WHERE id = ${id} AND account_id IS NULL`
        : await tx`UPDATE activity_log SET account_id = ${baru} WHERE id = ${id} AND account_id = ${lama}`;
      n += r.count;
    }
  });
  console.log(`  DITULIS: ${n} baris · berkas pemulihan: ${pulih}`);
}
await sql.end();
