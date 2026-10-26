#!/usr/bin/env node
// Probe READ-ONLY #2 untuk F150 (biaya operasional vs revenue netto per area).
//
// Menindaklanjuti hasil probe #1 (probe-accurate-biaya.mjs), yang menemukan:
//   - bagan akun cuma terbaca 100 dari 162 akun (halaman 1) → "akun beban: 0" semu;
//   - department & project KOSONG, branch cuma "Kantor Pusat" → tak ada dimensi area bawaan.
// Probe ini menjawab dua hal:
//   1. Akun mana yang beban / HPP (semua halaman bagan akun, bukan 100 pertama)?
//   2. Adakah dimensi LAIN yang membawa "area": klasifikasi data (dataClassification1..10), cabang di
//      header, payee/karyawan, atau teks memo — dan seberapa konsisten diisi?
// Plus sebaran jumlah transaksi per bulan (bahan menimbang beban tarik).
//
// SEMUA GET. Tak ada request yang menulis. Token tak dicetak. Yang tampil: NAMA akun/dimensi, hitungan,
// dan cuplikan memo — TANPA nominal. Tetap kirim hasilnya ke tim secara privat, jangan ke GitHub
// (memo bisa memuat nama orang/vendor).
//
//   node scripts/qa/probe-accurate-biaya-2.mjs > hasil-probe-f150-2.txt 2>&1
//   node scripts/qa/probe-accurate-biaya-2.mjs --from=01/07/2026 --to=31/10/2026 --sample=60
//
// Format tanggal Accurate: dd/MM/yyyy.

import { loadCreds, accGet, isOk, failMessage, fetchAllPages } from "./lib/accurate.mjs";

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const FROM = arg("from", "01/07/2026");
const TO = arg("to", "31/10/2026");
const SAMPLE = Math.min(Math.max(Number(arg("sample", "60")) || 60, 10), 150);

const creds = loadCreds();
if (creds.err) {
  console.error(`✗ ${creds.err}`);
  console.error("  Jalankan skrip ini di mesin yang punya kredensial prod (Mac mini).");
  process.exit(2);
}
console.log(`host       : ${creds.host}`);
console.log(`periode    : ${FROM} s/d ${TO} · sampel detail ${SAMPLE}/jenis`);
console.log("mode       : READ-ONLY (GET saja)\n");

