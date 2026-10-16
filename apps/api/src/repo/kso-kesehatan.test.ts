import { test } from "node:test";
import assert from "node:assert/strict";

import { bulanTutup, labelBulan, nilaiKesehatan, pesanRekapHod, yangMemburuk, type MetrikKso } from "./kso-kesehatan.js";

// F73 KSO Health — aturan status (varian D, 13 Okt 2026).

const HARI = "2026-10-13";
const sehat: MetrikKso = {
  account_id: "1", nama: "RSUD Contoh", cabang: "SBY 1", pemilik: "Budi", aset: 2, skema: ["PER_TEST"], alat: ["Zybio Z3"],
  target_bln: 1000, ada_per_test: true, beli_m1: true, beli_m2: true, rev3: 90, rev3_sebelum: 100,
  tes_tagih_3bln: 2700, tes_sheet_rata: null, sheet_sampai: null, median_bayar: 40, lewat_tempo_hari: 20,
  kontrak_berakhir: "2027-06-30", kontrak_terverifikasi: true,
};
const kode = (m: Partial<MetrikKso>) => nilaiKesehatan({ ...sehat, ...m }, HARI);

test("bulanTutup & labelBulan", () => {
  assert.equal(bulanTutup(HARI, 0), "2026-10-01");
  assert.equal(bulanTutup(HARI, 1), "2026-09-01");
  assert.equal(bulanTutup("2026-01-05", 2), "2025-11-01");
  assert.equal(labelBulan("2026-08-01"), "Agu 2026");
});

test("semua komponen baik → SEHAT tanpa alasan", () => {
  const h = kode({});
  assert.equal(h.status, "SEHAT");
  assert.deepEqual(h.alasan, []);
  assert.equal(h.utilisasi.sumber, "accurate");
  assert.equal(h.utilisasi.rasio, 0.9);
});

test("KRITIS: tanpa pembelian 2 bulan tutup, piutang >90 hari, kontrak terverifikasi lewat", () => {
  const a = kode({ beli_m1: false, beli_m2: false });
  assert.equal(a.status, "KRITIS");
  assert.match(a.alasan[0].teks, /Tidak ada pembelian KSO di Agu 2026 dan Sep 2026/);
  assert.equal(kode({ beli_m1: false, beli_m2: true }).status, "SEHAT"); // satu bulan bolong belum kritis
  assert.equal(kode({ lewat_tempo_hari: 91 }).status, "KRITIS");
  assert.equal(kode({ lewat_tempo_hari: 90 }).status, "SEHAT");
  assert.equal(kode({ kontrak_berakhir: "2026-10-01" }).status, "KRITIS");
});

test("WASPADA: revenue turun >30%, utilisasi <50% (tak pernah Kritis), median bayar >90, kontrak ≤90 hari", () => {
  const r = kode({ rev3: 60, rev3_sebelum: 100 });
  assert.equal(r.status, "WASPADA");
  assert.match(r.alasan[0].teks, /turun 40%/);
  assert.equal(kode({ rev3: 71, rev3_sebelum: 100 }).status, "SEHAT");
  assert.equal(kode({ tes_tagih_3bln: 1200 }).status, "WASPADA"); // 400/1000 = 40%
  assert.equal(kode({ tes_tagih_3bln: 300 }).status, "WASPADA");  // 10% — tetap Waspada
  assert.equal(kode({ tes_tagih_3bln: 1800 }).status, "SEHAT");   // 60%
  assert.equal(kode({ median_bayar: 91 }).status, "WASPADA");
  assert.equal(kode({ median_bayar: 90 }).status, "SEHAT");
  assert.equal(kode({ kontrak_berakhir: "2026-12-31" }).status, "WASPADA"); // 79 hari
});

