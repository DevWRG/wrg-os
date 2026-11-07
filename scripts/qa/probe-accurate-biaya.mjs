#!/usr/bin/env node
// Probe READ-ONLY untuk F150 (biaya operasional vs revenue netto per area).
//
// Mirror Accurate wrg-os tidak punya data biaya/jurnal sama sekali. Probe ini
// menjawab: dari endpoint Accurate mana biaya per area (cabang/departemen/proyek)
// bisa ditarik, dan field apa yang membawa dimensi area itu.
//
// Kandidat sumber:
//   glaccount        — bagan akun; akun bertipe beban (EXPENSE / OTHER_EXPENSE / COGS)
//   other-payment    — pengeluaran/biaya kas-bank (detailExpense: akun, jumlah, dept, proyek)
//   journal-voucher  — jurnal umum (detailJournalVoucher: akun, debit/kredit, dept, proyek)
//   purchase-invoice — faktur pembelian (biaya vendor)
//   department / project — dimensi biaya (calon "area")
//   branch           — cabang Accurate (dimensi bawaan di header transaksi)
//
// SEMUA GET. Tak ada request yang menulis ke Accurate. Token tak pernah dicetak.
// Yang tampil: nama field, jumlah baris, sebaran dimensi, dan 2-3 contoh baris
// (nomor, tanggal, nominal, akun) — tanpa token/rahasia.
//
// Jalankan di mesin berkredensial prod (Mac mini):
//   node scripts/qa/probe-accurate-biaya.mjs > hasil-probe-f150.txt 2>&1
//   node scripts/qa/probe-accurate-biaya.mjs --from=01/07/2026 --to=31/10/2026
//
// Format tanggal Accurate: dd/MM/yyyy.

import { loadCreds, accGet, isOk, failMessage, describe } from "./lib/accurate.mjs";

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const FROM = arg("from", "01/07/2026");
const TO = arg("to", "31/10/2026");

const creds = loadCreds();
if (creds.err) {
  console.error(`✗ ${creds.err}`);
  console.error("  Jalankan skrip ini di mesin yang punya kredensial prod (Mac mini).");
  process.exit(2);
}
console.log(`host       : ${creds.host}`);
console.log(`kredensial : ${creds.from === "env" ? "env ACCURATE_ACCESS_TOKEN/SIGNATURE_SECRET" : creds.from}`);
console.log(`periode    : ${FROM} s/d ${TO}`);
console.log("mode       : READ-ONLY (GET saja)\n");

function verdict(r) {
  if (isOk(r)) return "OK";
  if (r.body?._nonJson) return `HTML/non-JSON (path tak dikenal?) HTTP ${r.httpStatus}`;
  return `GAGAL HTTP ${r.httpStatus}: ${failMessage(r.body) ?? "?"}`;
}

