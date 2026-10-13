import { test } from "node:test";
import assert from "node:assert/strict";

import { CampaignError, barisProgres, hariIniWib, hitungPacing, rpWa, statusKampanye, tglPendek, validasiKampanye } from "./campaign.js";

// F74 Campaign Tracker — bagian murni (tanpa DB).

test("statusKampanye: akan datang / berjalan (termasuk hari terakhir) / selesai / dibatalkan", () => {
  const c = { tanggal_mulai: "2026-10-01", tanggal_selesai: "2026-12-31", dibatalkan: false };
  assert.equal(statusKampanye(c, "2026-09-30"), "akan datang");
  assert.equal(statusKampanye(c, "2026-10-01"), "berjalan");
  assert.equal(statusKampanye(c, "2026-12-31"), "berjalan");
  assert.equal(statusKampanye(c, "2027-01-01"), "selesai");
  assert.equal(statusKampanye({ ...c, dibatalkan: true }, "2026-10-13"), "dibatalkan");
});

test("hitungPacing: linier per hari kalender, toleransi ±10 poin", () => {
  // 1 Okt–31 Des = 92 hari; 13 Okt = hari ke-13 → harapan 14,1%
  const p = hitungPacing(1_000, 141, "2026-10-01", "2026-12-31", "2026-10-13");
  assert.equal(p.hari_ke, 13);
  assert.equal(p.hari_total, 92);
  assert.equal(p.harapan_pct, 14.1);
  assert.equal(p.capai_pct, 14.1);
  assert.equal(p.status, "sesuai");
  assert.equal(hitungPacing(1_000, 300, "2026-10-01", "2026-12-31", "2026-10-13").status, "di depan");
  assert.equal(hitungPacing(1_000, 10, "2026-10-01", "2026-12-31", "2026-10-13").status, "tertinggal");
});

test("hitungPacing: belum mulai, sudah lewat, dan tanpa target", () => {
  const belum = hitungPacing(1_000, 0, "2026-11-01", "2026-11-30", "2026-10-13");
  assert.equal(belum.hari_ke, 0);
  assert.equal(belum.status, null);
  const lewat = hitungPacing(1_000, 500, "2026-09-01", "2026-09-30", "2026-10-13");
  assert.equal(lewat.hari_ke, 30);
  assert.equal(lewat.harapan_pct, 100);
  assert.equal(lewat.status, "tertinggal");
  const tanpa = hitungPacing(0, 500, "2026-10-01", "2026-10-31", "2026-10-13");
  assert.equal(tanpa.capai_pct, null);
  assert.equal(tanpa.status, null);
});

test("validasiKampanye: normalisasi brand/item/target", () => {
  const v = validasiKampanye({
    nama: "  Vivachek   Q4 ", tanggal_mulai: "2026-10-01", tanggal_selesai: "2026-12-31",
    brands: ["VIVACHEK", "vivachek ", "VIVACHEK"], item_ids: ["12", 12, "x", -1], satuan_qty: "box",
    targets: [
      { am_id: "501", target_rp: "500.000.000", target_qty: 1000 },
      { am_id: "502", target_rp: "", target_qty: "" }, // baris kosong = tanpa target
    ],
  });
  assert.equal(v.nama, "Vivachek Q4");
  assert.deepEqual(v.brands, ["VIVACHEK", "vivachek"]);
  assert.deepEqual(v.item_ids, [12]);
  assert.deepEqual(v.targets, [{ am_id: "501", target_rp: 500_000_000, target_qty: 1000 }]);
});

test("validasiKampanye: menolak input yang tak sah", () => {
  const dasar = { nama: "X", tanggal_mulai: "2026-10-01", tanggal_selesai: "2026-10-31", brands: ["ZYBIO"] };
  const tolak = (b: Record<string, unknown>, pesan: RegExp) =>
    assert.throws(() => validasiKampanye(b), (e: unknown) => e instanceof CampaignError && e.status === 400 && pesan.test(e.message));
  tolak({ ...dasar, nama: "  " }, /nama/);
  tolak({ ...dasar, tanggal_mulai: "2026-02-30" }, /tanggal/);
  tolak({ ...dasar, tanggal_selesai: "2026-09-30" }, /sebelum/);
  tolak({ ...dasar, tanggal_selesai: "2027-12-31" }, /1 tahun/);
  tolak({ ...dasar, brands: [], item_ids: [] }, /minimal satu/);
  tolak({ ...dasar, targets: [{ am_id: "501", target_rp: -5 }] }, /Rupiah/);
  tolak({ ...dasar, targets: [{ am_id: "501", target_rp: 5, target_qty: 10 }] }, /satuan/);
  tolak({ ...dasar, targets: [{ am_id: "501", target_rp: 5 }, { am_id: "501", target_rp: 6 }] }, /ganda/);
});

test("format WA: Rupiah, tanggal, baris progres", () => {
  assert.equal(rpWa(1_234_000_000), "Rp 1,23 M");
  assert.equal(rpWa(120_400_000), "Rp 120 jt");
  assert.equal(tglPendek("2026-10-01"), "1 Okt");
  // 24% vs harapan 14,1% = +9,9 poin → masih "sesuai"; 26% = +11,9 → "di depan".
  const p = hitungPacing(500_000_000, 120_000_000, "2026-10-01", "2026-12-31", "2026-10-13");
  assert.equal(barisProgres(500_000_000, 120_000_000, p), "Rp 120 jt / Rp 500 jt (24%) · harapan 14,1% · 🟡 sesuai");
  const q = hitungPacing(500_000_000, 130_000_000, "2026-10-01", "2026-12-31", "2026-10-13");
  assert.equal(barisProgres(500_000_000, 130_000_000, q), "Rp 130 jt / Rp 500 jt (26%) · harapan 14,1% · ✅ di depan");
  assert.equal(barisProgres(0, 5_000_000, p), "Rp 5 jt (tanpa target)");
});

test("hariIniWib: lewat tengah malam WIB sudah hari berikutnya", () => {
  assert.equal(hariIniWib(new Date("2026-10-12T17:30:00Z")), "2026-10-13");
  assert.equal(hariIniWib(new Date("2026-10-12T16:59:00Z")), "2026-10-12");
});
