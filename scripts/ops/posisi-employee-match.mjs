#!/usr/bin/env node
// Tautkan posisi (migrasi 168) ↔ employee (migrasi 052) ke tabel posisi_employee
// (migrasi 170). DEFAULT DRY-RUN: tanpa --apply tidak ada yang ditulis.
//
// PAKAI:
//   pnpm --filter @wrg/api build                                  # skrip memakai dist/db.js
//   node scripts/ops/posisi-employee-match.mjs                    # pratinjau + tulis berkas tinjauan
//   node scripts/ops/posisi-employee-match.mjs --apply            # tulis tautan terbukti
//   node scripts/ops/posisi-employee-match.mjs --review ~/tinjau.csv
//
// SKRIP INI SENGAJA MENAUTKAN SEDIKIT. Ia hanya menulis tautan yang punya bukti
// keras, dan MENOLAK menebak sisanya. Yang tidak tertaut diekspor ke CSV
// tinjauan berisi kandidat + alasan kenapa tidak otomatis, untuk diputuskan
// HoD/PIC lalu dimasukkan sebagai sumber='manual'.
//
// TIGA TINGKAT YANG DITULIS OTOMATIS:
//   0. alias_jabatan        — frasa di `posisi_alias` (migrasi 171) muncul di
//      employee.role. Tabel itu berisi pernyataan SADAR dari orang bahwa suatu
//      frasa menamai jabatan tertentu ('account manager' = posisi 'AM'), untuk
//      kasus di mana form PIC dan roster memakai kata berbeda untuk jabatan yang
//      sama. Karena berdasar konfirmasi, tingkat ini MENGALAHKAN tingkat 2 saat
//      keduanya kena — lihat blok tie-break di bawah.
// DUA TINGKAT LAIN:
//   1. nama_di_catatan      — nama orangnya tertulis di posisi.catatan. Cocok
//      kalau `panggilan` muncul sebagai kata utuh, ATAU ≥2 kata dari nama
//      lengkap muncul. Ambang ≥2 kata dipakai supaya 'Muh Halim Prayogo' di
//      form tetap ketemu 'Muhammad Halim Prayogo' di roster, tanpa membuat satu
//      nama depan pasaran menyapu orang lain.
//   2. nama_posisi_di_role  — SELURUH kata posisi.nama muncul di employee.role,
//      DAN cuma satu posisi yang cocok untuk orang itu, DAN jumlah pengklaim
//      posisi itu ≤ jumlah_orang. Ketiganya wajib. Tanpa syarat kapasitas,
//      11 orang kirimtagih semuanya akan menempel ke posisi 'Kirim Tagih' yang
//      kapasitasnya 1 — karena teks 'merangkap Kirim-Tagih' di role mereka.
//
// KENAPA TIDAK ADA SKOR KEMIRIPAN: sudah dicoba dan ditolak. Skor IDF+token
// overlap atas data nyata memberi 'Account Manager (Marketing) — baru pindah
// dari Kirim-Tagih' → posisi 'Kirim Tagih' dengan skor 0,37 dan label "jelas";
// dan posisi HANTU 'Staff AR & CN (Account Receivable & Credit Note)' menang
// atas 'Staff AR & CN' yang asli (0,51 vs 0,31) semata karena namanya lebih
// panjang. Dua-duanya salah tanpa terlihat salah. Kalau nanti tergoda menambah
// fuzzy: baca ulang paragraf ini dulu.
//
// POSISI HANTU DIKECUALIKAN. 8 dari 31 baris `posisi` ber-jumlah_orang NULL —
// itu artefak: `touch()` di pic-form-to-json.py mendaftarkan tiap pelaku yang
// muncul di kolom "Posisi" sheet A/C, termasuk yang bukan jabatan sama sekali
// ('Keduanya (AP & BS)', 'HOD IVD (BD)') dan ejaan kembar dari jabatan yang
// sama ('Tax' vs 'Admin Tax'). Baris begitu tak boleh jadi kandidat tautan;
// perbaikannya membetulkan ejaan di xlsx lalu impor ulang, bukan menautkannya.
//
// SIFAT --apply (idempoten, dan TIDAK merusak kerja orang):
//   • hanya baris ber-sumber 'nama_di_catatan'/'nama_posisi_di_role' yang
//     dihapus lalu ditulis ulang;
//   • baris ber-sumber 'manual' TIDAK PERNAH DISENTUH. Pola sama dengan
//     `pemilik_alat`/`account_id` di kso-asset-import.mjs: begitu ada kolom yang
//     diisi manusia, impor ulang tak boleh menghapusnya.

