// F18 Demo & Trial — logika murni (tanpa DB): parser #DEMO/#TRIAL (buka & tutup),
// tanggal, rekap konversi per produk, balasan WA.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { parseDemoTrial, parseTanggal, rekapKonversi, balasanBuka, balasanFormatDT, TRIAL_HARI_DEFAULT } from "./demo-trial.js";
import { detectKind } from "./inbound.js";

const HARI = "2026-10-13";

test("#DEMO buka: faskes: alat [; catatan]", () => {
  assert.deepEqual(parseDemoTrial("#DEMO RSUD dr Soedono: Zybio Z3 hematologi", "demo", HARI), {
    ok: true, mode: "buka", facility: "RSUD dr Soedono", alat: "Zybio Z3 hematologi", hari: null, sampai: null, catatan: null,
  });
  assert.deepEqual(parseDemoTrial("#demo RS A: Mindray BS-240; kepala lab hadir\nminta brosur", "demo", HARI), {
    ok: true, mode: "buka", facility: "RS A", alat: "Mindray BS-240", hari: null, sampai: null, catatan: "kepala lab hadir\nminta brosur",
  });
});

test("#TRIAL buka: durasi hari / sampai tanggal / default", () => {
  assert.deepEqual(parseDemoTrial("#TRIAL RS A: Zybio EXC810, 21 hari", "trial", HARI),
    { ok: true, mode: "buka", facility: "RS A", alat: "Zybio EXC810", hari: 21, sampai: null, catatan: null });
  assert.deepEqual(parseDemoTrial("#TRIAL RS A: Zybio EXC810, sampai 31/10; dipasang teknisi", "trial", HARI),
    { ok: true, mode: "buka", facility: "RS A", alat: "Zybio EXC810", hari: null, sampai: "2026-10-31", catatan: "dipasang teknisi" });
  assert.deepEqual(parseDemoTrial("#TRIAL RS A: Zybio EXC810", "trial", HARI),
    { ok: true, mode: "buka", facility: "RS A", alat: "Zybio EXC810", hari: null, sampai: null, catatan: null });
  assert.deepEqual(parseDemoTrial("#TRIAL RS A: Zybio, sampai 31/02", "trial", HARI), { ok: false, alasan: "tanggal-salah" });
  // "14 hari" di DEMO bukan durasi — tetap bagian teks alat
  assert.equal((parseDemoTrial("#DEMO RS A: kit cepat, 14 hari", "demo", HARI) as { alat: string }).alat, "kit cepat, 14 hari");
});

test("uji Research 13 Okt: tanggal selesai lewat ditolak; koma di ujung alat dibuang", () => {
  assert.deepEqual(parseDemoTrial("#TRIAL RSUD dr Soedono: Zybio EXC810, sampai 3/10", "trial", HARI), { ok: false, alasan: "tanggal-lewat" });
  assert.equal((parseDemoTrial("#TRIAL RSUD dr Soedono: Zybio EXC810,", "trial", HARI) as { alat: string }).alat, "Zybio EXC810");
  assert.match(balasanFormatDT("trial", "tanggal-lewat", "Husni"), /sudah lewat.*BELUM dicatat/s);
  // sampai hari ini sendiri sah (trial satu hari)
  assert.equal((parseDemoTrial("#TRIAL RS A: X, sampai 13/10", "trial", HARI) as { sampai: string }).sampai, "2026-10-13");
});

test("tutup: kode + hasil [: alasan]; hasil salah ditolak", () => {
  assert.deepEqual(parseDemoTrial("#DEMO DM-0001 positif: kepala lab minta penawaran", "demo", HARI),
    { ok: true, mode: "tutup", kode: "DM-0001", hasil: "positif", alasan: "kepala lab minta penawaran" });
  assert.deepEqual(parseDemoTrial("#trial tr-12 Negatif kalah harga", "trial", HARI),
    { ok: true, mode: "tutup", kode: "TR-12", hasil: "negatif", alasan: "kalah harga" });
  assert.deepEqual(parseDemoTrial("#DEMO DM-0001 bagus sekali", "demo", HARI), { ok: false, alasan: "hasil-salah" });
});

test("format kosong / tanpa alat", () => {
  assert.deepEqual(parseDemoTrial("#DEMO", "demo", HARI), { ok: false, alasan: "kosong" });
  assert.deepEqual(parseDemoTrial("#DEMO RSUD dr Soedono Zybio", "demo", HARI), { ok: false, alasan: "tanpa-alat" });
  assert.deepEqual(parseDemoTrial("#DEMO RS A:", "demo", HARI), { ok: false, alasan: "tanpa-alat" });
  assert.match(balasanFormatDT("trial", "tanpa-alat", "Budi"), /#TRIAL RSUD dr Soedono: Zybio EXC810, 14 hari/);
});

test("parseTanggal", () => {
  assert.equal(parseTanggal("5/1", HARI), "2026-01-05");
  assert.equal(parseTanggal("05-11-27", HARI), "2027-11-05");
  assert.equal(parseTanggal("31/4", HARI), null);
  assert.equal(parseTanggal("besok", HARI), null);
});

test("detectKind: #DEMO / #TRIAL dikenali, #DEMOS / #TRIALS tidak", () => {
  assert.equal(detectKind("#DEMO RS A: x"), "demo");
  assert.equal(detectKind("pengantar\n#trial RS A: x"), "trial");
  assert.equal(detectKind("#DEMOS"), "none");
  assert.equal(detectKind("#TRIALS"), "none");
});

test("rekap konversi: per brand (atau alat), rate = positif ÷ ditutup", () => {
  const rows = [
    { jenis: "demo" as const, brand: "Zybio", alat: "Z3", hasil: "positif" as const },
    { jenis: "demo" as const, brand: "zybio ", alat: "Z5", hasil: "negatif" as const },
    { jenis: "demo" as const, brand: "Zybio", alat: "Z3", hasil: null },
    { jenis: "trial" as const, brand: null, alat: "Mindray BS-240", hasil: "netral" as const },
  ];
  const r = rekapKonversi(rows);
  const zy = r.find((x) => x.kunci.toLowerCase() === "zybio")!;
  assert.deepEqual([zy.total, zy.ditutup, zy.positif, zy.negatif, zy.rate], [3, 2, 1, 1, 50]);
  const mr = r.find((x) => x.kunci === "Mindray BS-240")!;
  assert.deepEqual([mr.jenis, mr.rate], ["trial", 0]);
  const pj = rekapKonversi(rows, "jenis");
  assert.deepEqual(pj.map((x) => [x.kunci, x.total]), [["demo", 3], ["trial", 1]]);
  assert.equal(rekapKonversi([{ jenis: "demo", brand: null, alat: "X", hasil: null }])[0].rate, null);
});

test("balasan buka: trial default, tautan deal, calon pelanggan", () => {
  const t = balasanBuka({ kode: "TR-0001", jenis: "trial", facility_name: "RS A", alat: "EXC810", tanggal_selesai: "2026-10-27", deal_id: "x", account_id: null }, "Budi", true);
  assert.match(t, /Trial \*TR-0001\* tercatat/);
  assert.match(t, new RegExp(`default ${TRIAL_HARI_DEFAULT} hari`));
  assert.match(t, /Tertaut ke deal/);
  assert.match(t, /calon pelanggan/);
  assert.match(t, /#TRIAL TR-0001 positif\|netral\|negatif/);
});
