import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEskalasi, buildPengingat, hariKerjaSampai, hariKerjaTerakhir, petaGrupCabang, rencanaKirim, ringkasPerRegionDari, targetEskalasi, targetRegion, type BarisJual, type RingkasRegion } from "./tutup-buku.js";

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

test("petaGrupCabang: pemisah ; / baris baru, nama dinormalkan, entri cacat dibuang", () => {
  const m = petaGrupCabang({ TUTUP_BUKU_TARGET_CABANG: " Madura = 1@g.us ;NTT=2@g.us\nNTB=2@g.us;rusak;KOSONG=; SOLO & YOGYAKARTA=3@g.us" });
  assert.deepEqual([...m], [["MADURA", "1@g.us"], ["NTT", "2@g.us"], ["NTB", "2@g.us"], ["SOLO & YOGYAKARTA", "3@g.us"]]);
  assert.equal(petaGrupCabang({}).size, 0);
});

test("rencanaKirim: per grup cabang (cabang segrup digabung), sisa ke grup region, tanpa region dilewati", () => {
  const rows: BarisJual[] = [
    { region: "East", cabang: "MADURA", am: "AM A", jenis: "so", nilai: 5_000_000 },
    { region: "East", cabang: "NTT", am: "AM B", jenis: "do", nilai: 1_000_000, terlambat: true },
    { region: "East", cabang: "NTB", am: "AM B", jenis: "so", nilai: 2_000_000 },
    { region: "East", cabang: "BALI", am: "AM C", jenis: "do", nilai: 300_000 },
    { region: "West", cabang: "PALEMBANG", am: "AM D", jenis: "so", nilai: 700_000 },
    { region: "LAIN", cabang: "TANPA CABANG", am: "VACANT", jenis: "do", nilai: 100_000 },
  ];
  const peta = new Map([["MADURA", "1@g.us"], ["NTT", "2@g.us"], ["NTB", "2@g.us"]]);
  const p = rencanaKirim(rows, peta, (g) => (g === "East" ? "E@g.us" : null));
  assert.deepEqual(p.map((x) => [x.tujuan, x.to, x.kunci]), [
    ["Cab. MADURA", "1@g.us", "g:1@g.us"],
    ["Cab. NTB, NTT", "2@g.us", "g:2@g.us"],
    ["Sales East (BALI) — grup region", "E@g.us", "East"],
    ["Sales West (PALEMBANG) — grup region", null, "West"],
  ]);
  const ntt = p[1].ringkas;
  assert.equal(ntt.so, 1); assert.equal(ntt.do_, 1);
  assert.deepEqual(ntt.per_am, [{ am: "AM B", so: 1, so_nilai: 2_000_000, do_: 1, do_nilai: 1_000_000, do_terlambat: 1 }]);
  assert.match(buildPengingat(ntt, "2026-11", "2026-11-30", 7), /\(7 hari kerja lagi\)\* · Cab\. NTB, NTT/);
  const reg = ringkasPerRegionDari(rows);
  assert.deepEqual(reg.map((r) => [r.region, r.so, r.do_]), [["East", 2, 2], ["LAIN", 0, 1], ["West", 1, 0]]);
});
