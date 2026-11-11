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

test("format: 4 periode (tanpa kuartal), region, top sales, link, tanpa kurung sudut", () => {
  const t = formatRingkasanSalesArea(perf, [{ nama: "Sales <A>", total: 60e6 }, { nama: "Sales B", total: 20e6 }], "https://x.test/sales-analytics");
  assert.match(t, /\*Sales Area Performance\* · Rab, 11 Nov 2026/);
  assert.match(t, /\*YTD\*: Rp 20,00 M · 20,0% dari target Rp 100,00 M/);
  assert.match(t, /East Rp 11,00 M \(50,0%\) · West Rp 8,00 M \(25,0%\) · OFFICE Rp 1,00 M/);
  assert.match(t, /\*Minggu ini\* \(9–11 Nov\)/);
  assert.match(t, /\*Hari ini\*: Rp 80,0 jt · target belum diisi/);
  assert.doesNotMatch(t, /quarter|Kuartal/i);
  assert.match(t, /1\. Sales A Rp 60,0 jt/);
  assert.match(t, /Detail: https:\/\/x\.test\/sales-analytics/);
  assert.doesNotMatch(t, /[<>]/);
});

test("format: tanpa faktur hari ini → keterangan, bukan daftar kosong", () => {
  const t = formatRingkasanSalesArea(perf, [], null);
  assert.match(t, /Belum ada faktur hari ini/);
  assert.doesNotMatch(t, /Detail:/);
});
