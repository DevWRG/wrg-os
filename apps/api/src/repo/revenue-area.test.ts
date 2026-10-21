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
