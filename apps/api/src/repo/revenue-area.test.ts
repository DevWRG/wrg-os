import { test } from "node:test";
import assert from "node:assert/strict";

import { shiftMonths, susunRevenueArea, windowsFor } from "./revenue-area.js";

test("shiftMonths: clamp ke akhir bulan & lintas tahun", () => {
  assert.equal(shiftMonths("2026-05-31", -3), "2026-02-28");
  assert.equal(shiftMonths("2026-01-15", -1), "2025-12-15");
  assert.equal(shiftMonths("2026-10-21", -12), "2025-10-21");
});

test("windowsFor: bulan, kuartal, tahun", () => {
  assert.deepEqual(windowsFor("bulan", "2026-10-21"), {
    cur: { from: "2026-10-01", to: "2026-10-21" },
    prev: { from: "2026-09-01", to: "2026-09-21" },
  });
  assert.deepEqual(windowsFor("kuartal", "2026-11-30"), {
    cur: { from: "2026-10-01", to: "2026-11-30" },
    prev: { from: "2026-07-01", to: "2026-08-30" },
  });
  assert.deepEqual(windowsFor("tahun", "2026-10-21"), {
    cur: { from: "2026-01-01", to: "2026-10-21" },
    prev: { from: "2025-01-01", to: "2025-10-21" },
  });
});

const regionMap = { JAKARTA: "West", SBY: "East" } as const;

test("susunRevenueArea: urut, share, delta, region", () => {
  const r = susunRevenueArea(
    [
      { cabang: "SBY", cur: 300, prev: 200 },
      { cabang: "JAKARTA", cur: 700, prev: 0 },
      { cabang: "Tanpa cabang", cur: 0, prev: 50 },
    ],
    regionMap,
    null,
  );
  assert.equal(r.total, 1000);
  assert.equal(r.totalPrev, 250);
  assert.equal(r.deltaPct, 300);
  assert.deepEqual(r.rows.map((x) => x.cabang), ["JAKARTA", "SBY", "Tanpa cabang"]);
  assert.equal(r.rows[0].deltaPct, null); // pembanding 0
  assert.equal(r.rows[0].sharePct, 70);
  assert.equal(r.rows[1].deltaPct, 50);
  assert.equal(r.rows[2].region, "OFFICE");
  assert.deepEqual(r.regions.map((g) => g.region), ["East", "West", "OFFICE"]);
});

test("susunRevenueArea: filter cabang HoD, total ikut terfilter", () => {
  const r = susunRevenueArea(
    [
      { cabang: "SBY", cur: 300, prev: 200 },
      { cabang: "JAKARTA", cur: 700, prev: 100 },
    ],
    regionMap,
    ["SBY"],
  );
  assert.equal(r.total, 300);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].sharePct, 100);
  assert.equal(r.regions.length, 1);
});

test("susunRevenueArea: kosong tidak NaN", () => {
  const r = susunRevenueArea([], regionMap, null);
  assert.equal(r.total, 0);
  assert.equal(r.deltaPct, null);
  assert.deepEqual(r.rows, []);
});

const biaya = (over: Partial<import("./biaya-area.js").BiayaInput> = {}): import("./biaya-area.js").BiayaInput => ({
  biaya: new Map([["SBY", 40], ["BALI", 10]]),
  hpp: new Map([["SBY", { revHpp: 150, gp: 60 }]]),
  pusat: { operasional: 30, sdm: 20, luarUsaha: 5, marketingFeeBelumTerpetakan: 25 },
  cakupan: { total: 80, tertandai: 50, pct: 62.5, perDasar: [] },
  terakhirSync: "2026-10-27T00:00:00.000Z",
  ...over,
});

test("susunRevenueArea + biaya: profit = laba kotor − biaya, cakupan HPP, area biaya-tanpa-revenue ikut tampil", () => {
  const r = susunRevenueArea([{ cabang: "SBY", cur: 300, prev: 200 }], regionMap, null, biaya());
  assert.equal(r.biayaTersedia, true);
  const sby = r.rows.find((x) => x.cabang === "SBY")!;
  assert.deepEqual([sby.biaya, sby.labaKotor, sby.profit, sby.hppCakupanPct], [40, 60, 20, 50]);
  const bali = r.rows.find((x) => x.cabang === "BALI")!; // biaya tanpa revenue
  assert.deepEqual([bali.revenue, bali.biaya, bali.labaKotor, bali.profit, bali.hppCakupanPct], [0, 10, 0, -10, null]);
  assert.deepEqual(r.kantorPusat, { operasional: 30, sdm: 20, luarUsaha: 5, total: 55, marketingFeeBelumTerpetakan: 25 });
  assert.equal(r.cakupan?.pct, 62.5);
});

test("susunRevenueArea + biaya: HoD tidak melihat Kantor Pusat & cakupan perusahaan", () => {
  const r = susunRevenueArea([{ cabang: "SBY", cur: 300, prev: 0 }, { cabang: "JAKARTA", cur: 700, prev: 0 }], regionMap, ["SBY"], biaya());
  assert.equal(r.kantorPusat, null);
  assert.equal(r.cakupan, null);
  assert.deepEqual(r.rows.map((x) => x.cabang), ["SBY"]);
});

test("susunRevenueArea tanpa data biaya: biaya/profit null (bukan nol)", () => {
  const r = susunRevenueArea([{ cabang: "SBY", cur: 300, prev: 0 }], regionMap, null, null);
  assert.equal(r.biayaTersedia, false);
  assert.deepEqual([r.rows[0].biaya, r.rows[0].labaKotor, r.rows[0].profit], [null, null, null]);
  assert.equal(r.kantorPusat, null);
});
