import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATURAN_TIER_DEFAULT,
  aturanTierDariInput,
  bacaDiskonTambahan,
  blokTabelHarga,
  bolehUbahDiskonTambahan,
  diskonEfektif,
  gantiBlokTabel,
  hitungDiskonTambahan,
  klasifikasiTier,
  tierDiskonTotal,
  tierTertinggi,
  totalSph,
} from "./sph-diskon.js";

// Angka sintetis — bukan harga produk sungguhan.
const A = ATURAN_TIER_DEFAULT; // HoD +5 poin, Direktur +10 poin, total 0

test("klasifikasi tier: batas 10% → normal/hod/direktur/tolak", () => {
  assert.equal(klasifikasiTier(0, 0.1, A).tier, "normal");
  assert.equal(klasifikasiTier(0.1, 0.1, A).tier, "normal");
  assert.equal(klasifikasiTier(0.1001, 0.1, A).tier, "hod");
  assert.equal(klasifikasiTier(0.15, 0.1, A).tier, "hod");
  assert.equal(klasifikasiTier(0.1501, 0.1, A).tier, "direktur");
  assert.equal(klasifikasiTier(0.25, 0.1, A).tier, "direktur");
  const t = klasifikasiTier(0.2501, 0.1, A);
  assert.equal(t.tier, "tolak");
  assert.match(t.alasan, /25%/);
  assert.equal(klasifikasiTier(-0.01, 0.1, A).tier, "tolak");
});

test("klasifikasi tier: alasan menyebut peran & batas", () => {
  assert.match(klasifikasiTier(0.12, 0.1, A).alasan, /HoD Business.*15%/);
  assert.match(klasifikasiTier(0.2, 0.1, A).alasan, /Direktur.*25%/);
});

test("klasifikasi tier: jatah 0 → langsung ke jenjang berikut / tolak", () => {
  const tanpaHod = { ...A, tambahanHodPp: 0 };
  assert.equal(klasifikasiTier(0.11, 0.1, tanpaHod).tier, "direktur");
  const tanpaApaPun = { tambahanHodPp: 0, tambahanDirekturPp: 0, diskonTotalMaksPct: 0 };
  assert.equal(klasifikasiTier(0.11, 0.1, tanpaApaPun).tier, "tolak");
});

test("klasifikasi tier: diskon 100% selalu ditolak walau jatah besar", () => {
  const besar = { tambahanHodPp: 60, tambahanDirekturPp: 60, diskonTotalMaksPct: 0 };
  assert.equal(klasifikasiTier(1, 0.2, besar).tier, "tolak");
});

test("tierTertinggi", () => {
  assert.equal(tierTertinggi(), "normal");
  assert.equal(tierTertinggi("normal", "hod", null), "hod");
  assert.equal(tierTertinggi("hod", "direktur", "normal"), "direktur");
});

test("aturanTierDariInput: 0 ≤ x < 100, dibulatkan 2 desimal", () => {
  const ok = aturanTierDariInput(A, { tambahanHodPp: "7.555", diskonTotalMaksPct: 1 });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.aturan.tambahanHodPp, 7.56);
    assert.equal(ok.aturan.tambahanDirekturPp, 10);
    assert.equal(ok.aturan.diskonTotalMaksPct, 1);
  }
  assert.equal(aturanTierDariInput(A, { tambahanDirekturPp: 100 }).ok, false);
  assert.equal(aturanTierDariInput(A, { tambahanHodPp: -1 }).ok, false);
  assert.equal(aturanTierDariInput(A, { tambahanHodPp: "abc" }).ok, false);
  assert.equal(aturanTierDariInput(A, { tambahanHodPp: null }).ok, false);
});

test("bacaDiskonTambahan: validasi bentuk", () => {
  assert.deepEqual(bacaDiskonTambahan(null), { ok: true, d: null });
  assert.deepEqual(bacaDiskonTambahan({ tipe: "persen", nilai: 0 }), { ok: true, d: null });
  assert.deepEqual(bacaDiskonTambahan({ tipe: "persen", nilai: 2.5 }), { ok: true, d: { tipe: "persen", nilai: 2.5 } });
  assert.deepEqual(bacaDiskonTambahan({ tipe: "nominal", nilai: 1000.4 }), { ok: true, d: { tipe: "nominal", nilai: 1000 } });
  assert.equal(bacaDiskonTambahan({ tipe: "persen", nilai: 100 }).ok, false);
  assert.equal(bacaDiskonTambahan({ tipe: "persen", nilai: -1 }).ok, false);
  assert.equal(bacaDiskonTambahan({ tipe: "rupiah", nilai: 1 }).ok, false);
  assert.equal(bacaDiskonTambahan("5%").ok, false);
});

