import { test } from "node:test";
import assert from "node:assert/strict";

import { hitungJadwal } from "./asetTetap.js";

// Contoh nyata dari probe prod (KSO-1167, 12 Okt 2026): Rp 2.900.000, 48 bulan,
// garis lurus, residu 0, mulai 09/10/2026.
const ro = {
  depreciation_method: "STRAIGHTLINE",
  current_asset_cost: 2_900_000,
  residu: 0,
  current_estimated_life: 48,
  current_start_date: "2026-10-09",
};

test("jadwal garis lurus: panjang = umur, akumulasi akhir = cost − residu", () => {
  const j = hitungJadwal(ro);
  assert.equal(j.length, 48);
  assert.equal(j[0].periode, "2026-10");
  assert.equal(j[47].periode, "2030-09");
  assert.equal(j[47].akumulasi, 2_900_000);
  assert.equal(j[47].nilai_buku, 0);
});

test("selisih pembulatan ditaruh di bulan terakhir", () => {
  const j = hitungJadwal(ro); // 2.900.000 / 48 = 60.416,67
  assert.equal(j[0].susut, 60_417);
  assert.equal(j[47].susut, 2_900_000 - 60_417 * 47);
  assert.equal(j.reduce((s, x) => s + x.susut, 0), 2_900_000);
});

test("residu dikurangkan dari basis", () => {
  const j = hitungJadwal({ ...ro, residu: 500_000, current_estimated_life: 24 });
  assert.equal(j[23].akumulasi, 2_400_000);
  assert.equal(j[23].nilai_buku, 500_000);
});

test("lintas tahun: Desember → Januari", () => {
  const j = hitungJadwal({ ...ro, current_start_date: "2024-12-31", current_estimated_life: 3 });
  assert.deepEqual(j.map((x) => x.periode), ["2024-12", "2025-01", "2025-02"]);
  assert.ok(j.every((x) => x.status === "lewat"));
});

test("status proyeksi untuk bulan jauh di depan", () => {
  const j = hitungJadwal({ ...ro, current_start_date: "2099-01-01", current_estimated_life: 2 });
  assert.ok(j.every((x) => x.status === "proyeksi"));
});

test("tak menebak: metode lain / umur 0 / tanggal kosong / basis ≤ 0 → jadwal kosong", () => {
  assert.deepEqual(hitungJadwal({ ...ro, depreciation_method: "DOUBLEDECLINING" }), []);
  assert.deepEqual(hitungJadwal({ ...ro, current_estimated_life: 0 }), []);
  assert.deepEqual(hitungJadwal({ ...ro, current_start_date: null }), []);
  assert.deepEqual(hitungJadwal({ ...ro, residu: 2_900_000 }), []);
});
