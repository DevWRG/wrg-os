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

test("format WA per poin: nilai (% target) tiap periode, hari ini dirinci East/West, link", () => {
  const t = formatRingkasanSalesArea(perf, "https://x.test/sales-analytics/area?tanggal=2026-11-11");
  assert.match(t, /^\*Sales Area Performance\*\n_Rab, 11 Nov 2026_\n/);
  assert.match(t, /• \*YTD\*: Rp 20,00 M \(20,0%\)/);
  assert.match(t, /• \*Bulan ini\*: Rp 2,00 M \(40,0%\)/);
  assert.match(t, /• \*Minggu ini\*: Rp 300,0 jt \(15,0%\)/);
  assert.match(t, /• \*Hari ini\*: Rp 80,0 jt \(target belum diisi\)/);
  assert.ok(t.includes("   – East: Rp 50,0 jt (target belum diisi)\n   – West: Rp 30,0 jt (target belum diisi)"));
  assert.match(t, /Infografis lengkap:\nhttps:\/\/x\.test\/sales-analytics\/area\?tanggal=2026-11-11$/);
  assert.doesNotMatch(t, /Kuartal|quarter/i);
  assert.doesNotMatch(t, /[<>]/);
});

test("format WA tanpa link → tak ada baris infografis", () => {
  assert.doesNotMatch(formatRingkasanSalesArea(perf, null), /Infografis/);
});
