import { test } from "node:test";
import assert from "node:assert/strict";

import { DOMINAN_MIN_PANGSA, DOMINAN_MIN_SEBUTAN, formatBriefWa, rakitDominasi, type Briefing } from "./customer-intel.js";

// F131 Customer Intelligence — bagian murni (tanpa DB).

test("rakitDominasi: dugaan dominan butuh ≥5 sebutan DAN pangsa ≥60%", () => {
  assert.equal(DOMINAN_MIN_SEBUTAN, 5);
  assert.equal(DOMINAN_MIN_PANGSA, 0.6);
  const sel = rakitDominasi([
    { cabang: "SOLO & YOGYAKARTA", kategori: "BGA", vendor: "Medisindo", n: 7 },
    { cabang: "SOLO & YOGYAKARTA", kategori: "BGA", vendor: "Roche", n: 2 },
    { cabang: "SBY 1", kategori: "Hematologi", vendor: "Mindray", n: 4 },       // dominan tapi < 5 sebutan
    { cabang: "JAKARTA", kategori: "Kimia Klinik", vendor: "Roche", n: 5 },
    { cabang: "JAKARTA", kategori: "Kimia Klinik", vendor: "Sysmex", n: 5 },    // seri → pangsa 50%
  ], [{ cabang: "SOLO & YOGYAKARTA", kategori: "BGA", vendor: "Medisindo", status: "dikonfirmasi", catatan: "kontrak 3 thn", oleh: "Yogi" }]);
  const bga = sel.find((s) => s.kategori === "BGA")!;
  assert.equal(bga.dugaan, true);
  assert.equal(bga.vendor, "Medisindo");
  assert.equal(bga.pangsa, 0.778);
  assert.deepEqual(bga.runner_up, { vendor: "Roche", sebutan: 2 });
  assert.equal(bga.status, "dikonfirmasi");
  assert.equal(bga.oleh, "Yogi");
  assert.equal(sel.find((s) => s.cabang === "SBY 1")!.dugaan, false);
  const jkt = sel.find((s) => s.cabang === "JAKARTA")!;
  assert.equal(jkt.dugaan, false);
  assert.equal(jkt.vendor, "Roche"); // seri → urut abjad, deterministik
  assert.equal(sel[0].kategori, "BGA"); // dugaan dulu
});

const dasar: Briefing = {
  faskes: { ids: ["1"], nama: "RSUD DR SOEDONO, KOTA MADIUN", cabang: "SBY 2", tipe: null, kelas_rs: null, pemilik: "Budi" },
  kontak: [{ nama: "dr. Sari", jabatan: "Ka. Lab", hp_wa: "0812", utama: true }],
  pembelian: { terakhir: "2026-10-01", hari_sejak: 12, netto_12bln: 1_234_000_000, faktur_12bln: 34, brand_teratas: ["ZYBIO", "VIVACHEK"] },
  piutang: { sisa: 120_000_000, lewat_tempo: { faktur: 3, nilai: 45_000_000, terlama_hari: 62 } },
  bayar: { faktur: 30, median_hari: 42, rata_hari: 54, tepat_pct: 26, rata_telat_hari: 18, tren: "lebih lambat" },
  kunjungan: [{ tanggal: "2026-10-10", am: "Budi", tujuan: "Presentasi", hasil: "Ka. Lab minta penawaran Z52", next_action: "kirim SPH" }],
  catatan: [],
  deal: [{ stage: "Negotiation", brand: "ZYBIO", produk: "Z52", nilai: 300_000_000, hari_di_tahap: 21, am: "Budi" }],
  kso: { aktif: 2, alat: ["Zybio Z3", "EXC200"], mou_terdekat: "2026-12-31" },
  kso_kesehatan: { status: "WASPADA", alasan: ["Median bayar 72 hari setelah faktur"] },
  demo: [],
  kompetitor: [{ tanggal: "2026-09-03", vendor: "Mindray", produk: "BC-30", harga_text: "Rp 4,5 jt", konteks: null }],
  dominan_wilayah: [{ kategori: "BGA", vendor: "Medisindo", catatan: null }],
  hari_ini: "2026-10-13",
};

