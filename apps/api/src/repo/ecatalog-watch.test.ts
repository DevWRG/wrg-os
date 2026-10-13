// F72 E-Catalog Recovery Watch — logika murni: status faskes & deret tren.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { statusEcat, susunTren, AMBANG, JALUR_LAIN_HARI } from "./ecatalog-watch.js";

test("status bertingkat 30/60/90 (keputusan user 13 Okt)", () => {
  assert.equal(statusEcat(0, null), "aktif");
  assert.equal(statusEcat(30, null), "aktif");
  assert.equal(statusEcat(31, null), "waspada");
  assert.equal(statusEcat(60, null), "waspada");
  assert.equal(statusEcat(61, null), "berisiko");
  assert.equal(statusEcat(90, null), "berisiko");
  assert.equal(statusEcat(91, null), "kolaps");
  assert.deepEqual(AMBANG, { aktif: 30, waspada: 60, berisiko: 90 });
});

test("pindah jalur: PJE lewat 60 hari tapi masih beli non-PJE ≤60 hari", () => {
  assert.equal(statusEcat(120, 10), "pindah_jalur");
  assert.equal(statusEcat(75, JALUR_LAIN_HARI), "pindah_jalur");
  // non-PJE juga sudah lama → tetap kolaps
  assert.equal(statusEcat(120, 61), "kolaps");
  // PJE masih segar → status biasa walau ada faktur lain
  assert.equal(statusEcat(45, 5), "waspada");
  assert.equal(statusEcat(10, 2), "aktif");
  // faktur non-PJE yang LEBIH LAMA dari PJE terakhir bukan pindah jalur
  assert.equal(statusEcat(70, 80), "berisiko");
});

test("susunTren: N bulan berakhir di bulan berjalan (WIB), bulan kosong = 0, pembanding tahun lalu", () => {
  const m = new Map([
    ["2025-10", { faktur: 56, faskes: 44, netto: 8198 }],
    ["2026-09", { faktur: 64, faskes: 46, netto: 1009 }],
    ["2026-10", { faktur: 35, faskes: 27, netto: 510 }],
  ]);
  // 31 Okt 2026 20:00 UTC = 1 Nov WIB → bulan berjalan November
  const t = susunTren(m, new Date("2026-10-31T20:00:00Z"), 3);
  assert.deepEqual(t.map((x) => x.bulan), ["2026-09", "2026-10", "2026-11"]);
  assert.equal(t[1].netto, 510);
  assert.equal(t[1].netto_tahun_lalu, 8198);
  assert.equal(t[2].faktur, 0);
});
