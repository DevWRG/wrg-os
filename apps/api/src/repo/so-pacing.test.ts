import assert from "node:assert/strict";
import { test } from "node:test";

import { AMBANG_MERAH, formatWaPacing, nilaiPacing, statusDariPct, type SoPacing } from "./so-pacing.js";
import { wibToday } from "./watchpoint-week.js";

test("target diprorata HARI KERJA, capaian = faktur + SO terbuka", () => {
  const h = nilaiPacing({ targetBulan: 2_200_000_000, hariKerjaBulan: 22, hariKerjaLewat: 11, faktur: 400_000_000, soTerbuka: 150_000_000 });
  assert.equal(h.target_prorata, 1_100_000_000);
  assert.equal(h.capaian, 550_000_000);
  assert.equal(h.pct_pacing, 50);
  assert.equal(h.pct_bulan, 25);
  assert.equal(h.status, "KUNING"); // tepat 50% belum merah
});

test("ambang: <50 merah, <80 kuning, ≥80 hijau", () => {
  assert.equal(AMBANG_MERAH, 50);
  assert.equal(statusDariPct(49.9), "MERAH");
  assert.equal(statusDariPct(50), "KUNING");
  assert.equal(statusDariPct(79.9), "KUNING");
  assert.equal(statusDariPct(80), "HIJAU");
  assert.equal(statusDariPct(null), "TANPA_TARGET");
});

test("target kosong / nol = TANPA_TARGET, tidak dibagi nol", () => {
  for (const targetBulan of [null, 0]) {
    const h = nilaiPacing({ targetBulan, hariKerjaBulan: 22, hariKerjaLewat: 5, faktur: 1, soTerbuka: 0 });
    assert.equal(h.status, "TANPA_TARGET");
    assert.equal(h.pct_pacing, null);
    assert.equal(h.target_prorata, null);
  }
});

test("hari kerja lewat tak boleh melebihi hari kerja bulan (prorata maksimal 100%)", () => {
  const h = nilaiPacing({ targetBulan: 1_000, hariKerjaBulan: 20, hariKerjaLewat: 25, faktur: 1_000, soTerbuka: 0 });
  assert.equal(h.target_prorata, 1_000);
  assert.equal(h.pct_pacing, 100);
});

test("pesan WA: tanpa kurung sudut, sebut pacing + rincian faktur/SO + target sebulan", () => {
  const p: SoPacing = {
    tanggal: "2026-10-12", bulan: "Oktober 2026", hari_kerja_bulan: 22, hari_kerja_lewat: 8,
    regions: [
      { region: "East", ...nilaiPacing({ targetBulan: 5_577_166_667, hariKerjaBulan: 22, hariKerjaLewat: 8, faktur: 700_000_000, soTerbuka: 60_000_000 }), so_hari_ini: 30_000_000, so_hari_ini_jumlah: 4 },
      { region: "West", ...nilaiPacing({ targetBulan: null, hariKerjaBulan: 22, hariKerjaLewat: 8, faktur: 1, soTerbuka: 0 }), so_hari_ini: 0, so_hari_ini_jumlah: 0 },
    ],
    office: { faktur: 0, so_terbuka: 0 }, ambang: { merah: 50, kuning: 80 },
  };
  const wa = formatWaPacing(p, "https://os.example/sales-analytics");
  assert.doesNotMatch(wa, /[<>]/);
  assert.match(wa, /🔴 \*East\*: 37\.5% dari target s\/d hari ini/);
  assert.match(wa, /faktur Rp 700 jt \+ SO terbuka Rp 60 jt/);
  assert.match(wa, /target sebulan Rp 5,58 M/);
  assert.match(wa, /West\*: target bulan belum diisi/);
  assert.match(wa, /hari kerja 8\/22/);
});

test("tanggal pacing = hari ini WIB, termasuk dini hari (UTC masih kemarin)", () => {
  // Senin 12 Okt 2026 01:27 WIB = Minggu 11 Okt 18:27 UTC.
  const diniHari = new Date("2026-10-11T18:27:00Z");
  assert.equal(diniHari.toISOString().slice(0, 10), "2026-10-11");
  assert.equal(wibToday(diniHari).toISOString().slice(0, 10), "2026-10-12");
});
