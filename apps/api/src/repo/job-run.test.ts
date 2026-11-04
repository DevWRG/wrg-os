import assert from "node:assert/strict";
import { test } from "node:test";

import { tentukanStatus } from "./job-run.js";

const sekarang = new Date("2026-11-04T08:00:00Z");
const menit = (m: number) => new Date(sekarang.getTime() + m * 60_000);

test("nonaktif & belum jalan", () => {
  assert.equal(tentukanStatus(false, { ok: true, berikut: menit(10) }, sekarang), "NONAKTIF");
  assert.equal(tentukanStatus(true, null, sekarang), "BELUM_JALAN");
});

test("OK / GAGAL dari eksekusi terakhir selama jadwal berikutnya belum lewat", () => {
  assert.equal(tentukanStatus(true, { ok: true, berikut: menit(30) }, sekarang), "OK");
  assert.equal(tentukanStatus(true, { ok: false, berikut: menit(30) }, sekarang), "GAGAL");
  assert.equal(tentukanStatus(true, { ok: true, berikut: null }, sekarang), "OK");
});

test("TERLEWAT bila jadwal berikutnya lewat > 15 menit tanpa eksekusi baru (menang atas OK/GAGAL)", () => {
  assert.equal(tentukanStatus(true, { ok: true, berikut: menit(-14) }, sekarang), "OK");
  assert.equal(tentukanStatus(true, { ok: true, berikut: menit(-16) }, sekarang), "TERLEWAT");
  assert.equal(tentukanStatus(true, { ok: false, berikut: menit(-60 * 24) }, sekarang), "TERLEWAT");
});