import { writeFileSync } from "node:fs";
import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
const rIdx = process.argv.indexOf("--review");
const REVIEW = rIdx > -1 ? process.argv[rIdx + 1] : `${process.env.HOME}/posisi-employee-tinjauan.csv`;

const SKRIP = ["nama_di_catatan", "nama_posisi_di_role", "alias_jabatan"];

// staf/staff & adm/admin adalah varian ejaan yang sama, bukan jabatan berbeda.
const SINONIM = { staf: "staff", adm: "admin", administrasi: "admin" };

// TIDAK ADA DAFTAR STOPWORD, dan itu keputusan sadar. Versi pertama skrip ini
// membuang kata wilayah/riwayat ('area', 'cabang', 'station', 'merangkap', 'eks'…)
// dengan maksud membersihkan employee.role. Efeknya justru merusak sisi POSISI:
// nama posisi 'Admin Cabang' menyusut jadi {admin}, sehingga SIAPA PUN yang
// rolenya memuat kata 'Admin' dianggap memuat posisi itu — orang finance
// ('Admin Finance — Credit Note') dan penawaran ('Admin Marketing') ikut
// mengklaim Admin Cabang, dan pengklaimnya melonjak jadi 13 untuk kapasitas 8.
//
// Uji containment bersifat ASIMETRIS: `kata(posisi) ⊆ kata(role)`. Token
// berlebih di sisi role TIDAK PERNAH mengganggu, jadi tak ada gunanya
// membersihkan role — sementara membersihkan posisi selalu melemahkan syaratnya.
// Karena itu semua kata dipertahankan; hanya varian ejaan yang disatukan.
const kata = (s) => (s || "").toLowerCase().replace(/[^a-z0-9&\s]/g, " ").split(/\s+/)
  .map((t) => SINONIM[t] || t).filter((t) => t && t.length > 1);

