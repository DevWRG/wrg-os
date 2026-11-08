import assert from "node:assert/strict";
import { test } from "node:test";

import { ATURAN_TIER_DEFAULT, hitungBaris, hitungDiskonTambahan, klasifikasiTier, ringkasSph } from "./sph-hitung";

test("hitungBaris: nett & PPN dibulatkan spt server", () => {
  const h = hitungBaris({ priceList: 1000, diskonMaks: 0.1, qty: 3, diskonPersen: 5 });
  assert.equal(h.hargaNett, 950);
  assert.equal(h.nettPpn, 1055); // 950 × 1,11 = 1054,5 → 1055
  assert.equal(h.jumlah, 2850);
  assert.equal(h.jumlahPpn, 3165);
  assert.equal(h.masalahQty, null);
  assert.equal(h.masalahDiskon, null);
});

test("hitungBaris: diskon di atas batas & negatif ditandai", () => {
  assert.match(hitungBaris({ priceList: 1000, diskonMaks: 0.1, qty: 1, diskonPersen: 12 }).masalahDiskon ?? "", /Maks\. diskon 10%/);
  assert.match(hitungBaris({ priceList: 1000, diskonMaks: 0.1, qty: 1, diskonPersen: -1 }).masalahDiskon ?? "", /negatif/);
  // tepat di batas boleh (termasuk pecahan dari fraksi DB)
  assert.equal(hitungBaris({ priceList: 1000, diskonMaks: 0.075, qty: 1, diskonPersen: 7.5 }).masalahDiskon, null);
});

test("hitungBaris: qty tidak sah → jumlah 0 + pesan", () => {
  for (const qty of [0, -2, 1.5, Number.NaN]) {
    const h = hitungBaris({ priceList: 1000, diskonMaks: 0.1, qty, diskonPersen: 0 });
    assert.equal(h.jumlah, 0);
    assert.ok(h.masalahQty);
  }
});

test("ringkasSph: subtotal, PPN, total, hemat, adaMasalah", () => {
  const r = ringkasSph([
    { priceList: 1000, diskonMaks: 0.1, qty: 2, diskonPersen: 10 },
    { priceList: 500, diskonMaks: 0, qty: 1, diskonPersen: 0 },
  ]);
  assert.equal(r.subtotal, 900 * 2 + 500);
  assert.equal(r.total, 999 * 2 + 555);
  assert.equal(r.ppn, r.total - r.subtotal);
  assert.equal(r.hemat, 200);
  assert.equal(r.adaMasalah, false);
  assert.equal(ringkasSph([{ priceList: 1, diskonMaks: 0, qty: 1, diskonPersen: 5 }]).adaMasalah, true);
});

test("pratinjauNomorSph: format, reset tahunan, validasi", async () => {
  const { pratinjauNomorSph } = await import("./sph-hitung");
  const nov = new Date("2026-11-08T03:00:00Z");
  assert.deepEqual(pratinjauNomorSph({ kodeTengah: "ABC.X-1", nomorBerikutnya: 42, resetTahunan: false, tahunBerjalan: 2026 }, nov), {
    nomor: "00042/ABC.X-1/XI/2026",
    masalah: null,
  });
  // reset tahunan & tahun berganti → mulai 1
  assert.equal(
    pratinjauNomorSph({ kodeTengah: "K", nomorBerikutnya: 42, resetTahunan: true, tahunBerjalan: 2025 }, nov).nomor,
    "00001/K/XI/2026",
  );
  // 31 Des 20:00 UTC = 1 Jan WIB → tahun & bulan ikut WIB
  assert.equal(
    pratinjauNomorSph({ kodeTengah: "K", nomorBerikutnya: 7, resetTahunan: false, tahunBerjalan: null }, new Date("2026-12-31T20:00:00Z")).nomor,
    "00007/K/I/2027",
  );
  assert.ok(pratinjauNomorSph({ kodeTengah: "A/B", nomorBerikutnya: 1, resetTahunan: false, tahunBerjalan: null }).masalah);
  assert.ok(pratinjauNomorSph({ kodeTengah: "A", nomorBerikutnya: 0, resetTahunan: false, tahunBerjalan: null }).masalah);
  assert.ok(pratinjauNomorSph({ kodeTengah: "A", nomorBerikutnya: 1.5, resetTahunan: false, tahunBerjalan: null }).masalah);
});

