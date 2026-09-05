#!/usr/bin/env node
// Tes lib/accurate.mjs — TANPA jaringan: `fetch` global di-stub, jadi yang
// diuji kode lib yang sesungguhnya, bukan salinannya.
//   node scripts/qa/uji-lib-accurate.mjs   (exit 0 = lulus)
// Uji lib/accurate.mjs SUNGGUHAN dengan fetch global di-stub.
import { fetchAllPages, fetchRowCount, findWarehouseKeys, isOk, MAX_PAGES } from "./lib/accurate.mjs";

const CREDS = { token: "x", secret: "y", host: "stub.local" };
let calls = [];

function stubFetch({ total, reportSp = true, status = 200, s = true, html = false }) {
  globalThis.fetch = async (url) => {
    calls.push(url);
    const page = Number(/sp\.page=(\d+)/.exec(url)?.[1] ?? 1);
    if (html) return { status, text: async () => "<html>halaman web</html>" };
    const start = (page - 1) * 100;
    const d = Array.from({ length: Math.max(0, Math.min(100, total - start)) }, (_, i) => ({ id: start + i + 1, name: `W${start + i + 1}` }));
    return { status, text: async () => JSON.stringify({ s, d, ...(reportSp ? { sp: { rowCount: total, page } } : {}) }) };
  };
}

let gagal = 0;
const cek = (nama, aktual, harap) => {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap);
  console.log(`${ok ? "✅" : "❌"} ${nama}: ${JSON.stringify(aktual)}${ok ? "" : ` (harap ${JSON.stringify(harap)})`}`);
  if (!ok) gagal++;
};

// — paginasi lewat kode lib yang sesungguhnya —
stubFetch({ total: 109 }); calls = [];
let r = await fetchAllPages(CREDS, "/x");
cek("109 baris → terkumpul", r.rows.length, 109);
cek("109 baris → rowCount", r.rowCount, 109);
cek("109 baris → 2 panggilan", calls.length, 2);

stubFetch({ total: 100 }); calls = [];
r = await fetchAllPages(CREDS, "/x");
cek("100 baris → 1 panggilan (tak sia-sia)", calls.length, 1);

stubFetch({ total: 109, reportSp: false }); calls = [];
r = await fetchAllPages(CREDS, "/x");
cek("tanpa sp → tetap 109", r.rows.length, 109);
cek("tanpa sp → rowCount null", r.rowCount, null);

stubFetch({ total: 100 * MAX_PAGES + 50 }); calls = [];
r = await fetchAllPages(CREDS, "/x");
cek("melebihi MAX_PAGES → capped", r.capped, true);

// s=false HARUS dianggap gagal walau HTTP 200 (jebakan utama Accurate).
stubFetch({ total: 5, s: false }); calls = [];
r = await fetchAllPages(CREDS, "/x");
cek("HTTP 200 + s=false → rows null", r.rows, null);
cek("HTTP 200 + s=false → isOk false", isOk(r), false);

// Balasan HTML (bentuk REST /api/warehouse) tak boleh dianggap sukses.
stubFetch({ total: 0, html: true }); calls = [];
r = await fetchAllPages(CREDS, "/x");
cek("balasan HTML → rows null", r.rows, null);

// fetchRowCount = 1 panggilan saja.
stubFetch({ total: 5800 }); calls = [];
const rc = await fetchRowCount(CREDS, "/x");
cek("fetchRowCount → nilai", rc.rowCount, 5800);
cek("fetchRowCount → 1 panggilan", calls.length, 1);

// — findWarehouseKeys —
cek("nol jejak gudang", findWarehouseKeys({ id: 1, name: "X", quantity: 5 }).length, 0);
cek(
  "array detailWarehouseData terdeteksi",
  findWarehouseKeys({ id: 1, detailWarehouseData: [{ warehouseId: 100, quantity: 7 }] }).map((h) => h.path),
  ["detailWarehouseData", "detailWarehouseData[0].warehouseId"],
);
cek(
  "bersarang dalam sampai kedalaman 4",
  findWarehouseKeys({ d: { a: { b: { warehouseName: "GUDANG SBY" } } } }).map((h) => h.path),
  ["d.a.b.warehouseName"],
);
cek("case-insensitive (Gudang)", findWarehouseKeys({ namaGudang: "SBY" }).map((h) => h.path), ["namaGudang"]);

console.log(gagal === 0 ? "\nSEMUA LULUS" : `\n${gagal} GAGAL`);
process.exit(gagal ? 1 : 0);