const csvCell = (v) => {
  const s = v == null ? "" : String(v).replace(/\r?\n/g, " ");
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const sql = db();
try {
  const [{ ada }] = await sql`
    SELECT count(*)::int AS ada FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('posisi','employee','posisi_employee','posisi_alias','employee_posisi_gap')`;
  if (ada < 5) {
    console.error(`TOLAK: baru ${ada}/5 tabel ada. Terapkan migrasi 168, 170, 171 & 172 dulu.`);
    process.exit(1);
  }

  const posisi = await sql`
    SELECT p.id, p.divisi_key, p.nama, p.jumlah_orang, p.catatan
      FROM posisi p ORDER BY p.divisi_key, p.seq`;
  const employee = await sql`
    SELECT e.id, e.nama, e.panggilan, e.dept, e.role, e.cabang FROM employee e ORDER BY e.id`;
  const petaDept = await sql`SELECT divisi_key, dept FROM divisi_department`;
  const alias = await sql`SELECT divisi_key, posisi_nama, alias, dept, catatan FROM posisi_alias`;

  const deptDivisi = {};
  for (const r of petaDept) (deptDivisi[r.divisi_key] ??= []).push(r.dept);
  const bolehIsi = (e, p) => (deptDivisi[p.divisi_key] || []).includes(e.dept);
  const hantu = (p) => p.jumlah_orang == null;
  const nyata = posisi.filter((p) => !hantu(p));

  // posisi_alias TIDAK ber-FK ke posisi (migrasi 171 jalan saat posisi masih
  // kosong di DB bersih). Konsekuensinya alias bisa menunjuk posisi yang tak
  // ada — mis. setelah ejaan di xlsx dibetulkan. Dilaporkan, bukan didiamkan:
  // alias yatim tidak pernah cocok apa pun, jadi gejalanya "tautan hilang tanpa
  // sebab" kalau tak diberitahu.
  const kunciNyata = new Set(nyata.map((p) => `${p.divisi_key}|${p.nama}`));
  const aliasYatim = alias.filter((a) => !kunciNyata.has(`${a.divisi_key}|${a.posisi_nama}`));

  // ---- TINGKAT 1: nama orang di posisi.catatan ----------------------------
  const tautan = new Map();   // "posisi_id|employee_id" -> {posisi, emp, sumber, catatan}
  const tambah = (p, e, sumber, catatan) => {
    const k = `${p.id}|${e.id}`;
    if (!tautan.has(k)) tautan.set(k, { p, e, sumber, catatan });
  };

  for (const p of nyata) {
    if (!p.catatan) continue;
    const cn = ` ${p.catatan.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
    const utuh = (w) => cn.includes(` ${w} `);
    for (const e of employee) {
      if (!bolehIsi(e, p)) continue;
      const pang = (e.panggilan || "").toLowerCase();
      const bagian = (e.nama || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/).filter((x) => x.length > 2);
      const kenaPang = pang.length > 2 && utuh(pang);
      const kenaNama = bagian.filter(utuh).length >= 2;
      if (kenaPang || kenaNama) {
        tambah(p, e, "nama_di_catatan",
          kenaNama ? "≥2 kata nama lengkap ada di posisi.catatan" : "panggilan ada di posisi.catatan");
      }
    }
  }

  // ---- TINGKAT 2: nama posisi (atau alias-nya) termuat di employee.role ----
  const muat = (role, frasa) => {
    const R = new Set(kata(role)), P = kata(frasa);
    return P.length > 0 && P.every((t) => R.has(t));
  };
  const aliasPosisi = new Map();    // "divisi|nama" -> [{alias, dept}]
  for (const a of alias) {
    const k = `${a.divisi_key}|${a.posisi_nama}`;
    if (!aliasPosisi.has(k)) aliasPosisi.set(k, []);
    aliasPosisi.get(k).push({ alias: a.alias, dept: a.dept });
  }
  // `dept` pada alias membatasi ke satu dept roster. Tanpa itu alias berupa kata
  // umum menyapu orang yang cuma MENYEBUT jabatan itu, bukan memegangnya —
  // alias 'fakturis' kena role "Finance — Pengelola Piutang (atasan Fakturis &
  // Petty Cash)", pengklaim jadi 3 utk kapasitas 2, dan syarat kapasitas lalu
  // menolak ketiganya sehingga 2 Fakturis asli ikut hangus.
  const aliasBerlaku = (a, e) => !a.dept || a.dept === e.dept;

  // Semua kecocokan mentah dulu, BELUM diputuskan.
  const cocokPerOrang = new Map();  // employee_id -> [{p, alias}]  alias=null → containment langsung
  for (const e of employee) {
    for (const p of nyata) {
      if (!bolehIsi(e, p)) continue;
      const daftarAlias = aliasPosisi.get(`${p.divisi_key}|${p.nama}`) || [];
      const aliasKena = daftarAlias.find((a) => aliasBerlaku(a, e) && muat(e.role, a.alias)) || null;
      if (!aliasKena && !muat(e.role, p.nama)) continue;
      if (!cocokPerOrang.has(e.id)) cocokPerOrang.set(e.id, []);
      cocokPerOrang.get(e.id).push({ p, alias: aliasKena ? aliasKena.alias : null });
    }
  }

  // BUKTI YANG DIKONFIRMASI ORANG MENGALAHKAN CONTAINMENT KEBETULAN.
  // Baris posisi_alias adalah pernyataan sadar bahwa frasa itu menamai jabatan
  // tersebut; containment token cuma kebetulan kata-katanya muncul. Contoh nyata
  // yang menuntut aturan ini: role 'Account Manager (Marketing) — baru pindah
  // dari Kirim-Tagih' cocok ke posisi 'Kirim Tagih' lewat containment (kata
  // 'kirim'+'tagih' ada di keterangan RIWAYAT-nya) DAN ke 'AM' lewat alias
  // 'account manager'. Tanpa aturan ini orangnya ditolak sebagai ambigu; dengan
  // aturan ini ia jatuh ke AM — yang memang jabatannya.
  // Ambigu hanya kalau DUA alias berbeda sama-sama kena.
  const pilihan = new Map();        // employee_id -> {p, alias}
  const alasanTolak = new Map();    // employee_id -> alasan
  for (const e of employee) {
    const semuaCocok = cocokPerOrang.get(e.id) || [];
    if (semuaCocok.length === 0) {
      alasanTolak.set(e.id, "nama posisi (atau alias-nya) tidak termuat di role");
      continue;
    }
    const lewatAlias = semuaCocok.filter((c) => c.alias);
    const kandidat = lewatAlias.length ? lewatAlias : semuaCocok;
    if (kandidat.length > 1) {
      alasanTolak.set(e.id, lewatAlias.length
        ? `role cocok ${kandidat.length} alias posisi: ${kandidat.map((c) => `${c.p.nama} (via '${c.alias}')`).join(" / ")}`
        : `role memuat ${kandidat.length} nama posisi: ${kandidat.map((c) => c.p.nama).join(" / ")}`);
      continue;
    }
    pilihan.set(e.id, kandidat[0]);
  }

  // Kapasitas dihitung dari PILIHAN yang sudah diresolusi, bukan dari kecocokan
  // mentah. Kalau dihitung dari yang mentah, posisi yang kalah tie-break tetap
  // terhitung punya pengklaim dan ikut melampaui kapasitas tanpa alasan.
  const klaim = new Map();          // posisi_id -> [employee]
  for (const [empId, c] of pilihan) {
    if (!klaim.has(c.p.id)) klaim.set(c.p.id, []);
    klaim.get(c.p.id).push(empId);
  }
  for (const [empId, c] of pilihan) {
    const n = (klaim.get(c.p.id) || []).length;
    if (n > c.p.jumlah_orang) {
      alasanTolak.set(empId, `kapasitas '${c.p.nama}' ${c.p.jumlah_orang} tapi ${n} orang cocok`);
      continue;
    }
    const e = employee.find((x) => x.id === empId);
    if (c.alias) {
      tambah(c.p, e, "alias_jabatan",
        `alias '${c.alias}' (posisi_alias) ada di role; pengklaim ${n} ≤ kapasitas ${c.p.jumlah_orang}`);
    } else {
      tambah(c.p, e, "nama_posisi_di_role",
        `seluruh kata '${c.p.nama}' ada di role; pengklaim ${n} ≤ kapasitas ${c.p.jumlah_orang}`);
    }
  }

  const semua = [...tautan.values()];
  const orangTertaut = new Set(semua.map((t) => t.e.id));
  const belum = employee.filter((e) => !orangTertaut.has(e.id));

  // ---- tulis ---------------------------------------------------------------
  let hapus = 0;
  if (APPLY) {
    await sql.begin(async (tx) => {
      const del = await tx`DELETE FROM posisi_employee WHERE sumber = ANY(${SKRIP})`;
      hapus = del.count;
      if (semua.length) {
        await tx`INSERT INTO posisi_employee ${tx(semua.map((t) => ({
          posisi_id: t.p.id, employee_id: t.e.id, sumber: t.sumber, catatan: t.catatan,
        })))}`;
      }

      // employee_posisi_gap (migrasi 172) diganti TOTAL, bukan di-upsert:
      // begitu seseorang akhirnya tertaut, barisnya harus HILANG. Upsert akan
      // meninggalkan alasan basi yang tetap tampil di UI padahal sudah beres —
      // dan itu jenis kesalahan yang tak berisik.
      //
      // Alasannya dipersist di sini, bukan dihitung ulang sebagai view, supaya
      // logika pencocokan cuma punya SATU tempat (lihat komentar migrasi 172).
      await tx`DELETE FROM employee_posisi_gap`;
      if (belum.length) {
        await tx`INSERT INTO employee_posisi_gap ${tx(belum.map((e) => ({
          employee_id: e.id,
          alasan: alasanTolak.get(e.id) ?? "tak diketahui",
          kandidat: nyata.filter((p) => bolehIsi(e, p))
            .map((p) => `${p.nama} (kap ${p.jumlah_orang})`).join(" | ") || null,
        })))}`;
      }
    });
  }

  // ---- laporan -------------------------------------------------------------
  console.log(APPLY
    ? "MODE: --apply (ditulis; baris sumber='manual' tidak disentuh)\n"
    : "MODE: pratinjau — tidak ada yang ditulis\n");

  console.log(`TAUTAN TERBUKTI: ${semua.length} baris / ${orangTertaut.size} orang (dari ${employee.length} karyawan)`);
  const perSumber = {};
  for (const t of semua) perSumber[t.sumber] = (perSumber[t.sumber] || 0) + 1;
  for (const [k, v] of Object.entries(perSumber)) console.log(`   ${String(v).padStart(4)}  ${k}`);
  console.log();
  for (const t of semua.sort((a, b) => a.p.divisi_key.localeCompare(b.p.divisi_key) || a.p.nama.localeCompare(b.p.nama))) {
    console.log(`   ${t.p.divisi_key.padEnd(12)} ${t.p.nama.slice(0, 36).padEnd(37)} ← ${t.e.id.padEnd(11)} ${(t.e.nama || "").slice(0, 24).padEnd(25)} [${t.sumber}]`);
  }

  console.log(`\nBELUM TERTAUT: ${belum.length} karyawan → butuh keputusan orang`);
  const perDept = {};
  for (const e of belum) (perDept[e.dept] ??= []).push(e);
  // Alasan ditampilkan per NILAI UNIK, bukan alasan orang pertama di dept itu —
  // satu dept sering punya beberapa alasan berbeda dan mengambil yang pertama
  // membuat laporan ini terlihat seragam padahal tidak.
  for (const [d, list] of Object.entries(perDept).sort((a, b) => b[1].length - a[1].length)) {
    const rekap = {};
    for (const e of list) {
      const a = alasanTolak.get(e.id) || "-";
      rekap[a] = (rekap[a] || 0) + 1;
    }
    console.log(`   ${String(list.length).padStart(3)}  ${d}`);
    for (const [a, n] of Object.entries(rekap).sort((x, y) => y[1] - x[1])) {
      console.log(`        ${String(n).padStart(3)}× ${a}`);
    }
  }

  if (aliasYatim.length) {
    console.log(`\n⚠ ALIAS YATIM (posisi_alias menunjuk posisi yang tak ada — tak akan pernah cocok): ${aliasYatim.length}`);
    for (const a of aliasYatim) console.log(`   ${a.divisi_key} | ${a.posisi_nama} ← '${a.alias}'`);
  }

  const barisHantu = posisi.filter(hantu);
  if (barisHantu.length) {
    console.log(`\nPOSISI HANTU (jumlah_orang NULL, dikecualikan dari kandidat): ${barisHantu.length}`);
    for (const p of barisHantu) console.log(`   ${p.divisi_key.padEnd(12)} ${p.nama}`);
  }

  const gap = await sql`SELECT * FROM v_posisi_employee_gap`;
  console.log("\n== v_posisi_employee_gap ==");
  for (const g of gap) {
    console.log(`   ${g.divisi.padEnd(23)} posisi=${String(g.posisi_total).padStart(2)}(${g.posisi_tanpa_jumlah} hantu)` +
      ` kapasitas=${String(g.kapasitas_form).padStart(2)} kandidat=${String(g.karyawan_kandidat).padStart(2)}` +
      ` tertaut=${String(g.karyawan_tertaut).padStart(2)}` +
      ` (${g.pct_tertaut == null ? "—" : g.pct_tertaut + "%"})`);
  }

  // ---- berkas tinjauan -----------------------------------------------------
  const baris = [["employee_id", "nama", "panggilan", "dept", "cabang", "role",
    "alasan_tidak_otomatis", "kandidat_posisi_divisi", "kandidat_posisi"]];
  for (const e of belum) {
    const kand = nyata.filter((p) => bolehIsi(e, p));
    baris.push([e.id, e.nama, e.panggilan, e.dept, e.cabang, e.role,
      alasanTolak.get(e.id) || "-",
      [...new Set(kand.map((p) => p.divisi_key))].join(" | "),
      kand.map((p) => `${p.nama} (kap ${p.jumlah_orang})`).join(" | ")]);
  }
  // sep=, + BOM UTF-8 → Excel lokal apa pun membukanya mulus (pola export dashboard)
  writeFileSync(REVIEW, "﻿sep=,\n" + baris.map((r) => r.map(csvCell).join(",")).join("\n") + "\n", "utf8");
  console.log(`\nberkas tinjauan → ${REVIEW}  (${belum.length} baris)`);

  if (APPLY) {
    console.log(`\nbaris skrip yang diganti: ${hapus} → ${semua.length}. Baris 'manual' tidak disentuh.`);
    console.log("SELESAI.");
  } else {
    console.log("\nTidak ada yang ditulis. Ulangi dengan --apply.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
