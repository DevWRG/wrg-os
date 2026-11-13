// Angka di sini REKAAN (repo publik) — hanya menguji bentuk rumus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hitungMargin, hitungProyeksi, marginAwal, proyeksiAwal, setExPpn, type MarginInput, type ProyeksiInput } from "./simulator";

const PX: ProyeksiInput = { mesin: 10, shift: 2, hari: 24, tarif_klaim: 1000, mode: "bagi_hasil", porsi_pct: 50, harga_tetap: 300 };

const NOL: MarginInput = {
  needle: 0, circuit: 0, bicarb: 0, acid: 0, dialyzer: 0, harga_mesin: 0, ro: 0,
  mesin: 10, backup: 0, tindakan_per_hari: 2, hari: 25, tenor: 2, pendapatan: 1000, share_pct: 100,
  gaji_teknisi: 0, fee_dpjp: 0, kirim: 0, lab_air: 0, diklat: 0, kalibrasi: 0, pitnas: 0, renovasi: 0,
  lain_per_tindakan: 0, lain_harian: 0, lain_bln: 0, min_pct: 15,
};

test("proyeksi: tindakan = mesin × shift × hari; pasien = tindakan ÷ 11", () => {
  const r = hitungProyeksi(PX);
  assert.equal(r.tindakan_bln, 480);
  assert.equal(r.pasien_tetap, 44);
  assert.equal(r.klaim_rs_bln, 480_000);
  assert.equal(r.omset_wahana_bln, 240_000);
  assert.equal(r.omset_wahana_thn, 2_880_000);
  assert.equal(hitungProyeksi({ ...PX, mode: "harga_tetap" }).omset_wahana_bln, 144_000);
});

test("proyeksi: indikator kesehatan", () => {
  assert.equal(hitungProyeksi({ ...PX, mesin: 5 }).kesehatan, "kurang_tindakan");
  assert.equal(hitungProyeksi({ ...PX, mesin: 20, shift: 1.5 }).kesehatan, "kurang_shift");
  assert.equal(hitungProyeksi(PX).kesehatan, "sehat");
});

test("margin: tanpa biaya, margin = pendapatan × share", () => {
  const r = hitungMargin(NOL);
  assert.equal(r.tindakan_bln, 500);
  assert.equal(r.tindakan_tenor, 12_000);
  assert.equal(r.margin_per_tindakan, 1000);
  assert.equal(r.margin_pct, 1);
  assert.equal(hitungMargin({ ...NOL, share_pct: 50 }).pendapatan_per_tindakan, 500);
});

test("margin: consumable kena PPN, needle ×2; alat dibagi tindakan selama tenor", () => {
  assert.equal(setExPpn({ ...NOL, needle: 10, dialyzer: 100 }), 120);
  const r = hitungMargin({ ...NOL, needle: 10, dialyzer: 100 });
  assert.ok(Math.abs(r.biaya_set - 120 * 1.11) < 1e-9);
  const a = hitungMargin({ ...NOL, harga_mesin: 12_000, backup: 0, ro: 0 });
  assert.ok(Math.abs(a.biaya_alat - (10 * 12_000 * 1.11) / 12_000) < 1e-9);
});

test("margin: biaya lain harian/bulanan dibagi tindakan; kalibrasi mulai tahun ke-2", () => {
  const r = hitungMargin({ ...NOL, lain_harian: 200, lain_bln: 500, lain_per_tindakan: 3 });
  assert.ok(Math.abs(r.biaya_ops - (200 / 20 + 500 / 500 + 3)) < 1e-9);
  const k = hitungMargin({ ...NOL, kalibrasi: 1200 });
  assert.ok(Math.abs(k.biaya_ops - (10 * 1 * 1200) / 12_000) < 1e-9);
});

test("margin: layak bila margin % ≥ ambang", () => {
  // 1000 − 800×1,11 = 112 → margin 11,2%
  assert.equal(hitungMargin({ ...NOL, dialyzer: 800, min_pct: 10 }).layak, true);
  assert.equal(hitungMargin({ ...NOL, dialyzer: 800, min_pct: 15 }).layak, false);
});

test("nilai awal dari parameter: kunci kosong = 0 + dilaporkan", () => {
  const p = proyeksiAwal({ rs_mesin: 10, rs_shift: 2, rs_hari: 24, rs_tarif_klaim: null });
  assert.equal(p.input.tarif_klaim, 0);
  assert.deepEqual(p.kosong, ["tarif_klaim", "porsi_pct", "harga_tetap"]);
  const m = marginAwal({ margin_mesin: 30 });
  assert.equal(m.input.mesin, 30);
  assert.ok(m.kosong.includes("dialyzer"));
});
