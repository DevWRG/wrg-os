import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AMBANG_POIN,
  MIN_DEAL,
  TANPA_BRAND,
  TANPA_REGION,
  hitungScorecard,
  kuartalDari,
  regionDariCabang,
  rentangKuartal,
  statusSel,
  type DealTerminal,
} from "./pmf-scorecard.js";

const deal = (o: Partial<DealTerminal> & { menang: boolean }): DealTerminal => ({
  brand: "Zybio",
  region: "East",
  impor: false,
  tanggal_dari_log: true,
  alasan_kalah: "harga",
  ...o,
});
const banyak = (n: number, o: Partial<DealTerminal> & { menang: boolean }) => Array.from({ length: n }, () => deal(o));

test("kuartal dari tanggal & rentangnya", () => {
  assert.deepEqual(kuartalDari("2026-01-01"), { tahun: 2026, kuartal: 1 });
  assert.deepEqual(kuartalDari("2026-03-31"), { tahun: 2026, kuartal: 1 });
  assert.deepEqual(kuartalDari("2026-04-01"), { tahun: 2026, kuartal: 2 });
  assert.deepEqual(kuartalDari("2026-12-31"), { tahun: 2026, kuartal: 4 });
  assert.deepEqual(rentangKuartal(2026, 1), { dari: "2026-01-01", sampai: "2026-03-31" });
  assert.deepEqual(rentangKuartal(2026, 2), { dari: "2026-04-01", sampai: "2026-06-30" });
  assert.deepEqual(rentangKuartal(2024, 1), { dari: "2024-01-01", sampai: "2024-03-31" });
  assert.deepEqual(rentangKuartal(2026, 4), { dari: "2026-10-01", sampai: "2026-12-31" });
});

test("ambang: n<5 DATA KURANG, tepat ±10 poin sudah MENANG/KALAH", () => {
  assert.equal(MIN_DEAL, 5);
  assert.equal(AMBANG_POIN, 10);
  assert.equal(statusSel(4, 100, 50), "DATA KURANG");
  assert.equal(statusSel(5, 60, 50), "MENANG");
  assert.equal(statusSel(5, 59.9, 50), "NETRAL");
  assert.equal(statusSel(5, 40, 50), "KALAH");
  assert.equal(statusSel(5, 40.1, 50), "NETRAL");
  assert.equal(statusSel(10, null, 50), "DATA KURANG");
  assert.equal(statusSel(10, 50, null), "DATA KURANG");
});

test("OFFICE & cabang tak dikenal = Tanpa region; East/West dari peta, tak peka huruf", () => {
  const peta = { SURABAYA: "East", JAKARTA: "West", OFFICE: "OFFICE" };
  assert.equal(regionDariCabang(" surabaya ", peta), "East");
  assert.equal(regionDariCabang("Jakarta", peta), "West");
  assert.equal(regionDariCabang("OFFICE", peta), TANPA_REGION);
  assert.equal(regionDariCabang("Medan", peta), TANPA_REGION);
  assert.equal(regionDariCabang(null, peta), TANPA_REGION);
});

test("deal impor dikeluarkan dari hitungan tapi dilaporkan", () => {
  const sc = hitungScorecard(
    [...banyak(5, { menang: true }), ...banyak(3, { menang: false }), ...banyak(4, { menang: true, impor: true })],
    2026,
    3,
  );
  assert.equal(sc.ringkasan.n, 8);
  assert.equal(sc.ringkasan.won, 5);
  assert.equal(sc.ringkasan.impor_dikeluarkan, 4);
  assert.equal(sc.ringkasan.win_rate, 62.5);
});

test("sel brand x region: status relatif terhadap portofolio, n tampil", () => {
  const sc = hitungScorecard(
    [
      ...banyak(5, { brand: "Zybio", region: "East", menang: true }), // 100%
      ...banyak(5, { brand: "Zybio", region: "West", menang: false }), // 0%
      ...banyak(3, { brand: "Mindray", region: "East", menang: true }), // n<5
    ],
    2026,
    3,
  );
  // portofolio 8/13 = 61.5%
  const cari = (b: string, r: string) => sc.sel.find((s) => s.brand === b && s.region === r)!;
  assert.equal(cari("Zybio", "East").status, "MENANG");
  assert.equal(cari("Zybio", "West").status, "KALAH");
  assert.equal(cari("Mindray", "East").status, "DATA KURANG");
  assert.equal(cari("Mindray", "East").n, 3);
  assert.equal(sc.per_brand.find((s) => s.brand === "Zybio")!.n, 10);
  assert.equal(sc.per_brand.find((s) => s.brand === "Zybio")!.region, "Semua region");
});

test("brand kosong → (tanpa brand); lost tanpa alasan dihitung, tidak disembunyikan", () => {
  const sc = hitungScorecard(
    [
      deal({ brand: null, menang: false, alasan_kalah: null }),
      deal({ brand: "  ", menang: false, alasan_kalah: null }),
      deal({ brand: null, menang: false }),
      deal({ brand: "Zybio", menang: true }),
    ],
    2026,
    3,
  );
  const tb = sc.sel.find((s) => s.brand === TANPA_BRAND)!;
  assert.equal(tb.n, 3);
  assert.equal(tb.lost_tanpa_alasan, 2);
  assert.equal(sc.ringkasan.lost_tanpa_alasan, 2);
});

test("tanpa region & tanggal fallback ikut dilaporkan; kosong tidak dibagi nol", () => {
  const sc = hitungScorecard(
    [deal({ menang: true, region: TANPA_REGION, tanggal_dari_log: false }), deal({ menang: false })],
    2026,
    3,
  );
  assert.equal(sc.ringkasan.tanpa_region, 1);
  assert.equal(sc.ringkasan.tanggal_fallback, 1);

  const kosong = hitungScorecard([], 2026, 3);
  assert.equal(kosong.ringkasan.n, 0);
  assert.equal(kosong.ringkasan.win_rate, null);
  assert.deepEqual(kosong.sel, []);
});
