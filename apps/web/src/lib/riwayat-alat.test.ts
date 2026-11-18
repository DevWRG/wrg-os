import assert from "node:assert/strict";
import { test } from "node:test";

import { gantiDariKegiatan, pecahSparepart } from "./riwayat-alat";

test("pecah isian sparepart jadi item", () => {
  assert.deepEqual(pecahSparepart("PSU Z50 Zybio · Board thermal printer"), ["PSU Z50 Zybio", "Board thermal printer"]);
  assert.deepEqual(pecahSparepart("Lampu halogen\nTube 2; Seal"), ["Lampu halogen", "Tube 2", "Seal"]);
  assert.deepEqual(pecahSparepart("Valve 3 Way XP-503V, 2 pcs"), ["Valve 3 Way XP-503V, 2 pcs"]);
  assert.deepEqual(pecahSparepart("-"), []);
  assert.deepEqual(pecahSparepart(null), []);
});

test("isian 'tidak ada' / 0 bukan penggantian", () => {
  for (const x of ["0", "Tidak asa", "tidak ada", "Tdk", "nihil", "N/A", "--"]) assert.deepEqual(pecahSparepart(x), [], x);
  assert.deepEqual(pecahSparepart("0220"), ["0220"]); // kode part, bukan nol
});

test("penggantian yang ditulis di kegiatan", () => {
  assert.deepEqual(gantiDariKegiatan("Ganti lampu, kalibrasi photometer ok"), ["lampu"]);
  assert.deepEqual(gantiDariKegiatan("Cleaning selang, ganti biosensor, running ok"), ["biosensor"]);
  assert.deepEqual(gantiDariKegiatan("Kabel power UPS terbakar (Ganti kabel baru) Alat ready"), ["kabel baru"]);
  assert.deepEqual(gantiDariKegiatan("autogain merah (persiapan ganti cuvette)"), []);
  assert.deepEqual(gantiDariKegiatan("Cmos waktunya ganti"), []);
  assert.deepEqual(gantiDariKegiatan("PM bulanan"), []);
  assert.deepEqual(gantiDariKegiatan("cek lyse habis, lakukan pergantian reagen, prime lancar"), []);
  assert.deepEqual(gantiDariKegiatan("Pergantian filter sedimen, filter CTO"), ["filter sedimen"]);
  assert.deepEqual(gantiDariKegiatan(null), []);
});
