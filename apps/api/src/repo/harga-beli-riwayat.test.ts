import { test } from "node:test";
import assert from "node:assert/strict";
import { awalJendela, perluDetail, type FakturRiwayat } from "./harga-beli-riwayat.js";

test("awal jendela 12 bulan: mundur bulan, tanggal 31 → akhir bulan tujuan, lintas tahun", () => {
  assert.equal(awalJendela("2026-11-17", 12), "2025-11-17");
  assert.equal(awalJendela("2026-03-31", 1), "2026-02-28");
  assert.equal(awalJendela("2024-03-31", 1), "2024-02-29");
  assert.equal(awalJendela("2026-01-15", 2), "2025-11-15");
});

const f = (o: Partial<FakturRiwayat> = {}): FakturRiwayat =>
  ({ accurate_id: 7, number: "PI-7", trans_date: "2026-05-01", vendor_name: "V", last_update: "2026-05-02T10:00:00+07:00", ...o });

test("perlu detail: hanya faktur di [dari, sampai) yang baru / lastUpdate-nya berubah", () => {
  const kosong = new Map<number, string | null>();
  assert.equal(perluDetail(f(), "2025-11-17", "2026-10-01", kosong), true);
  assert.equal(perluDetail(f({ trans_date: "2026-10-01" }), "2025-11-17", "2026-10-01", kosong), false, "masuk cakupan cermin F152");
  assert.equal(perluDetail(f({ trans_date: "2025-11-16" }), "2025-11-17", "2026-10-01", kosong), false, "di luar 12 bulan");
  // sama persis walau format zona beda (Postgres mengembalikan +07 / UTC) → tak ditarik ulang
  assert.equal(perluDetail(f(), "2025-11-17", "2026-10-01", new Map([[7, "2026-05-02 03:00:00+00"]])), false);
  assert.equal(perluDetail(f(), "2025-11-17", "2026-10-01", new Map([[7, "2026-05-01 03:00:00+00"]])), true, "diubah di Accurate");
  assert.equal(perluDetail(f({ last_update: null }), "2025-11-17", "2026-10-01", new Map([[7, "2026-05-02 03:00:00+00"]])), true);
});
