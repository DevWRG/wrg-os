import { test } from "node:test";
import assert from "node:assert/strict";
import { agregatKelompok, angka, kuartalDari, median, validasiPermintaan, type BarisAnalisa, type Param } from "./permintaan-produk.js";

const HARI = "2026-10-21";
const P: Param = { kandidat_min_faskes: 3, kandidat_hari: 90, kandidat_min_potensi: 250_000_000, sla_hari_kerja: 1 };
const isian = (o: Record<string, unknown> = {}) => ({ produk_diminta: "HbA1c FIA", faskes_nama: "RSUD Uji", pengaju: "AM Uji", ...o });

test("validasi: produk, faskes, pengaju wajib; tanggal default hari ini & tak boleh masa depan", () => {
  assert.match((validasiPermintaan({ faskes_nama: "x", pengaju: "y" }, HARI) as { pesan: string }).pesan, /produk/);
  assert.match((validasiPermintaan(isian({ faskes_nama: " " }), HARI) as { pesan: string }).pesan, /Faskes/);
  assert.match((validasiPermintaan(isian({ pengaju: "" }), HARI) as { pesan: string }).pesan, /Pengaju/);
  const ok = validasiPermintaan(isian(), HARI);
  assert.ok(ok.ok && ok.isi.tanggal_minta === HARI && ok.isi.cek_master === "belum_dicek" && ok.isi.sumber === "lainnya");
  assert.match((validasiPermintaan(isian({ tanggal_minta: "2026-10-22" }), HARI) as { pesan: string }).pesan, /masa depan/);
});

test("validasi: cek master ada/substitusi wajib SKU; belum ada membuang SKU", () => {
  assert.match((validasiPermintaan(isian({ cek_master: "substitusi" }), HARI) as { pesan: string }).pesan, /SKU/);
  const v = validasiPermintaan(isian({ cek_master: "belum_ada", sku_kode: "01.02.03.004.0005" }), HARI);
  assert.ok(v.ok && v.isi.sku_kode === null);
  const w = validasiPermintaan(isian({ cek_master: "ada", sku_kode: "01.02.03.004.0005" }), HARI);
  assert.ok(w.ok && w.isi.sku_kode === "01.02.03.004.0005");
});

test("validasi: qty harus > 0, harga angka; format ribuan Indonesia dibaca", () => {
  assert.match((validasiPermintaan(isian({ qty_bulan: 0 }), HARI) as { pesan: string }).pesan, /Qty/);
  assert.match((validasiPermintaan(isian({ harga_satuan: "abc" }), HARI) as { pesan: string }).pesan, /Harga/);
  const v = validasiPermintaan(isian({ qty_bulan: "12,5", harga_satuan: "1.250.000" }), HARI);
  assert.ok(v.ok && v.isi.qty_bulan === 12.5 && v.isi.harga_satuan === 1_250_000);
  assert.equal(angka("-5"), null);
  assert.equal(angka("18.5"), 18.5);
});

test("kuartal & median", () => {
  assert.equal(kuartalDari("2026-10-21"), "2026-Q4");
  assert.equal(kuartalDari("2026-03-31"), "2026-Q1");
  assert.equal(kuartalDari("2026-07-01"), "2026-Q3");
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

const b = (o: Partial<BarisAnalisa>): BarisAnalisa => ({
  kelompok_id: 1, tanggal_minta: "2026-10-01", faskes_kunci: "a:1", cek_master: "belum_ada", qty_bulan: 100, harga_satuan: 80_000,
  dicatat_at: "2026-10-01T03:00:00Z", ...o,
});

test("agregat: tiga faskes berangka cukup → kandidat; potensi = qty × harga × 12 per faskes", () => {
  const a = agregatKelompok([b({ faskes_kunci: "a:1" }), b({ faskes_kunci: "a:2" }), b({ faskes_kunci: "n:klinik x" })], P, HARI);
  assert.equal(a.faskes_unik, 3);
  assert.equal(a.potensi_tahun, 3 * 100 * 80_000 * 12); // 288 jt
  assert.equal(a.kandidat, true);
});

test("agregat: faskes yang meminta berulang dihitung SEKALI — memakai permintaan terbarunya", () => {
  const a = agregatKelompok([
    b({ faskes_kunci: "a:1", tanggal_minta: "2026-09-01", qty_bulan: 1000 }),
    b({ faskes_kunci: "a:1", tanggal_minta: "2026-10-10", qty_bulan: 50 }),
  ], P, HARI);
  assert.equal(a.permintaan, 2);
  assert.equal(a.faskes_unik, 1);
  assert.equal(a.potensi_tahun, 50 * 80_000 * 12);
  assert.equal(a.kandidat, false);
});

test("agregat: baris 'ada' & di luar jendela tidak ikut; tanpa angka = potensi NULL, bukan 0", () => {
  const a = agregatKelompok([
    b({ faskes_kunci: "a:1", cek_master: "ada" }),
    b({ faskes_kunci: "a:2", tanggal_minta: "2026-07-01" }), // > 90 hari sebelum 21 Okt
    b({ faskes_kunci: "a:3", qty_bulan: null }),
  ], P, HARI);
  assert.equal(a.permintaan, 1);
  assert.equal(a.potensi_tahun, null);
  assert.equal(a.faskes_tanpa_angka, 1);
  assert.equal(a.kandidat, false);
});

test("agregat: banyak faskes tapi potensi di bawah ambang → bukan kandidat; ambang dari parameter", () => {
  const rows = ["a:1", "a:2", "a:3", "a:4"].map((f) => b({ faskes_kunci: f, qty_bulan: 10 }));
  assert.equal(agregatKelompok(rows, P, HARI).kandidat, false); // 4 × 10 × 80rb × 12 = 38,4 jt
  assert.equal(agregatKelompok(rows, { ...P, kandidat_min_potensi: 30_000_000 }, HARI).kandidat, true);
  assert.equal(agregatKelompok(rows, { ...P, kandidat_min_potensi: 30_000_000, kandidat_min_faskes: 5 }, HARI).kandidat, false);
});
