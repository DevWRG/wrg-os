import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEskalasi, buildPengingat, hariKerjaSampai, hariKerjaTerakhir, targetEskalasi, targetRegion, type RingkasRegion } from "./tutup-buku.js";

test("hariKerjaTerakhir: lewati Sabtu/Minggu & libur", () => {
  assert.equal(hariKerjaTerakhir("2026-11", new Set()), "2026-11-30");            // Senin
  assert.equal(hariKerjaTerakhir("2026-10", new Set()), "2026-10-30");            // 31 Okt Sabtu → Jumat 30
  assert.equal(hariKerjaTerakhir("2026-11", new Set(["2026-11-30"])), "2026-11-27"); // 30 libur → Jumat 27
  assert.equal(hariKerjaTerakhir("2026-05", new Set()), "2026-05-29");            // 31 Mei Minggu, 30 Sabtu
});

test("hariKerjaSampai: hari kerja sesudah hari ini s/d tutup buku", () => {
  assert.equal(hariKerjaSampai("2026-11-27", "2026-11-30", new Set()), 1);        // Jumat → Senin = besok (H-1)
  assert.equal(hariKerjaSampai("2026-11-30", "2026-11-30", new Set()), 0);
  assert.equal(hariKerjaSampai("2026-11-25", "2026-11-30", new Set()), 3);        // Rabu → Kam, Jum, Sen
  assert.equal(hariKerjaSampai("2026-11-19", "2026-11-30", new Set()), 7);
  assert.equal(hariKerjaSampai("2026-11-19", "2026-11-30", new Set(["2026-11-24"])), 6);
  assert.equal(hariKerjaSampai("2026-12-01", "2026-11-30", new Set()), -1);
});

const r: RingkasRegion = {
  region: "East", so: 3, so_nilai: 12_500_000, do_: 2, do_nilai: 850_000,
  per_am: [
    { am: "AM Satu", so: 2, so_nilai: 10_000_000, do_: 1, do_nilai: 500_000, do_terlambat: 1 },
    { am: "AM Dua", so: 1, so_nilai: 2_500_000, do_: 0, do_nilai: 0, do_terlambat: 0 },
    { am: "AM Tiga", so: 0, so_nilai: 0, do_: 1, do_nilai: 350_000, do_terlambat: 0 },
  ],
};

test("buildPengingat: judul H-n, ringkasan, per AM, batas baris, tanpa <...>", () => {
  const t = buildPengingat(r, "2026-11", "2026-11-30", 3, 2);
  assert.match(t, /^⏳ \*Tutup buku November 2026 — Senin, 30 November \(3 hari kerja lagi\)\* · Sales East/);
  assert.match(t, /3 SO belum dikirim \(Rp12,5 jt\) dan 2 DO terkirim belum difaktur \(Rp850 rb\)/);
  const baris = t.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.deepEqual(baris, ["1. AM Satu — 2 SO belum dikirim (Rp10 jt) · 1 DO belum difaktur (Rp500 rb)", "2. AM Dua — 1 SO belum dikirim (Rp2,5 jt)"]);
  assert.match(t, /… dan 1 AM lainnya\./);
  assert.match(buildPengingat(r, "2026-11", "2026-11-30", 1), /\(BESOK\)/);
  assert.doesNotMatch(t, /<[^>]+>/);
});

test("buildEskalasi: hanya region yang punya sisa, 3 AM teratas", () => {
  const kosong: RingkasRegion = { region: "West", so: 0, so_nilai: 0, do_: 0, do_nilai: 0, per_am: [] };
  const t = buildEskalasi([r, kosong], "2026-11", "2026-11-30");
  assert.match(t, /BESOK \(Senin, 30 November\)/);
  assert.match(t, /• Sales East: 3 SO belum dikirim .* AM terbanyak: AM Satu, AM Dua, AM Tiga/);
  assert.doesNotMatch(t, /Sales West/);
});

test("target grup dari env", () => {
  assert.equal(targetRegion("East", { TUTUP_BUKU_TARGET_EAST: " 1-2@g.us " }), "1-2@g.us");
  assert.equal(targetRegion("West", {}), null);
  assert.equal(targetEskalasi({ TUTUP_BUKU_ESKALASI_TARGET: "9@g.us" }), "9@g.us");
});
