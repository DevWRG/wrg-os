import { test } from "node:test";
import assert from "node:assert/strict";

import { cocokkan, jenisSejalan, normSn, type AlatKso, type AsetAcc } from "./asetTetapRekon.js";

// Data sintetis — pola diambil dari bentuk data prod, tanpa nama faskes/SN asli.
const acc = (id: number, description: string, notes: string | null): AsetAcc =>
  ({ id, number: `KSO-${String(id).padStart(4, "0")}`, description, notes });
const kso = (id: number, sn_key: string, nama_alat: string | null, type_alat: string | null = null): AlatKso =>
  ({ id, sn_key, sn_raw: sn_key, customer_raw: `FASKES-${id}`, nama_alat, type_alat });
const kosong = { accurateIds: new Set<number>(), ksoIds: new Set<number>() };

test("normSn: apostrof depan, ekor .0, spasi, huruf kecil, leading zero — sama dgn importer", () => {
  assert.equal(normSn("'83222604500768"), "83222604500768");
  assert.equal(normSn("5360.0"), "5360");
  assert.equal(normSn(" xq 0224 "), "XQ0224");
  assert.equal(normSn("00829"), "829");
  assert.equal(normSn("000"), "000"); // nol semua dipertahankan, seperti norm_sn Python
  assert.equal(normSn(null), "");
  assert.equal(normSn("   "), "");
});

test("jenisSejalan: merek/model cocok, kata umum tak dihitung", () => {
  assert.equal(jenisSejalan({ description: "ZYBIO HEMATOLOGY ANALYZER 5 DIFF Z52" }, { nama_alat: "Zybio Z52", type_alat: null }), true);
  assert.equal(jenisSejalan({ description: "CLOVER A1C SELF ANALYZER" }, { nama_alat: "Clover A1c", type_alat: null }), true);
  // hanya berbagi kata umum "ANALYZER" → tidak sejalan
  assert.equal(jenisSejalan({ description: "CLOVER A1C SELF ANALYZER" }, { nama_alat: "Pictus 400 Analyzer", type_alat: null }), false);
  // nama_alat kosong → jatuh ke type_alat; keduanya kosong → tak bisa menilai
  assert.equal(jenisSejalan({ description: "NIHON HEMATOLOGY MEK 6510" }, { nama_alat: "", type_alat: "NIHON" }), true);
  assert.equal(jenisSejalan({ description: "APA SAJA" }, { nama_alat: null, type_alat: null }), false);
});

test("pasti: SN sama persis, unik, alat sejalan", () => {
  const h = cocokkan(
    [acc(1, "ZYBIO HEMATOLOGY ANALYZER 5 DIFF Z52", "XQ022407001951")],
    [kso(10, "XQ022407001951", "Zybio Z52")],
    kosong,
  );
  assert.equal(h.pasti.length, 1);
  assert.equal(h.pasti[0].accurate_id, 1);
  assert.equal(h.pasti[0].kso_asset_id, 10);
  assert.equal(h.kandidat.length, 0);
  assert.equal(h.kso_tanpa_pasangan.length, 0);
});

test("apostrof depan di catatan Accurate tetap cocok sama persis", () => {
  const h = cocokkan([acc(1, "NERR UPS EXO 2K", "'83222604500768")], [kso(10, "83222604500768", "NERR UPS EXO")], kosong);
  assert.equal(h.pasti.length, 1);
});

test("SN sama tapi alat beda → kandidat, bukan pasti", () => {
  const h = cocokkan(
    [acc(1, "ZYBIO FLUORESCENCE IMMUNOCHROMATOGRAPHY ANALYZER EXR110", "MY042411003137")],
    [kso(10, "MY042411003137", "Wondfo FIA Meter")],
    kosong,
  );
  assert.equal(h.pasti.length, 0);
  assert.equal(h.kandidat.length, 1);
  assert.match(h.kandidat[0].alasan[0], /tak sejalan/);
});

