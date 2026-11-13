import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alasanTolakLampiran, inputSimulasi, isianBaru, isianUbah, kartuAlur, kodeBerikut, opsiMaju, progresPct,
  ProyekHdError, tanggalCatatan, tentukanMaju, urutanTahap,
} from "./proyek-hd.js";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const TXT = new Uint8Array([0x68, 0x61, 0x6c, 0x6f]);

test("urutan tahap: Tambah Unit lewat 6c sebelum 6a", () => {
  assert.deepEqual(urutanTahap("Start New"), ["1", "2", "3", "4", "5", "6a", "7"]);
  assert.deepEqual(urutanTahap("Tambah Unit"), ["1", "2", "3", "4", "5", "6c", "6a", "7"]);
});

test("opsiMaju: default tanpa lompat; Relokasi boleh lompati DED & CIP", () => {
  assert.deepEqual(opsiMaju("Start New", "2").map((o) => o.kode), ["3"]);
  const r = opsiMaju("Pindah/Relokasi", "2");
  assert.deepEqual(r.map((o) => o.kode), ["3", "4", "5"]);
  assert.deepEqual(r.find((o) => o.kode === "5")?.dilompati, ["3", "4"]);
  assert.equal(r[0].utama, true);
});

test("opsiMaju: sesudah OSS boleh 6b; dari 6b hanya ke 6a; 7 = akhir", () => {
  assert.deepEqual(opsiMaju("Start New", "5").map((o) => o.kode), ["6a", "6b"]);
  assert.deepEqual(opsiMaju("Tambah Unit", "5").map((o) => o.kode), ["6c", "6a", "6b"]);
  assert.deepEqual(opsiMaju("Start New", "6b").map((o) => o.kode), ["6a"]);
  assert.deepEqual(opsiMaju("Start New", "7"), []);
});

test("tentukanMaju menolak tahap yang tak sah", () => {
  assert.deepEqual(tentukanMaju("Start New", "1"), { ok: true, ke: "2", dilompati: [] });
  assert.equal(tentukanMaju("Start New", "2", "5").ok, false);
  assert.equal(tentukanMaju("Start New", "7").ok, false);
  const r = tentukanMaju("Tambah Unit", "2", "5");
  assert.equal(r.ok && r.dilompati.join(","), "3,4");
});

test("kartu alur: 7 kartu, posisi 6 ikut kode berjalan, label Tambah Unit", () => {
  const a = kartuAlur("Tambah Unit", "3");
  assert.equal(a.length, 7);
  assert.equal(a[5].nama, "BPJS / Bypass");
  assert.deepEqual(a.map((k) => k.status), ["selesai", "selesai", "berjalan", "belum", "belum", "belum", "belum"]);
  assert.equal(kartuAlur("Start New", "6b")[5].kode, "6b");
  assert.equal(progresPct("1"), 14);
  assert.equal(progresPct("6c"), 86);
  assert.equal(progresPct("7"), 100);
});

test("isianBaru: wajib nama RS & unit KSO > 0; enum dicek", () => {
  const d = isianBaru({ nama_rs: "  RS  Contoh ", unit_kso: "4", tipe_proyek: "Tambah Unit" });
  assert.equal(d.nama_rs, "RS Contoh");
  assert.equal(d.unit_kso, 4);
  assert.equal(d.prioritas, "Gas");
  assert.throws(() => isianBaru({ unit_kso: 1 }), ProyekHdError);
  assert.throws(() => isianBaru({ nama_rs: "RS", unit_kso: 0 }), /unit_kso/);
  assert.throws(() => isianBaru({ nama_rs: "RS", unit_kso: 1, segmen: "Lain" }), /segmen/);
  assert.throws(() => isianBaru({ nama_rs: "RS", unit_kso: 1, target_golive: "2026-13" }), /go-live/);
});

test("isianUbah hanya membawa kolom yang dikirim", () => {
  assert.deepEqual(isianUbah({ status_rag: "Merah" }), { status_rag: "Merah" });
  assert.deepEqual(isianUbah({ next_action: "  " }), { next_action: null });
  assert.throws(() => isianUbah({ unit_running: -1 }), /unit_running/);
});

test("tanggal catatan: kosong = hari ini; masa depan & tanggal palsu ditolak", () => {
  assert.equal(tanggalCatatan("", "2026-11-13"), "2026-11-13");
  assert.equal(tanggalCatatan("2026-11-01", "2026-11-13"), "2026-11-01");
  assert.throws(() => tanggalCatatan("2026-11-14", "2026-11-13"), /masa depan/);
  assert.throws(() => tanggalCatatan("2026-02-30", "2026-11-13"), /kalender/);
});

test("lampiran: tipe dari isi, maks 5 berkas", () => {
  assert.equal(alasanTolakLampiran([{ nama: "a.pdf", buf: PDF }]), null);
  assert.match(alasanTolakLampiran([{ nama: "a.pdf", buf: TXT }])!, /PDF, JPG, atau PNG/);
  assert.match(alasanTolakLampiran(Array.from({ length: 6 }, () => ({ nama: "a.pdf", buf: PDF })))!, /maksimal 5/);
});

test("kode proyek berurutan PRJ-0001", () => {
  assert.equal(kodeBerikut(null), "PRJ-0001");
  assert.equal(kodeBerikut("PRJ-0009"), "PRJ-0010");
  assert.equal(kodeBerikut("PRJ-12345"), "PRJ-12346");
});

test("input simulasi: kunci whitelist, angka ≥ 0, mode wajib untuk proyeksi", () => {
  const p = inputSimulasi("proyeksi_rs", { mesin: 3, shift: 2, hari: 20, tarif_klaim: 1000, porsi_pct: 50, harga_tetap: 0, mode: "bagi_hasil", liar: 1 });
  assert.equal(p.mode, "bagi_hasil");
  assert.equal("liar" in p, false);
  assert.throws(() => inputSimulasi("proyeksi_rs", { mesin: 3, shift: 2, hari: 20, tarif_klaim: 1, porsi_pct: 1, harga_tetap: 1 }), /mode/);
  assert.throws(() => inputSimulasi("proyeksi_rs", { mesin: -1, mode: "bagi_hasil" }), /mesin/);
});