// Retry ringan hanya untuk kegagalan transport (HTTP 0).
async function get(path, qs) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await accGet(creds, path, qs);
    if (r.httpStatus !== 0) return r;
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
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
const show = (label, entries, max = 12) => {
  console.log(`   ${label}:`);
  for (const [k, v] of entries.slice(0, max)) console.log(`     ${String(k).padEnd(34)} ${v}`);
  if (entries.length > max) console.log(`     … ${entries.length - max} nilai lain`);
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const keysOf = (o) => (o && typeof o === "object" ? Object.keys(o).join(", ") : "-");

// ── 1. Bagan akun: akun bertipe beban ──────────────────────────────────────
console.log("── (1) glaccount/list.do");
const gl = await get("/accurate/api/glaccount/list.do", "sp.page=1&sp.pageSize=200&fields=id,no,name,accountType,accountTypeName,parentId,lvl");
console.log(`   ${verdict(gl)}`);
let expenseAccts = [];
if (isOk(gl)) {
  const rows = gl.body?.d ?? [];
  console.log(`   rowCount ${gl.body?.sp?.rowCount ?? "?"} · ${describe(rows)}`);
  show("accountType", tally((r) => r.accountType ?? r.accountTypeName ?? "(absen)", rows));
  expenseAccts = rows.filter((r) => /EXPENSE|COGS|BEBAN|BIAYA/i.test(`${r.accountType ?? ""} ${r.accountTypeName ?? ""}`));
  console.log(`   akun beban terdeteksi (halaman 1): ${expenseAccts.length}`);
  for (const r of expenseAccts.slice(0, 8)) console.log(`     ${r.no} · ${r.name} · ${r.accountType}`);
}
console.log();

// ── 2. Dimensi biaya: department, project, branch ──────────────────────────
for (const [label, path] of [
  ["department", "/accurate/api/department/list.do"],
  ["project", "/accurate/api/project/list.do"],
  ["branch", "/accurate/api/branch/list.do"],
]) {
  console.log(`── (2) ${label}  ${path}`);
  const r = await get(path, "sp.page=1&sp.pageSize=100");
  console.log(`   ${verdict(r)}`);
  if (isOk(r)) {
    const rows = r.body?.d ?? [];
    console.log(`   rowCount ${r.body?.sp?.rowCount ?? "?"} · ${describe(rows)}`);
    console.log(`   nama: ${rows.slice(0, 25).map((x) => x.name ?? x.description ?? x.id).join(" | ")}`);
  }
  console.log();
}

// ── 3. Transaksi biaya: other-payment, journal-voucher, purchase-invoice ───
async function probeTx(label, path, detailPath, detailKeys) {
  console.log(`── (3) ${label}  ${path}`);
  const filter = `filter.transDate.op=BETWEEN&filter.transDate.val[0]=${FROM}&filter.transDate.val[1]=${TO}`;
  const r = await get(path, `sp.page=1&sp.pageSize=100&${filter}`);
  console.log(`   ${verdict(r)}`);
  if (!isOk(r)) {
    console.log();
    return;
  }
  const rows = r.body?.d ?? [];
  console.log(`   rowCount periode ${r.body?.sp?.rowCount ?? "?"} · kunci list: ${keysOf(rows[0])}`);
  if (!rows.length) {
    console.log();
    return;
  }
  // Detail 1 baris: lihat dimensi (dept/proyek/cabang) di baris detail.
  const d = await get(detailPath, `id=${rows[0].id}`);
  console.log(`   detail id=${rows[0].id}: ${verdict(d)}`);
  if (isOk(d) && d.body?.d) {
    const doc = d.body.d;
    console.log(`   kunci header detail: ${keysOf(doc)}`);
    for (const k of detailKeys) {
      const arr = doc[k];
      if (Array.isArray(arr)) {
        console.log(`   ${k}[${arr.length}] kunci baris: ${keysOf(arr[0])}`);
        const s = arr[0] ?? {};
        console.log(
          `     contoh: akun=${s.accountNo ?? s.account?.no ?? "?"} · ${s.accountName ?? s.account?.name ?? s.memo ?? ""} · jumlah=${s.amount ?? s.debit ?? s.credit ?? s.totalPrice ?? "?"} · dept=${s.department?.name ?? s.departmentName ?? "-"} · proyek=${s.project?.name ?? s.projectNo ?? "-"}`,
        );
      }
    }
    console.log(`   cabang header: ${doc.branchName ?? doc.branch?.name ?? "(absen)"} · tgl: ${doc.transDate ?? "?"} · total: ${doc.totalAmount ?? doc.amount ?? doc.totalExpense ?? "?"}`);
  }
  const tot = rows.reduce((s, x) => s + num(x.totalAmount ?? x.amount ?? x.totalExpense ?? x.debit), 0);
  console.log(`   Σ nominal 100 baris pertama (kasar): ${Math.round(tot).toLocaleString("id-ID")}`);
  console.log();
}
await probeTx("other-payment", "/accurate/api/other-payment/list.do", "/accurate/api/other-payment/detail.do", ["detailExpense", "detailAccount"]);
await probeTx("journal-voucher", "/accurate/api/journal-voucher/list.do", "/accurate/api/journal-voucher/detail.do", ["detailJournalVoucher"]);
await probeTx("purchase-invoice", "/accurate/api/purchase-invoice/list.do", "/accurate/api/purchase-invoice/detail.do", ["detailItem", "detailExpense"]);

// ── 4. Laporan buku besar / laba rugi (jika ada) ───────────────────────────
console.log("── (4) laporan / saldo akun beban");
const bal = expenseAccts[0]
  ? await get("/accurate/api/glaccount/get-balance.do", `id=${expenseAccts[0].id}&asOfDate=${TO}`)
  : null;
console.log(`   glaccount/get-balance.do: ${bal ? verdict(bal) : "(lewati — tak ada akun beban terdeteksi)"}`);
if (bal && isOk(bal)) console.log(`   ${describe(bal.body?.d)}`);
console.log("   (laporan laba-rugi per departemen/proyek tidak ada di API list; sering hanya via menu Laporan Accurate)");

console.log("\nSelesai. Output ini aman dibagikan (tanpa token); dasar desain puller biaya F150.");