test("hitungDiskonTambahan: persen dibulatkan, nominal tak boleh ≥ subtotal", () => {
  assert.deepEqual(hitungDiskonTambahan(1_000_000, null), { ok: true, rp: 0 });
  assert.deepEqual(hitungDiskonTambahan(1_000_000, { tipe: "persen", nilai: 2.5 }), { ok: true, rp: 25_000 });
  assert.deepEqual(hitungDiskonTambahan(333, { tipe: "persen", nilai: 10 }), { ok: true, rp: 33 });
  assert.deepEqual(hitungDiskonTambahan(1_000_000, { tipe: "nominal", nilai: 50_000 }), { ok: true, rp: 50_000 });
  assert.equal(hitungDiskonTambahan(1_000_000, { tipe: "nominal", nilai: 1_000_000 }).ok, false);
});

const baris = [
  { priceList: 100_000, hargaNett: 90_000, nettPpn: 99_900, qty: 2 },
  { priceList: 50_000, hargaNett: 50_000, nettPpn: 55_500, qty: 1 },
];

test("totalSph tanpa diskon tambahan = Σ nett+PPN per baris (angka lama tak berubah)", () => {
  const t = totalSph(baris);
  assert.equal(t.priceList, 250_000);
  assert.equal(t.nett, 230_000);
  assert.equal(t.diskonTambahan, 0);
  assert.equal(t.dpp, 230_000);
  assert.equal(t.ppn, 255_300);
  assert.equal(t.ppnRp, 25_300);
});

test("totalSph dengan diskon tambahan: PPN dari DPP setelah diskon", () => {
  const t = totalSph(baris, 30_000);
  assert.equal(t.dpp, 200_000);
  assert.equal(t.ppnRp, 22_000);
  assert.equal(t.ppn, 222_000);
});

test("diskonEfektif & tierDiskonTotal (batas = diskon baris + maks total)", () => {
  assert.equal(diskonEfektif(0, 0), 0);
  assert.equal(Math.round(diskonEfektif(250_000, 230_000) * 1000) / 1000, 0.08);
  assert.equal(tierDiskonTotal(totalSph(baris), A), null);
  // 230k → 220k = efektif 12% vs batas 8% + 0 → +4 poin → HoD
  const hod = tierDiskonTotal(totalSph(baris, 10_000), A);
  assert.equal(hod?.tier, "hod");
  // 230k → 190k = 24% → +16 poin → Direktur (8+5 < 24 ≤ 8+15=23? tidak: 24 > 23 → tolak)
  assert.equal(tierDiskonTotal(totalSph(baris, 40_000), A)?.tier, "tolak");
  // 230k → 200k = 20% → +12 poin → Direktur
  assert.equal(tierDiskonTotal(totalSph(baris, 30_000), A)?.tier, "direktur");
  // maks total 5 poin → diskon 10k (efektif +4 poin) normal
  assert.equal(tierDiskonTotal(totalSph(baris, 10_000), { ...A, diskonTotalMaksPct: 5 })?.tier, "normal");
});

test("blokTabelHarga + gantiBlokTabel: blok diganti utuh, sisanya tetap", () => {
  const items = [{ nama: "Produk Uji A", qty: 2, hargaNett: 90_000 }];
  const lama = blokTabelHarga(items, totalSph([baris[0]]));
  const teks = `KOP\n\nPengantar.\n\n${lama}\n\nSyarat & Ketentuan:\n- x`;
  const baru = blokTabelHarga(items, totalSph([baris[0]], 5_000));
  assert.match(baru, /Diskon tambahan: -Rp5\.000/);
  const hasil = gantiBlokTabel(teks, baru);
  assert.ok(hasil);
  assert.ok(hasil!.startsWith("KOP\n\nPengantar.\n\n| No | Produk"));
  assert.ok(hasil!.endsWith("\n\nSyarat & Ketentuan:\n- x"));
  assert.match(hasil!, /Total: Rp194\.250/);
  assert.equal(gantiBlokTabel("teks tanpa tabel", baru), null);
});

test("HoD hanya boleh menurunkan diskon tambahan", () => {
  assert.equal(bolehUbahDiskonTambahan(10_000, 5_000), true);
  assert.equal(bolehUbahDiskonTambahan(10_000, 10_000), true);
  assert.equal(bolehUbahDiskonTambahan(10_000, 10_001), false);
});