const verdict = (r) => (isOk(r) ? "OK" : r.body?._nonJson ? `HTML/non-JSON (path tak dikenal?) HTTP ${r.httpStatus}` : `GAGAL HTTP ${r.httpStatus}: ${failMessage(r.body) ?? "?"}`);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function get(path, qs) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await accGet(creds, path, qs);
    if (r.httpStatus !== 0) return r;
    await sleep(1500 * (i + 1));
  }
  return r;
}
const tally = (fn, rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const show = (label, entries, max = 15) => {
  console.log(`   ${label}:`);
  for (const [k, v] of entries.slice(0, max)) console.log(`     ${String(k).slice(0, 60).padEnd(60)} ${v}`);
  if (entries.length > max) console.log(`     … ${entries.length - max} nilai lain`);
};
const filled = (v) => v != null && v !== "" && !(typeof v === "object" && !Object.keys(v).length);
const nameOf = (v) => (v && typeof v === "object" ? v.name ?? v.no ?? v.id ?? "?" : v);

// ── 1. Bagan akun LENGKAP ──────────────────────────────────────────────────
console.log("── (1) glaccount/list.do — SEMUA halaman");
const gl = await fetchAllPages(creds, "/accurate/api/glaccount/list.do", "fields=id,no,name,accountType,accountTypeName,parentId,lvl");
console.log(`   ${gl.rows ? "OK" : verdict(gl)} · terkumpul ${gl.rows?.length ?? 0} dari rowCount ${gl.rowCount ?? "?"} · halaman ${gl.pages}${gl.capped ? " · TERPOTONG MAX_PAGES" : ""}`);
const akun = gl.rows ?? [];
const byNo = new Map(akun.map((a) => [String(a.no), a]));
show("accountType", tally((r) => r.accountType ?? r.accountTypeName ?? "(absen)", akun), 40);
const BEBAN = /EXPENSE|COST|COGS|BEBAN|BIAYA/i;
const beban = akun.filter((r) => BEBAN.test(`${r.accountType ?? ""} ${r.accountTypeName ?? ""}`) || /^[5-9]/.test(String(r.no ?? "")));
console.log(`   akun beban/HPP terdeteksi (tipe EXPENSE/COST/COGS atau nomor berawalan 5-9): ${beban.length}`);
for (const r of beban.slice(0, 200)) console.log(`     ${String(r.no).padEnd(12)} ${String(r.name).slice(0, 55).padEnd(55)} ${r.accountType}`);
console.log();

// ── 2. Dimensi lain yang mungkin ada ───────────────────────────────────────
for (const [label, path] of [
  ["branch (ulang)", "/accurate/api/branch/list.do"],
  ["data-classification", "/accurate/api/data-classification/list.do"],
  ["data-classification-1", "/accurate/api/data-classification-1/list.do"],
  ["employee", "/accurate/api/employee/list.do"],
]) {
  console.log(`── (2) ${label}  ${path}`);
  const r = await get(path, "sp.page=1&sp.pageSize=100");
  console.log(`   ${verdict(r)}`);
  if (isOk(r)) {
    const rows = r.body?.d ?? [];
    console.log(`   rowCount ${r.body?.sp?.rowCount ?? "?"}`);
    if (label !== "employee") console.log(`   nama: ${rows.slice(0, 30).map((x) => x.name ?? x.description ?? x.id).join(" | ")}`);
  }
  console.log();
}

// ── 3. Volume other-payment per bulan + sampel detail ──────────────────────
const filter = `filter.transDate.op=BETWEEN&filter.transDate.val[0]=${FROM}&filter.transDate.val[1]=${TO}`;
console.log("── (3) other-payment: volume per bulan");
const op = await fetchAllPages(creds, "/accurate/api/other-payment/list.do", `fields=id,transDate&${filter}`);
console.log(`   ${op.rows ? "OK" : verdict(op)} · terkumpul ${op.rows?.length ?? 0} dari rowCount ${op.rowCount ?? "?"}${op.capped ? " · TERPOTONG MAX_PAGES" : ""}`);
const opRows = op.rows ?? [];
show("transaksi per bulan (mm/yyyy)", tally((r) => String(r.transDate ?? "?").slice(3), opRows).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), 12);

function sampleIds(rows, n) {
  if (rows.length <= n) return rows.map((r) => r.id);
  const out = [];
  for (let i = 0; i < n; i++) out.push(rows[Math.floor((i * rows.length) / n)].id);
  return out;
}

async function detailAll(path, ids) {
  const docs = [];
  for (const id of ids) {
    const r = await get(path, `id=${id}`);
    if (isOk(r) && r.body?.d) docs.push(r.body.d);
    await sleep(250);
  }
  return docs;
}

const KW = /dinas|perjalanan|bbm|bensin|tol\b|parkir|hotel|akomodasi|tiket|transport|travel|uang jalan|makan/i;
const classKeys = Array.from({ length: 10 }, (_, i) => `dataClassification${i + 1}`);

