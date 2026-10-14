import { test } from "node:test";
import assert from "node:assert/strict";

import { baruTelat, gelombang, jendela, nilaiOrder, nilaiStok, pesanRekapStok, ritmeHari } from "./kso-suplai.js";

// F7 KSO Lifecycle — aturan kontrol order & stok (15 Okt 2026).

const HARI = "2026-10-15";

test("gelombang: kiriman ≤7 hari dari kiriman sebelumnya = satu gelombang", () => {
  assert.deepEqual(gelombang(["2026-07-03", "2026-07-01", "2026-07-08", "2026-07-01", "2026-08-02", "2026-08-30"]),
    ["2026-07-01", "2026-08-02", "2026-08-30"]);
  // berantai: 1→6→12 tetap satu gelombang walau 1→12 = 11 hari
  assert.deepEqual(gelombang(["2026-07-01", "2026-07-06", "2026-07-12"]), ["2026-07-01"]);
  assert.deepEqual(gelombang([]), []);
});

test("ritmeHari: median jeda antar-gelombang", () => {
  assert.equal(ritmeHari(["2026-07-01"]), null);
  assert.equal(ritmeHari(["2026-07-01", "2026-07-31"]), 30);
  assert.equal(ritmeHari(["2026-07-01", "2026-07-31", "2026-08-30", "2026-10-29"]), 30); // median [30,30,60]
  assert.equal(ritmeHari(["2026-07-01", "2026-07-21", "2026-08-30", "2026-10-09"]), 40); // median [20,40,40]
});

test("nilaiOrder: TANPA_KIRIMAN, RUTIN, TELAT dgn batas maks(1,5×ritme, ritme+14)", () => {
  assert.equal(nilaiOrder(null, [], HARI).status, "TANPA_KIRIMAN");
  // ritme 30 → batas maks(45, 44) = 45
  const g = ["2026-07-01", "2026-07-31", "2026-08-30"];
  const r = nilaiOrder("2026-08-30", g, HARI);
  assert.equal(r.ritme_hari, 30);
  assert.equal(r.batas_hari, 45);
  assert.equal(r.lewat_hari, 46);
  assert.equal(r.status, "TELAT");
  assert.equal(r.perkiraan_order, "2026-09-29");
  assert.equal(r.telat_sejak, "2026-10-15");
  assert.equal(nilaiOrder("2026-08-31", g, HARI).status, "RUTIN"); // lewat 45 = batas, belum telat
  // ritme pendek 14 → batas maks(21, 28) = 28
  assert.equal(nilaiOrder("2026-09-20", ["2026-08-23", "2026-09-06", "2026-09-20"], HARI).batas_hari, 28);
  // ≤1 gelombang di jendela → batas 60
  const t = nilaiOrder("2026-08-16", ["2026-08-16"], HARI);
  assert.equal(t.ritme_hari, null);
  assert.equal(t.batas_hari, 60);
  assert.equal(t.status, "RUTIN");
  assert.equal(nilaiOrder("2026-08-15", [], HARI).status, "TELAT");
});

test("nilaiStok: KRITIS / PERLU_PO / STOK_0 / AMAN + saran PO ke 2 bulan", () => {
  assert.deepEqual(nilaiStok(100, 50, 0), { status: "KRITIS", cukup_bulan: 0.5, saran_po: 150 });
  assert.equal(nilaiStok(100, 150, 0).status, "PERLU_PO");
  assert.equal(nilaiStok(100, 150, 0).saran_po, 50);
  assert.equal(nilaiStok(100, 150, 60).status, "AMAN"); // PO jalan menutup kekurangan
  assert.equal(nilaiStok(100, 0, 0).status, "STOK_0");
  assert.equal(nilaiStok(100, -5, 0).status, "STOK_0");
  assert.equal(nilaiStok(0, 0, 0).status, "AMAN");
  assert.equal(nilaiStok(100, 250, 0).saran_po, 0);
});

test("jendela: N bulan tutup, dipotong ke awal data DO", () => {
  assert.deepEqual(jendela(HARI, 3, "2026-04-08"), { bulan: 3, dari: "2026-07-01", sampai: "2026-10-01", bulan_efektif: 3, terpotong: false });
  assert.deepEqual(jendela(HARI, 12, "2026-04-08"), { bulan: 12, dari: "2026-04-01", sampai: "2026-10-01", bulan_efektif: 6, terpotong: true });
  assert.equal(jendela(HARI, 0, null).bulan, 3);     // 0/NaN → default
  assert.equal(jendela(HARI, 99, null).bulan, 12);   // dibatasi
  assert.equal(jendela("2026-01-10", 2, null).dari, "2025-11-01");
});

test("baruTelat: hanya yang melewati batas dalam 7 hari terakhir", () => {
  const o = [
    { status: "TELAT" as const, telat_sejak: "2026-10-15" },
    { status: "TELAT" as const, telat_sejak: "2026-10-09" },
    { status: "TELAT" as const, telat_sejak: "2026-10-08" }, // 8 hari lalu → minggu lalu
    { status: "RUTIN" as const, telat_sejak: "2026-10-30" },
  ];
  assert.equal(baruTelat(o, HARI).length, 2);
});

test("pesanRekapStok: ringkas & tanpa placeholder kurung sudut", () => {
  const p = pesanRekapStok("Ika", [{ item_no: "AKS.1", nama: "Reagen A", status: "KRITIS", stok: 10, kebutuhan_total_bln: 40, po_sisa: 20, saran_po: 50, unit: "BOX" }]);
  assert.match(p, /1 item stoknya kurang dari 2 bulan/);
  assert.match(p, /stok 10 · butuh ±40\/bln · PO jalan 20 · saran PO 50 BOX/);
  assert.doesNotMatch(p, /[<>]/);
});