test("kontrak isian awal (belum terverifikasi) yang lewat = info saja, status tak jatuh", () => {
  const h = kode({ kontrak_berakhir: "2026-01-01", kontrak_terverifikasi: false });
  assert.equal(h.status, "SEHAT");
  assert.equal(h.alasan[0].tingkat, "info");
  assert.match(h.alasan[0].teks, /perlu verifikasi/);
});

test("utilisasi: cadangan sheet ≤6 bln berlabel bulan; sheet basi / tanpa data = info; tanpa target = tidak dinilai", () => {
  const s = kode({ ada_per_test: false, tes_tagih_3bln: null, tes_sheet_rata: 300, sheet_sampai: "2026-07-01" });
  assert.equal(s.utilisasi.sumber, "sheet");
  assert.equal(s.status, "WASPADA");
  assert.match(s.alasan[0].teks, /data sheet s\/d Jul 2026/);
  const basi = kode({ ada_per_test: false, tes_tagih_3bln: null, tes_sheet_rata: 300, sheet_sampai: "2025-11-01" });
  assert.equal(basi.utilisasi.rasio, null);
  assert.equal(basi.status, "SEHAT");
  assert.match(basi.alasan[0].teks, /data sheet terakhir Nov 2025, terlalu lama/);
  assert.equal(kode({ target_bln: 0, tes_tagih_3bln: 10 }).utilisasi.rasio, null);
  const t = kode({ tes_tagih_3bln: null, tes_sheet_rata: null });
  assert.equal(t.status, "SEHAT");
  assert.equal(t.alasan[0].kode, "utilisasi_tak_terukur");
});

test("yangMemburuk: dibanding snapshot lalu; tanpa snapshot = semua yang tidak sehat", () => {
  const kini = [
    { account_id: "1", status: "KRITIS" as const }, { account_id: "2", status: "WASPADA" as const },
    { account_id: "3", status: "SEHAT" as const }, { account_id: "4", status: "WASPADA" as const },
  ];
  const lalu = new Map([["1", "WASPADA" as const], ["2", "WASPADA" as const], ["3", "KRITIS" as const]]);
  assert.deepEqual(yangMemburuk(kini, lalu, true).map((x) => x.account_id), ["1", "4"]);
  assert.deepEqual(yangMemburuk(kini, new Map(), false).map((x) => x.account_id), ["1", "2", "4"]);
});

test("pesanRekapHod: ringkas, maksimal 15 faskes", () => {
  const f = { nama: "RS A", status: "KRITIS" as const, alasan: [{ tingkat: "kritis" as const, kode: "x", teks: "Piutang lewat jatuh tempo 120 hari" }] };
  const p = pesanRekapHod("Yogi", Array.from({ length: 17 }, () => f));
  assert.match(p, /^🩺 \*Kesehatan KSO — tim Yogi\*\n17 faskes baru memburuk minggu ini:\n🔴 RS A: Piutang lewat jatuh tempo 120 hari/);
  assert.match(p, /… dan 2 lainnya/);
});

test("utilisasi memakai target sesuai sumber tes (15 Okt): Accurate ↔ alat PER_TEST, sheet ↔ alat lain", () => {
  // Faskes berskema ganda: 1000 target total, 600 milik alat PER_TEST.
  const pt = kode({ target_bln: 1000, target_pt: 600, target_lain: 400, tes_tagih_3bln: 1800 });
  assert.equal(pt.utilisasi.sumber, "accurate");
  assert.equal(pt.utilisasi.rasio, 1); // 600/600, bukan 600/1000
  const sh = kode({ ada_per_test: false, target_bln: 1000, target_pt: 0, target_lain: 400, tes_tagih_3bln: null,
    tes_sheet_rata: 100, sheet_sampai: "2026-07-01" });
  assert.equal(sh.utilisasi.sumber, "sheet");
  assert.equal(sh.utilisasi.rasio, 0.25);
  assert.match(sh.alasan.find((a) => a.kode === "utilisasi_rendah")!.teks, /target 400 tes/);
});
