import assert from "node:assert/strict";
import { test } from "node:test";

import { formatRingkasanSalesArea, labelTanggal, rpRingkas } from "./sales-area-ringkasan.js";

const per = (key: string, total: number, east: number, west: number, office: number, tgt: number | null) => ({
  key, label: key, from: "2026-11-09", to: "2026-11-11", total,
  regions: [{ region: "East", total: east }, { region: "West", total: west }, { region: "OFFICE", total: office }],
  target: { east: tgt == null ? null : tgt / 2, west: tgt == null ? null : tgt / 2, total: tgt },
  pct: { total: tgt ? Math.round((total / tgt) * 1000) / 10 : null, east: tgt ? 50 : null, west: tgt ? 25 : null },
});

const perf = {
  as_of: "2026-11-11",
  periods: [per("year", 20e9, 11e9, 8e9, 1e9, 100e9), per("quarter", 6e9, 3e9, 3e9, 0, 25e9), per("month", 2e9, 1e9, 1e9, 0, 5e9),
    per("week", 300e6, 200e6, 100e6, 0, 2e9), per("day", 80e6, 50e6, 30e6, 0, null)],
  mtd_vs_last: { current: { from: "", to: "", total: 0 }, previous: { from: "", to: "", total: 0 }, growth_pct: null },
} as unknown as Parameters<typeof formatRingkasanSalesArea>[0];

test("rpRingkas & labelTanggal", () => {
  assert.equal(rpRingkas(12_345_678_901), "Rp 12,35 M");
  assert.equal(rpRingkas(123_456_789), "Rp 123,5 jt");
  assert.equal(rpRingkas(250_000), "Rp 250.000");
  assert.equal(labelTanggal("2026-11-11"), "Rab, 11 Nov 2026");
});

test("format WA singkat: % capaian 4 periode, hari ini per region, link infografis", () => {
  const t = formatRingkasanSalesArea(perf, "https://x.test/sales-analytics/area?tanggal=2026-11-11");
  assert.match(t, /\*Sales Area Performance\* · Rab, 11 Nov 2026/);
  assert.match(t, /Capaian target: YTD 20,0% · Bulan 40,0% · Minggu 15,0% · Hari ini target belum diisi/);
  assert.match(t, /Hari ini Rp 80,0 jt \(East Rp 50,0 jt · West Rp 30,0 jt\)/);
  assert.match(t, /Infografis lengkap: https:\/\/x\.test\/sales-analytics\/area\?tanggal=2026-11-11/);
  assert.doesNotMatch(t, /[<>]/);
});

test("format WA tanpa link → tak ada baris infografis", () => {
  assert.doesNotMatch(formatRingkasanSalesArea(perf, null), /Infografis/);
});
