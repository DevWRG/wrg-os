#!/usr/bin/env node
// Probe READ-ONLY #3 untuk F150 (biaya operasional vs revenue netto per area).
//
// Menindaklanjuti probe #2 dan balasan Direktur (2026-10-27). Dua pertanyaan yang masih terbuka:
//   A. Jurnal PENYUSUTAN / AMORTISASI (akun 6200-04..07, 6200-24) dicatat lewat journal-voucher,
//      bukan Pembayaran Lain/Faktur Pembelian. journal-voucher/list.do tak bisa difilter per akun dan
//      ±11,6 rb jurnal/4 bulan sebagian besar otomatis (Pengiriman Pesanan, Faktur, dst).
//      → Jenis jurnal APA yang memuat akun itu, apa kata kunci deskripsinya, dan adakah cabang di baris?
//   B. NAMA FIELD Departemen di baris Pembayaran Lain & Faktur Pembelian. Probe #2 hanya melihat
//      "kosong"; puller membaca department / departmentName / departemen secara defensif. Probe ini
//      mencetak SEMUA kunci baris yang berbau departemen/cabang/proyek/klasifikasi supaya namanya pasti.
//
// SEMUA GET. Tak ada request yang menulis. Token tak dicetak. Yang tampil: nama akun/jenis, hitungan,
// nama kunci — TANPA nominal. Deskripsi jurnal bisa memuat nama orang/vendor: kirim hasilnya privat.
//
//   node scripts/qa/probe-accurate-biaya-3.mjs > hasil-probe-f150-3.txt 2>&1
//   node scripts/qa/probe-accurate-biaya-3.mjs --from=01/07/2026 --to=31/10/2026 --sample=40

import { loadCreds, accGet, isOk, failMessage, fetchAllPages } from "./lib/accurate.mjs";

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split("=")[1] : d;
};
const FROM = arg("from", "01/07/2026");
const TO = arg("to", "31/10/2026");
const SAMPLE = Math.min(Math.max(Number(arg("sample", "40")) || 40, 10), 100);
const AKUN_TARGET = /^6200-(04|05|06|07|24)/;
const KATA_KUNCI = /susut|depresi|amortis|penyusutan/i;
const KUNCI_DIMENSI = /depart|branch|cabang|project|proyek|classif|klasifikasi|employee|karyawan/i;

const creds = loadCreds();
if (creds.err) {
  console.error(`✗ ${creds.err}`);
  console.error("  Jalankan skrip ini di mesin yang punya kredensial prod (Mac mini).");
  process.exit(2);
}
console.log(`host       : ${creds.host}`);
console.log(`periode    : ${FROM} s/d ${TO} · sampel detail ${SAMPLE}`);
console.log("mode       : READ-ONLY (GET saja)\n");