test("SN pendek (<5) tak pernah pasti walau alat sejalan", () => {
  const h = cocokkan([acc(1, "NIHON HEMATOLOGY MEK 6510", "4867")], [kso(10, "4867", "NIHON-6510")], kosong);
  assert.equal(h.pasti.length, 0);
  assert.equal(h.kandidat.length, 1);
  assert.match(h.kandidat[0].alasan.join(), /pendek/);
});

test("SN kembar di dua aset Accurate → dua kandidat, tak ada pasti", () => {
  const h = cocokkan(
    [acc(1, "CLOVER A1C SELF ANALYZER", "H01C23H2800297"), acc(2, "CLOVER A1C SELF ANALYZER", "H01C23H2800297")],
    [kso(10, "H01C23H2800297", "Clover A1c")],
    kosong,
  );
  assert.equal(h.pasti.length, 0);
  assert.equal(h.kandidat.length, 2);
  assert.match(h.kandidat[0].alasan[0], /2 aset/);
});

test("SN termuat di dalam catatan (bukan sama persis) → kandidat", () => {
  const h = cocokkan([acc(1, "ZYBIO CHEMISTRY ANALYZER EXC220", "SN: SH012510002350 (unit pinjam)")], [kso(10, "SH012510002350", "Zybio EXC220")], kosong);
  assert.equal(h.pasti.length, 0);
  assert.equal(h.kandidat.length, 1);
  assert.match(h.kandidat[0].alasan[0], /termuat/);
});

test("SN pendek tak dicari sebagai substring (hindari nyangkut di angka lain)", () => {
  const h = cocokkan([acc(1, "APA SAJA", "nomor 123456789 lain")], [kso(10, "4867", "X")], kosong);
  assert.equal(h.kandidat.length, 0);
  assert.equal(h.kso_tanpa_pasangan.length, 1);
});

test("yang sudah tertaut dilewati di kedua sisi; NOSN tak diproses", () => {
  const h = cocokkan(
    [acc(1, "ZYBIO Z52", "AAAAAA1"), acc(2, "ZYBIO Z52", "BBBBBB2")],
    [kso(10, "AAAAAA1", "Zybio Z52"), kso(11, "BBBBBB2", "Zybio Z52"), kso(12, "NOSN:X|Y", "Zybio Z52")],
    { accurateIds: new Set([1]), ksoIds: new Set([11]) },
  );
  // kso 10 butuh acc 1 yang sudah terpakai → tak ada pasangan; kso 11 sudah tertaut
  assert.equal(h.pasti.length, 0);
  assert.deepEqual(h.kso_tanpa_pasangan.map((k) => k.id).sort(), [10, 12]);
});

test("aset tanpa catatan & aksesori dihitung 'tanpa pasangan' di sisi Accurate", () => {
  const h = cocokkan(
    [acc(1, "NERR UPS 2000", null), acc(2, "EPSON PRINTER L310", ""), acc(3, "ZYBIO Z52", "AAAAAA1")],
    [kso(10, "AAAAAA1", "Zybio Z52")],
    kosong,
  );
  assert.equal(h.pasti.length, 1);
  assert.equal(h.accurate_tanpa_pasangan, 2);
});

test("pasangan pasti tak pernah memakai aset atau alat yang sama dua kali", () => {
  const accs = Array.from({ length: 20 }, (_, i) => acc(i + 1, "ZYBIO Z52", `SN${100000 + i}`));
  const ksos = Array.from({ length: 20 }, (_, i) => kso(i + 1, `SN${100000 + i}`, "Zybio Z52"));
  const h = cocokkan(accs, ksos, kosong);
  assert.equal(h.pasti.length, 20);
  assert.equal(new Set(h.pasti.map((p) => p.accurate_id)).size, 20);
  assert.equal(new Set(h.pasti.map((p) => p.kso_asset_id)).size, 20);
});