console.log("\n── (3b) other-payment: dimensi per baris biaya (sampel)");
const opDocs = await detailAll("/accurate/api/other-payment/detail.do", sampleIds(opRows, SAMPLE));
console.log(`   sampel terbaca: ${opDocs.length}`);
if (opDocs.length) {
  const lines = opDocs.flatMap((d) => (Array.isArray(d.detailAccount) ? d.detailAccount.map((l) => ({ d, l })) : []));
  console.log(`   baris biaya (detailAccount) di sampel: ${lines.length}`);
  show("header: branchId", tally((x) => x.d.branchId ?? "(kosong)", opDocs));
  show("header: payee terisi?", tally((x) => (filled(x.payee) ? "ya" : "tidak"), opDocs));
  show("header: description terisi?", tally((x) => (filled(x.description) ? "ya" : "tidak"), opDocs));
  show("baris: departemen terisi?", tally((x) => (filled(x.l.departmentId) ? "ya" : "tidak"), lines));
  show("baris: proyek terisi?", tally((x) => (filled(x.l.projectId) ? "ya" : "tidak"), lines));
  show("baris: memo terisi?", tally((x) => (filled(x.l.memo) || filled(x.l.detailName) ? "ya" : "tidak"), lines));
  for (const k of classKeys) {
    const isi = lines.filter((x) => filled(x.l[k]));
    if (isi.length) {
      console.log(`   ${k} TERISI di ${isi.length}/${lines.length} baris. nilai:`);
      for (const [v, n] of tally((x) => nameOf(x.l[k]), isi).slice(0, 12)) console.log(`     ${String(v).slice(0, 50).padEnd(50)} ${n}`);
    }
  }
  // akun apa yang dipakai (nomor + nama + tipe dari bagan), tanpa nominal
  const noAkun = (l) => String(l.account?.no ?? l.accountNo ?? "?");
  show("akun yang dipakai (nomor · nama)", tally((x) => `${noAkun(x.l)} · ${byNo.get(noAkun(x.l))?.name ?? nameOf(x.l.account) ?? "?"}`, lines), 30);
  // cuplikan memo berkata kunci perjalanan/transport (cuma teks, tanpa nominal)
  const memoKW = lines.filter((x) => KW.test(`${x.l.memo ?? ""} ${x.l.detailName ?? ""} ${x.d.description ?? ""}`));
  console.log(`   baris bermemo perjalanan/transport/BBM (kata kunci): ${memoKW.length}/${lines.length}`);
  for (const x of memoKW.slice(0, 12)) console.log(`     ${noAkun(x.l)} · ${String(x.l.memo ?? x.l.detailName ?? x.d.description).replace(/\s+/g, " ").slice(0, 80)}`);
}

// ── 4. journal-voucher: jenis & dimensi (sampel) ───────────────────────────
console.log("\n── (4) journal-voucher (sampel)");
const jvList = await get("/accurate/api/journal-voucher/list.do", `sp.page=1&sp.pageSize=100&fields=id,transDate&${filter}`);
console.log(`   ${verdict(jvList)} · rowCount periode ${jvList.body?.sp?.rowCount ?? "?"}`);
if (isOk(jvList)) {
  const jvDocs = await detailAll("/accurate/api/journal-voucher/detail.do", sampleIds(jvList.body.d ?? [], Math.min(SAMPLE, 40)));
  console.log(`   sampel terbaca: ${jvDocs.length}`);
  show("jenis transaksi (transactionTypeName)", tally((d) => d.transactionTypeName ?? "(absen)", jvDocs));
  const jl = jvDocs.flatMap((d) => (Array.isArray(d.detailJournalVoucher) ? d.detailJournalVoucher : []));
  console.log(`   baris jurnal di sampel: ${jl.length}`);
  show("baris: cabang terisi?", tally((l) => (filled(l.branchId) ? "ya" : "tidak"), jl));
  show("baris: departemen terisi?", tally((l) => (filled(l.departmentId) ? "ya" : "tidak"), jl));
  show("baris: karyawan terisi?", tally((l) => (filled(l.employee) ? "ya" : "tidak"), jl));
  for (const k of classKeys) {
    const isi = jl.filter((l) => filled(l[k]));
    if (isi.length) console.log(`   ${k} terisi di ${isi.length}/${jl.length} baris jurnal`);
  }
}

console.log("\nSelesai. Output TANPA nominal & token, tapi memuat cuplikan memo (bisa memuat nama orang/vendor) — kirim privat, bukan ke GitHub.");