const filter = `filter.transDate.op=BETWEEN&filter.transDate.val[0]=${FROM}&filter.transDate.val[1]=${TO}`;
const verdict = (r) => (isOk(r) ? "OK" : r.body?._nonJson ? `HTML/non-JSON HTTP ${r.httpStatus}` : `GAGAL HTTP ${r.httpStatus}: ${failMessage(r.body) ?? "?"}`);
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
async function detailAll(path, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 4) {
    const rs = await Promise.all(ids.slice(i, i + 4).map((id) => get(path, `id=${id}`)));
    for (const r of rs) if (isOk(r) && r.body?.d) out.push(r.body.d);
    await sleep(250);
  }
  return out;
}
const tally = (fn, rows) => {
  const m = new Map();
  for (const r of rows) m.set(fn(r), (m.get(fn(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const show = (label, entries, max = 15) => {
  console.log(`   ${label}:`);
  for (const [k, v] of entries.slice(0, max)) console.log(`     ${String(k).slice(0, 60).padEnd(60)} ${v}`);
  if (entries.length > max) console.log(`     … ${entries.length - max} nilai lain`);
};
const filled = (v) => v != null && v !== "" && !(typeof v === "object" && !Object.keys(v).length);
const kunciDimensi = (o) => Object.keys(o ?? {}).filter((k) => KUNCI_DIMENSI.test(k));

// ── A. journal-voucher: jenis & kandidat penyusutan ────────────────────────
console.log("── (A) journal-voucher: jenis jurnal + kandidat penyusutan/amortisasi");
// Satu bulan per sapuan: fetchAllPages berhenti di 5.000 baris, sedangkan ±11,6 rb jurnal/4 bulan.
const bulanBulan = (from, to) => {
  const [d1, m1, y1] = from.split("/").map(Number);
  const [d2, m2, y2] = to.split("/").map(Number);
  const out = [];
  for (let y = y1, m = m1; y < y2 || (y === y2 && m <= m2); m === 12 ? ((m = 1), y++) : m++) {
    const p = (n) => String(n).padStart(2, "0");
    const awal = y === y1 && m === m1 ? d1 : 1;
    const akhir = y === y2 && m === m2 ? d2 : new Date(y, m, 0).getDate();
    out.push([`${p(awal)}/${p(m)}/${y}`, `${p(akhir)}/${p(m)}/${y}`]);
  }
  return out;
};
const rows = [];
let terpotong = false;
let rowCountTotal = 0;
for (const [a, b] of bulanBulan(FROM, TO)) {
  const f = `filter.transDate.op=BETWEEN&filter.transDate.val[0]=${a}&filter.transDate.val[1]=${b}`;
  const jv = await fetchAllPages(creds, "/accurate/api/journal-voucher/list.do", `fields=id,transDate,transactionTypeName,description&${f}`);
  if (!jv.rows) { console.log(`   ${a}–${b}: ${verdict(jv)}`); continue; }
  rows.push(...jv.rows);
  rowCountTotal += jv.rowCount ?? jv.rows.length;
  if (jv.capped) { terpotong = true; console.log(`   ${a}–${b}: TERPOTONG batas halaman (${jv.rows.length}/${jv.rowCount})`); }
}
console.log(`   terkumpul ${rows.length} dari rowCount ${rowCountTotal}${terpotong ? " · ADA BULAN TERPOTONG (hasil tidak lengkap!)" : ""}`);
if (rows.length) {
  console.log(`   kunci baris list: ${Object.keys(rows[0]).join(", ")}`);
  show("jenis transaksi (transactionTypeName)", tally((r) => r.transactionTypeName ?? "(absen)", rows), 25);
  const cocok = rows.filter((r) => KATA_KUNCI.test(String(r.description ?? "")));
  console.log(`   jurnal berdeskripsi susut/depresi/amortisasi: ${cocok.length}`);
  show("  … menurut jenis", tally((r) => r.transactionTypeName ?? "(absen)", cocok));
  // Kandidat detail: yang deskripsinya cocok, ditambah jenis yang BUKAN otomatis (jarang) supaya terlihat.
  const jenisFrek = new Map(tally((r) => r.transactionTypeName ?? "(absen)", rows));
  const langka = rows.filter((r) => (jenisFrek.get(r.transactionTypeName ?? "(absen)") ?? 0) < 200 && !cocok.includes(r));
  const pilih = [...cocok.slice(0, SAMPLE), ...langka.slice(0, Math.max(0, SAMPLE - Math.min(cocok.length, SAMPLE)))].slice(0, SAMPLE);
  const docs = await detailAll("/accurate/api/journal-voucher/detail.do", pilih.map((r) => r.id));
  console.log(`   detail terbaca: ${docs.length}/${pilih.length}`);
  const lines = docs.flatMap((d) => (Array.isArray(d.detailJournalVoucher) ? d.detailJournalVoucher.map((l) => ({ d, l })) : []));
  const target = lines.filter(({ l }) => AKUN_TARGET.test(String(l.glAccount?.no ?? l.account?.no ?? "")));
  console.log(`   baris jurnal di sampel: ${lines.length} · menyentuh 6200-04..07/24: ${target.length}`);
  if (lines[0]) console.log(`   kunci baris jurnal: ${Object.keys(lines[0].l).join(", ")}`);
  if (target.length) {
    show("akun target", tally(({ l }) => `${l.glAccount?.no ?? l.account?.no} ${l.glAccount?.name ?? l.account?.name ?? ""}`, target));
    show("jenis jurnal pemuat akun target", tally(({ d }) => d.transactionTypeName ?? "(absen)", target));
    show("cabang di baris", tally(({ l }) => (filled(l.branchId) ? `terisi (${l.branchId})` : "kosong"), target));
    show("sisi (debit/kredit)", tally(({ l }) => l.amountType ?? l.type ?? "?", target));
    console.log(`   deskripsi header (cuplikan, maks 8): ${[...new Set(target.map(({ d }) => String(d.description ?? "").replace(/\s+/g, " ").slice(0, 60)))].slice(0, 8).join(" | ")}`);
  } else {
    console.log("   (tak ada baris akun target di sampel — perbesar --sample atau cek deskripsi jurnal di atas)");
  }
}

// ── B. nama field Departemen/cabang di baris biaya ─────────────────────────
for (const [nama, path, key] of [
  ["other-payment", "/accurate/api/other-payment", "detailAccount"],
  ["purchase-invoice", "/accurate/api/purchase-invoice", "detailExpense"],
]) {
  console.log(`\n── (B) ${nama}: kunci dimensi pada baris ${key}`);
  const list = await get(`${path}/list.do`, `sp.page=1&sp.pageSize=100&fields=id,transDate&${filter}`);
  console.log(`   ${verdict(list)}`);
  if (!isOk(list)) continue;
  const docs = await detailAll(`${path}/detail.do`, (list.body.d ?? []).slice(0, SAMPLE).map((r) => r.id));
  const ls = docs.flatMap((d) => (Array.isArray(d[key]) ? d[key] : []));
  console.log(`   sampel: ${docs.length} dokumen, ${ls.length} baris`);
  console.log(`   kunci header berbau dimensi: ${kunciDimensi(docs[0]).join(", ") || "(tak ada)"}`);
  const semua = new Set(ls.flatMap((l) => kunciDimensi(l)));
  console.log(`   kunci baris berbau dimensi: ${[...semua].join(", ") || "(tak ada)"}`);
  for (const k of semua) {
    const isi = ls.filter((l) => filled(l[k]));
    console.log(`     ${k.padEnd(28)} terisi ${isi.length}/${ls.length}${isi.length ? ` · contoh: ${JSON.stringify(isi[0][k]).slice(0, 70)}` : ""}`);
  }
}

console.log("\nSelesai. Output TANPA nominal & token, tapi memuat cuplikan deskripsi (bisa memuat nama orang/vendor) — kirim privat, bukan ke GitHub.");