// ── Diskon berjenjang & diskon tambahan (migrasi 301) — angka sintetis ──

const A = ATURAN_TIER_DEFAULT;

test("hitungBaris + aturan: jenjang normal/hod/direktur/tolak", () => {
  const b = { priceList: 1000, diskonMaks: 0.1, qty: 1 };
  assert.equal(hitungBaris({ ...b, diskonPersen: 10 }, A).tier, "normal");
  const hod = hitungBaris({ ...b, diskonPersen: 12 }, A);
  assert.equal(hod.tier, "hod");
  assert.equal(hod.masalahDiskon, null); // boleh diajukan
  assert.match(hod.alasanTier, /HoD Business/);
  assert.equal(hitungBaris({ ...b, diskonPersen: 25 }, A).tier, "direktur");
  const tolak = hitungBaris({ ...b, diskonPersen: 26 }, A);
  assert.equal(tolak.tier, "tolak");
  assert.ok(tolak.masalahDiskon);
});

test("klasifikasiTier web = server (batas 7,5% + 5 + 10)", () => {
  assert.equal(klasifikasiTier(0.125, 0.075, A).tier, "hod");
  assert.equal(klasifikasiTier(0.1251, 0.075, A).tier, "direktur");
  assert.equal(klasifikasiTier(0.2251, 0.075, A).tier, "tolak");
});

test("hitungDiskonTambahan: persen/nominal & validasi", () => {
  assert.deepEqual(hitungDiskonTambahan(1000, null), { rp: 0, masalah: null });
  assert.deepEqual(hitungDiskonTambahan(1000, { tipe: "persen", nilai: 2.5 }), { rp: 25, masalah: null });
  assert.deepEqual(hitungDiskonTambahan(1000, { tipe: "nominal", nilai: 100 }), { rp: 100, masalah: null });
  assert.ok(hitungDiskonTambahan(1000, { tipe: "nominal", nilai: 1000 }).masalah);
  assert.ok(hitungDiskonTambahan(1000, { tipe: "persen", nilai: 100 }).masalah);
});

test("ringkasSph + diskon tambahan: PPN dari DPP, jenjang diskon tambahan", () => {
  const baris = [
    { priceList: 100_000, diskonMaks: 0.1, qty: 2, diskonPersen: 10 },
    { priceList: 50_000, diskonMaks: 0, qty: 1, diskonPersen: 0 },
  ];
  const tanpa = ringkasSph(baris, { aturan: A });
  assert.equal(tanpa.total, 99_900 * 2 + 55_500);
  assert.equal(tanpa.tier, "normal");
  const r = ringkasSph(baris, { aturan: A, diskonTambahan: { tipe: "nominal", nilai: 30_000 } });
  assert.equal(r.subtotal, 230_000);
  assert.equal(r.dpp, 200_000);
  assert.equal(r.ppn, 22_000);
  assert.equal(r.total, 222_000);
  assert.equal(r.tierTambahan, "direktur"); // 8% → 20% = +12 poin
  assert.equal(r.tier, "direktur");
  assert.equal(r.adaMasalah, false);
  assert.equal(ringkasSph(baris, { aturan: A, diskonTambahan: { tipe: "nominal", nilai: 10_000 } }).tierTambahan, "hod");
  const tolak = ringkasSph(baris, { aturan: A, diskonTambahan: { tipe: "nominal", nilai: 40_000 } });
  assert.equal(tolak.tierTambahan, "tolak");
  assert.equal(tolak.adaMasalah, true);
  assert.ok(tolak.masalahTambahan);
});
