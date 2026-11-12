// 312 — SPH KSO: pilihan penanda tangan Direktur, isi ketentuan surat, PDF. Data fiktif.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ketentuanSphKso, namaFileSphKso, sphKsoPdf, type SphKsoCetak } from "./kso-sph-pdf.js";
import { pilihTtdKso, ttdDefaultKso, type KandidatTtdKso } from "./kso-sph.js";
import { terjemahGalatWeb } from "./kso-komite.js";
import { polaTerlarang } from "./kso-saring.js";

const DIR: KandidatTtdKso[] = [
  { userId: "11111111-1111-1111-1111-111111111111", nama: "Direktur Satu", jabatan: "Direktur Utama" },
  { userId: "22222222-2222-2222-2222-222222222222", nama: "Direktur Dua", jabatan: null },
];

test("pilihTtdKso: default = Direktur yang memutus; tanpa pemutus = yang pertama; jabatan kosong → Direktur", () => {
  const a = pilihTtdKso(DIR, null, DIR[1].userId);
  assert.ok(a.ok && a.ttd.userId === DIR[1].userId && a.ttd.jabatan === "Direktur");
  const b = pilihTtdKso(DIR, "", null);
  assert.ok(b.ok && b.ttd.userId === DIR[0].userId && b.ttd.jabatan === "Direktur Utama");
  const c = pilihTtdKso(DIR, null, "33333333-3333-3333-3333-333333333333"); // pemutus bukan Direktur aktif
  assert.ok(c.ok && c.ttd.userId === DIR[0].userId);
  assert.equal(ttdDefaultKso(DIR, DIR[1].userId), DIR[1].userId);
  assert.equal(ttdDefaultKso([], null), null);
});

test("pilihTtdKso: pilihan eksplisit harus ada di daftar; tanpa akun Direktur → gagal", () => {
  const a = pilihTtdKso(DIR, DIR[0].userId, DIR[1].userId);
  assert.ok(a.ok && a.ttd.userId === DIR[0].userId);
  assert.equal(pilihTtdKso(DIR, "44444444-4444-4444-4444-444444444444", null).ok, false);
  assert.equal(pilihTtdKso([], null, null).ok, false);
});

const SPH: SphKsoCetak = {
  nomor: "01234/WRG.PN-PNA/XI/2026",
  harga_per_test: 18500,
  jumlah: 1,
  tenor_bulan: 36,
  volume_minimum: 700,
  klausul_wajib: ["eskalasi_tahunan", "lapor_test", "denda_telat", "kode_asing"],
  faskes_nama: "CONTOH SEJAHTERA, RS UMUM KAB. CONTOH",
  faskes_kota: "Kab. Contoh",
  alat_nama: "Hematology Analyzer Fiktif 5-Diff",
  berlaku_hari: 30,
  terbit_at: "2026-11-12T03:00:00.000Z",
  berlaku_sampai: "2026-12-12",
  ttd_nama: "Direktur Satu",
  ttd_jabatan: "Direktur Utama",
};

test("ketentuanSphKso: PPN belum termasuk, masa KSO, volume minimum, klausul wajib (kode asing dilewati), PKS, masa berlaku", () => {
  const k = ketentuanSphKso(SPH);
  assert.equal(k[0], "Harga per test belum termasuk PPN 11%.");
  assert.match(k[1], /36 bulan/);
  assert.ok(k.some((t) => /Volume minimum 700 test per bulan/.test(t)));
  assert.ok(k.some((t) => /disesuaikan setiap tahun/.test(t)));
  assert.ok(k.some((t) => /melaporkan jumlah test/.test(t)));
  assert.ok(k.some((t) => /denda/.test(t)));
  assert.ok(!k.some((t) => /kode_asing/.test(t)));
  assert.match(k[k.length - 1], /berlaku 30 hari .* 12 Desember 2026/);
  assert.equal(k.length, 8);
  // tanpa volume minimum → barisnya tak muncul
  assert.ok(!ketentuanSphKso({ ...SPH, volume_minimum: null, klausul_wajib: [] }).some((t) => /Volume minimum/.test(t)));
});

test("ketentuanSphKso: tak memuat angka internal (margin, HPP, batas bawah, biaya)", () => {
  const teks = ketentuanSphKso(SPH).join(" ");
  const kena = polaTerlarang(teks).filter((p) => p !== "persen"); // "PPN 11%" memang persen
  assert.deepEqual(kena, []);
});

test("sphKsoPdf: menghasilkan PDF; nama berkas aman", async () => {
  const buf = await sphKsoPdf(SPH);
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buf.length > 2000);
  assert.equal(namaFileSphKso(SPH), "SPH_KSO_01234_WRG.PN-PNA_XI_2026.pdf");
});

test("terjemahGalatWeb: alasan penanda tangan SPH tampil apa adanya (bukan pesan generik)", () => {
  const t = terjemahGalatWeb("PENANDA_TANGAN_SPH: Penanda tangan SPH harus dipilih dari daftar akun Direktur.");
  assert.deepEqual(t, { status: 409, pesan: "Penanda tangan SPH harus dipilih dari daftar akun Direktur." });
  assert.equal(terjemahGalatWeb("NOMOR_SPH_BELUM_DIATUR").status, 409);
});