test("formatBriefWa: memuat fakta kunci dalam urutan yang dipakai AM", () => {
  const t = formatBriefWa(dasar);
  const baris = t.split("\n");
  assert.equal(baris[0], "🧭 *Brief: RSUD DR SOEDONO, KOTA MADIUN* (SBY 2)");
  assert.equal(baris[1], "Pemilik: Budi · PIC: dr. Sari (Ka. Lab) 0812");
  assert.match(t, /🧾 Beli terakhir 1 Okt 2026 \(12 hari lalu\) · 12 bln: Rp 1,23 M \(34 faktur\) · ZYBIO, VIVACHEK/);
  assert.match(t, /💰 Piutang Rp 120 jt · lewat jatuh tempo 3 faktur Rp 45 jt \(terlama 62 hari\)/);
  assert.match(t, /⏱️ Bayar \(12 bln, 30 faktur\): median 42 hari setelah faktur · 26% tepat waktu · telat rata-rata 18 hari · lebih lambat dari tahun sebelumnya/);
  assert.match(t, /🩺 Kesehatan KSO: 🟡 WASPADA — Median bayar 72 hari setelah faktur/);
  assert.match(t, /🔬 KSO aktif: 2 alat \(Zybio Z3, EXC200\) · MoU terdekat habis 31 Des 2026/);
  assert.match(t, /🤝 Deal Negotiation: ZYBIO Z52 Rp 300 jt · 21 hari di tahap ini/);
  assert.match(t, /• 10 Okt \(Budi\) Presentasi: Ka\. Lab minta penawaran Z52 → Next: kirim SPH/);
  assert.match(t, /• 3 Sep Mindray BC-30 \(Rp 4,5 jt\)/);
  assert.match(t, /🏁 Dominan di wilayah: BGA — Medisindo/);
});

test("formatBriefWa: calon pelanggan tanpa faktur, tanpa piutang/KSO/kunjungan", () => {
  const t = formatBriefWa({
    ...dasar,
    faskes: { ...dasar.faskes, pemilik: null, cabang: null },
    kontak: [], pembelian: { terakhir: null, hari_sejak: null, netto_12bln: 0, faktur_12bln: 0, brand_teratas: [] },
    piutang: { sisa: 0, lewat_tempo: { faktur: 0, nilai: 0, terlama_hari: 0 } },
    bayar: { faktur: 0, median_hari: null, rata_hari: null, tepat_pct: null, rata_telat_hari: null, tren: null },
    kunjungan: [], deal: [], kso: { aktif: 0, alat: [], mou_terdekat: null }, kso_kesehatan: null, kompetitor: [], dominan_wilayah: [],
  });
  assert.match(t, /Belum ada AM pemilik · PIC belum dicatat/);
  assert.match(t, /Belum pernah ada faktur — calon pelanggan/);
  assert.match(t, /Belum ada laporan kunjungan tercatat/);
  assert.doesNotMatch(t, /💰|⏱️|🩺|🔬|🤝|⚔️|🏁/);
});

test("trenBayar: beda median ≥7 hari = berubah; data <3 faktur = tak dinilai", async () => {
  const { trenBayar } = await import("./pembayaran.js");
  const st = (median: number | null, faktur = 10) => ({ faktur, median_hari: median, rata_hari: null, tepat_pct: null, rata_telat_hari: null });
  assert.equal(trenBayar(st(30), st(45)), "lebih cepat");
  assert.equal(trenBayar(st(52), st(45)), "lebih lambat");
  assert.equal(trenBayar(st(48), st(45)), "stabil");
  assert.equal(trenBayar(st(30, 2), st(45)), null);
  assert.equal(trenBayar(st(null), st(45)), null);
});
