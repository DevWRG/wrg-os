import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HARI_DEFAULT, HARI_MAKS, HARI_TUA, TukarFakturError, hitungPerTahap, hitungTahap, parseBulan, parseHari,
  rentangBulan, tanggalCetak, umurHari, urutkanKejadian, urutkanTracker,
} from "./tukar-faktur.js";

const TODAY = "2026-10-16";

const f = (over: Partial<Parameters<typeof hitungTahap>[0]> = {}) => ({
  status: "OPEN", outstanding: 1_000_000, tanggal: "2026-10-01", printed: null, due: "2026-11-01", ...over,
});

test("tanggalCetak: dd/MM/yyyy (+jam), ISO, kosong, rusak, tanggal mustahil", () => {
  assert.equal(tanggalCetak("05/10/2026 14:30:00"), "2026-10-05");
  assert.equal(tanggalCetak("2026-10-05T07:30:00.000Z"), "2026-10-05");
  assert.equal(tanggalCetak("  05/10/2026 "), "2026-10-05");
  assert.equal(tanggalCetak(""), null);
  assert.equal(tanggalCetak(null), null);
  assert.equal(tanggalCetak(12345), null);
  assert.equal(tanggalCetak("bukan tanggal"), null);
  assert.equal(tanggalCetak("31/02/2026"), null);
});

test("umurHari: hari penuh, masa depan = 0, rusak/null = null", () => {
  assert.equal(umurHari("2026-10-09", TODAY), 7);
  assert.equal(umurHari("2026-10-16", TODAY), 0);
  assert.equal(umurHari("2026-10-20", TODAY), 0);
  assert.equal(umurHari(null, TODAY), null);
  assert.equal(umurHari("2026-13-01", TODAY), null);
  assert.equal(umurHari("2026-10-09", "kemarin"), null);
});

test("hitungTahap: terbit → dicetak → lunas", () => {
  assert.equal(hitungTahap(f(), TODAY).tahap, "terbit");
  assert.equal(hitungTahap(f({ printed: "05/10/2026 10:00:00" }), TODAY).tahap, "dicetak");
  assert.equal(hitungTahap(f({ printed: "05/10/2026", outstanding: 0 }), TODAY).tahap, "lunas");
  assert.equal(hitungTahap(f({ status: "PAID", outstanding: 500 }), TODAY).tahap, "lunas");
});

test("hitungTahap: umur dihitung dari tanggal cetak, cadangan tanggal faktur", () => {
  const a = hitungTahap(f({ printed: "10/10/2026", tanggal: "2026-09-01" }), TODAY);
  assert.equal(a.sejak, "2026-10-10");
  assert.equal(a.umur_hari, 6);
  const b = hitungTahap(f({ printed: "rusak", tanggal: "2026-10-06" }), TODAY);
  assert.equal(b.tahap, "dicetak"); // printedTime terisi walau formatnya tak terbaca
  assert.equal(b.sejak, "2026-10-06");
  assert.equal(b.umur_hari, 10);
  const c = hitungTahap(f({ tanggal: null }), TODAY);
  assert.equal(c.umur_hari, null);
  assert.equal(c.tua, false);
});

test("hitungTahap: batas TUA — tepat 7 hari belum tua, 8 hari tua", () => {
  assert.equal(HARI_TUA, 7);
  assert.equal(hitungTahap(f({ tanggal: "2026-10-09" }), TODAY).tua, false);
  assert.equal(hitungTahap(f({ tanggal: "2026-10-08" }), TODAY).tua, true);
});

test("hitungTahap: faktur lunas tidak pernah TUA/overdue dan tanpa umur", () => {
  const r = hitungTahap(f({ tanggal: "2026-01-01", outstanding: 0, due: "2026-02-01" }), TODAY);
  assert.deepEqual([r.tahap, r.tua, r.overdue, r.umur_hari], ["lunas", false, false, null]);
});

test("hitungTahap: overdue hanya jika belum lunas & jatuh tempo terlewat; due kosong bukan overdue", () => {
  assert.equal(hitungTahap(f({ due: "2026-10-01" }), TODAY).overdue, true);
  assert.equal(hitungTahap(f({ due: "2026-10-16" }), TODAY).overdue, false);
  assert.equal(hitungTahap(f({ due: null }), TODAY).overdue, false);
});

test("parseHari: default, valid, dan batas", () => {
  assert.equal(parseHari(undefined), HARI_DEFAULT);
  assert.equal(parseHari(""), HARI_DEFAULT);
  assert.equal(parseHari("30"), 30);
  assert.equal(parseHari(String(HARI_MAKS)), HARI_MAKS);
  for (const bad of ["0", "-5", "1.5", "abc", String(HARI_MAKS + 1)]) {
    assert.throws(() => parseHari(bad), (e) => e instanceof TukarFakturError && e.status === 400, bad);
  }
});

test("parseBulan: default bulan ini WIB, valid, dan format salah", () => {
  assert.equal(parseBulan(undefined, new Date("2026-10-31T20:00:00Z")), "2026-11"); // 01 Nov WIB
  assert.equal(parseBulan("2026-02"), "2026-02");
  for (const bad of ["2026-13", "2026-00", "2026-2", "202610", "abc", "2026-10-01"]) {
    assert.throws(() => parseBulan(bad), (e) => e instanceof TukarFakturError && e.status === 400, bad);
  }
});

test("rentangBulan: akhir eksklusif, lintas tahun & Februari kabisat", () => {
  assert.deepEqual(rentangBulan("2026-10"), { awal: "2026-10-01", akhir: "2026-11-01" });
  assert.deepEqual(rentangBulan("2026-12"), { awal: "2026-12-01", akhir: "2027-01-01" });
  assert.deepEqual(rentangBulan("2028-02"), { awal: "2028-02-01", akhir: "2028-03-01" });
});

test("urutkanTracker: belum-lunas dulu & tertua di atas; lunas terakhir; input tak dimutasi", () => {
  const rows = [
    { tahap: "lunas" as const, umur_hari: null, tanggal: "2026-10-10", nomor: "C" },
    { tahap: "dicetak" as const, umur_hari: 3, tanggal: "2026-10-13", nomor: "B" },
    { tahap: "terbit" as const, umur_hari: 9, tanggal: "2026-10-07", nomor: "A" },
    { tahap: "terbit" as const, umur_hari: null, tanggal: null, nomor: "D" },
  ];
  assert.deepEqual(urutkanTracker(rows).map((r) => r.nomor), ["A", "B", "D", "C"]);
  assert.equal(rows[0]!.nomor, "C");
});

test("hitungPerTahap menghitung tiap tahap, kosong = nol", () => {
  assert.deepEqual(hitungPerTahap([]), { terbit: 0, dicetak: 0, lunas: 0 });
  assert.deepEqual(hitungPerTahap([{ tahap: "lunas" }, { tahap: "lunas" }, { tahap: "terbit" }]),
    { terbit: 1, dicetak: 0, lunas: 2 });
});

test("urutkanKejadian: tanggal → jenis → customer → nomor, stabil", () => {
  const ev = [
    { tanggal: "2026-10-05", jenis: "jatuh_tempo" as const, customer: "B", nomor: "2" },
    { tanggal: "2026-10-05", jenis: "bayar" as const, customer: "Z", nomor: "1" },
    { tanggal: "2026-10-01", jenis: "jatuh_tempo" as const, customer: "A", nomor: "9" },
  ];
  assert.deepEqual(urutkanKejadian(ev).map((e) => e.nomor), ["9", "1", "2"]);
});
