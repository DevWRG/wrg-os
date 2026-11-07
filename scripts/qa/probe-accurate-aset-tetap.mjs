#!/usr/bin/env node
// Probe v2 READ-ONLY untuk F34 (register aset tetap + depresiasi).
//
// Probe v1 (brief magang, dijalankan di prod 2026-10-12) sudah menjawab
// "apakah modulnya dipakai & field apa yang ada":
//   - fixed-asset/list.do  rowCount 1.394, tapi baris cuma {quantity, draft, id}
//   - fixed-asset/detail.do lengkap: assetCost, bookValue, residu, estimatedLife
//     (bulan), depreciationMethod/Rate, transDate/usageDate, faType{id,name},
//     akun, cabang/lokasi, disposed, purchaseInvoiceId
//   - fixed-asset-type / asset-type → 404 "URL API tidak tepat"
//   - sampel id=13850 bernomor KSO-1167, purchaseInvoiceId null
//
// Yang belum terjawab, dan menentukan bentuk syncer + skema migrasi 203:
//   (a) apakah list.do mau membawa field lewat `fields=` — kalau ya, sinkron =
//       ~14 panggilan; kalau tidak, = 1.394 panggilan detail. Ingat F37:
//       item/list.do MENGABAIKAN parameter tak dikenal diam-diam (s=true), jadi
//       yang dinilai adalah kunci yang benar-benar kembali, bukan status OK.
//   (b) sebaran isi: prefiks nomor (berapa KSO-?), disposed, tipe aset, metode,
//       umur, tahun perolehan, berapa yang tertaut faktur pembelian.
//
// SEMUA GET. Tak ada request yang menulis ke Accurate. Token tak pernah dicetak.
//
// ── HASIL JALAN DI PROD (2026-10-12) ───────────────────────────────────────
//   fields=  dihormati SEBAGIAN: 10/17. list.do bawa number, description,
//            assetCost, residu, disposed, quantityDisposed, transDate, usageDate,
//            intangible, draft. TIDAK bawa bookValue, faType, metode, umur,
//            purchaseInvoiceId → syncer = 14 halaman list + 1.394 detail
//            (≈0,26 dtk/panggilan ≈ 6 menit sekuensial) — layak harian.
//   isi      1.394 aset, nomor unik semua. Prefiks KSO 1.165 · INK 215 · VHC 9 ·
//            TNH 2 · GDG 2 · KS 1 (salah ketik?). disposed 94 (88 KSO, 6 INK).
//            transDate 2024 = 1.079 (diduga tanggal saldo awal/cut-over Accurate,
//            bukan tanggal beli asli — umur ganjil 59/58/19 bulan = sisa umur).
//            Σ assetCost aktif = Σ semua → aset disposed tampil assetCost 0 di list.
//   sampel 80 detail: semua STRAIGHTLINE, semua "Kantor Pusat", NOL tertaut
//            faktur/penerimaan; umur 12 bln dominan (44/80); 47/80 sudah habis
//            susut. Tipe: ALAT KSO / INVENTARIS KANTOR / KENDARAAN.
//   KSO-* di Accurate (1.077 aktif) ≠ kso_asset WRG-OS (591 aktif): butir beda
//            (Accurate ikut UPS/RO/aksesori) dan TAK ada kunci bersama
//            (kso_asset = SN, Accurate = nomor KSO-n). Jembatan perlu dirancang.
//
// Jalankan di mesin berkredensial prod (Mac mini):
//   node scripts/qa/probe-accurate-aset-tetap.mjs
//   node scripts/qa/probe-accurate-aset-tetap.mjs --sample=120   # ukuran sampel detail

import { loadCreds, accGet, isOk, failMessage, fetchAllPages, describe } from "./lib/accurate.mjs";

const PATH_LIST = "/accurate/api/fixed-asset/list.do";
const PATH_DETAIL = "/accurate/api/fixed-asset/detail.do";

// Field yang ingin dibawa list.do. Nama persis seperti di detail.do (probe v1).
const WANT = [
  "id", "number", "description", "assetCost", "bookValue", "residu", "disposed",
  "quantityDisposed", "faType", "depreciationMethod", "estimatedLife", "transDate",
  "usageDate", "purchaseInvoiceId", "purchaseNumber", "intangible", "assetBranchName",
];

const argSample = process.argv.find((a) => a.startsWith("--sample="));
const SAMPLE = argSample ? Math.max(1, Number(argSample.split("=")[1]) || 80) : 80;

const creds = loadCreds();
if (creds.err) {
  console.error(`✗ ${creds.err}`);
  console.error("  Jalankan skrip ini di mesin yang punya kredensial prod (Mac mini).");
  process.exit(2);
}
console.log(`host       : ${creds.host}`);
console.log(`kredensial : ${creds.from === "env" ? "env ACCURATE_ACCESS_TOKEN/SIGNATURE_SECRET" : creds.from}`);
console.log("mode       : READ-ONLY (GET saja)\n");

function verdict(r) {
  if (isOk(r)) return "OK";
  if (r.body?._nonJson) return `HTML/non-JSON (path tak dikenal?) HTTP ${r.httpStatus}`;
  return `GAGAL HTTP ${r.httpStatus}: ${failMessage(r.body) ?? "?"}`;
}

// Retry ringan: jalan pertama di prod (2026-10-12) sempat "fetch failed" sekali
// di tengah paginasi. Hanya kegagalan transport (HTTP 0) yang diulang —
// penolakan logis Accurate (s=false) tak akan berubah dengan diulang.
async function get(path, qs) {
  let r;
  for (let i = 0; i < 3; i++) {
    r = await accGet(creds, path, qs);
    if (r.httpStatus !== 0) return r;
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return r;
}
async function allPages(qs) {
  for (let i = 0; i < 3; i++) {
    const r = await fetchAllPages(creds, PATH_LIST, qs);
    if (r.rows || r.httpStatus !== 0) return r;
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
  return fetchAllPages(creds, PATH_LIST, qs);
}

// ── (a) Field mana yang dihormati `fields=`? ───────────────────────────────
// Dinilai dari KUNCI yang kembali. Jalan pertama: 10/17 kembali — list.do punya
// daftar field sendiri; bookValue/faType/metode/umur/faktur cuma ada di detail.
console.log("── (a) list.do + fields=");
const fieldsQs = `fields=${encodeURIComponent(WANT.join(","))}`;
const tryFields = await get(PATH_LIST, `sp.page=1&sp.pageSize=5&${fieldsQs}`);
if (!isOk(tryFields)) {
  console.log(`   ${verdict(tryFields)}`);
  process.exit(1);
}
const keys0 = new Set(Array.isArray(tryFields.body?.d) && tryFields.body.d.length ? Object.keys(tryFields.body.d[0]) : []);
const listFields = WANT.filter((k) => keys0.has(k));
const detailOnly = WANT.filter((k) => !keys0.has(k));
console.log(`   ${describe(tryFields.body?.d)}`);
console.log(`   diminta ${WANT.length}, kembali ${listFields.length} · HANYA di detail: ${detailOnly.join(", ") || "-"}`);
console.log();

// ── (b) Daftar penuh lewat list.do+fields (murah, ~14 panggilan) ────────────
const all = await allPages(fieldsQs);
if (!all.rows) {
  console.log(`   paginasi gagal: ${verdict(all)}`);
  process.exit(1);
}
console.log(`── (b) paginasi penuh list.do+fields: ${all.rows.length} baris / rowCount ${all.rowCount ?? "?"} · ${all.pages} halaman${all.capped ? " · ⚠️ KENA MAX_PAGES" : ""}`);
if (all.rowCount != null && all.rows.length !== all.rowCount) console.log(`   ⚠️ terkumpul ≠ rowCount (selisih ${all.rowCount - all.rows.length})`);
const listRows = all.rows;

// ── (c) Sampel detail tersebar merata untuk field yang hanya ada di detail ──
// Bukan N pertama: urutan list cenderung terbaru dulu.
const n = Math.min(SAMPLE, listRows.length);
const step = listRows.length / n;
const pick = Array.from({ length: n }, (_, i) => listRows[Math.floor(i * step)].id);
const detRows = [];
let gagal = 0;
const t0 = Date.now();
for (const id of pick) {
  const r = await get(PATH_DETAIL, `id=${id}`);
  if (isOk(r) && r.body?.d) detRows.push(r.body.d);
  else gagal++;
}
const dt = (Date.now() - t0) / 1000;
console.log(`── (c) detail sampel: ${detRows.length} OK, ${gagal} gagal, ${dt.toFixed(1)} dtk (≈${(dt / n).toFixed(2)} dtk/panggilan)`);
console.log(`   estimasi sapuan penuh ${listRows.length} detail ≈ ${Math.round(((dt / n) * listRows.length) / 60)} menit (sekuensial)`);
console.log();

// ── Statistik ───────────────────────────────────────────────────────────────
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
  for (const [k, v] of entries.slice(0, max)) console.log(`     ${String(k).padEnd(28)} ${v}`);
  if (entries.length > max) console.log(`     … ${entries.length - max} nilai lain`);
};
// Prefiks = bagian huruf sebelum angka/tanda hubung pertama. "KSO-1167" → "KSO".
const prefix = (num) => {
  const m = String(num ?? "").match(/^[A-Za-z]+/);
  return m ? m[0].toUpperCase() : num ? "(tanpa huruf)" : "(kosong)";
};
const year = (s) => (typeof s === "string" && /\d{4}$/.test(s) ? s.slice(-4) : "(?)");
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const has = (v) => v != null && v !== "" && v !== 0;

const L = listRows;
const D = detRows;
console.log(`── Sebaran dari list.do (basis: SEMUA ${L.length} aset)`);
show("prefiks nomor", tally((r) => prefix(r.number), L));
show("disposed", tally((r) => (r.disposed ? "ya" : "tidak"), L));
show("quantityDisposed > 0", tally((r) => (num(r.quantityDisposed) > 0 ? "ya" : "tidak"), L));
show("tahun perolehan (transDate)", tally((r) => year(r.transDate), L), 20);
show("intangible", tally((r) => (r.intangible ? "ya" : "tidak"), L));
show("draft", tally((r) => (r.draft ? "ya" : "tidak"), L));
show("prefiks × disposed", tally((r) => `${prefix(r.number)} / ${r.disposed ? "disposed" : "aktif"}`, L));
const sumCost = L.reduce((s, r) => s + num(r.assetCost), 0);
const sumCostAktif = L.filter((r) => !r.disposed).reduce((s, r) => s + num(r.assetCost), 0);
const fmt = (x) => Math.round(x).toLocaleString("id-ID");
console.log(`   Σ assetCost semua ${fmt(sumCost)} · aktif ${fmt(sumCostAktif)}`);
const kso = L.filter((r) => prefix(r.number) === "KSO").slice(0, 8);
if (kso.length) {
  console.log("   contoh KSO-* (nomor · deskripsi · tgl):");
  for (const r of kso) console.log(`     ${r.number} · ${String(r.description ?? "").slice(0, 50)} · ${r.transDate ?? "?"}`);
}
const nums = L.map((r) => r.number).filter(Boolean);
console.log(`   nomor unik: ${new Set(nums).size} dari ${nums.length} terisi`);
console.log();

console.log(`── Sebaran dari detail.do (basis: SAMPEL ${D.length} aset, tersebar merata)`);
show("tipe aset (faType.name)", tally((r) => r.faType?.name ?? "(absen)", D));
show("metode depresiasi", tally((r) => r.depreciationMethod ?? "(absen)", D));
show("umur (bulan)", tally((r) => r.estimatedLife ?? "(absen)", D));
show("tertaut faktur pembelian (purchaseInvoiceId)", tally((r) => (has(r.purchaseInvoiceId) ? "ya" : "tidak"), D));
show("purchaseNumber terisi", tally((r) => (has(r.purchaseNumber) ? "ya" : "tidak"), D));
show("receiveItemId terisi", tally((r) => (has(r.receiveItemId) ? "ya" : "tidak"), D));
show("cabang (assetBranchName)", tally((r) => r.assetBranchName ?? "(absen)", D));
show("sudah habis susut (bookValue ≤ residu)", tally((r) => (num(r.bookValue) <= num(r.residu) ? "ya" : "tidak"), D));
show("currentAssetCost ≠ assetCost (ada revaluasi/tambahan)", tally((r) => (num(r.currentAssetCost) !== num(r.assetCost) ? "ya" : "tidak"), D));
show("detailExpenditure > 1 baris", tally((r) => ((r.detailExpenditure?.length ?? 0) > 1 ? "ya" : "tidak"), D));

console.log("\nSelesai. Output ini aman dibagikan (tanpa token); dasar skema migrasi 203 + syncer F34.");
