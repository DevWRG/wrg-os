import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bisaTautPo,
  bufferEfektif,
  hitungUsulan,
  jumlahBulan,
  labelRentang,
  rentangBulanTerakhir,
  tentukanWilayah,
  validasiRentang,
  bolehReview,
  labelReview,
  reviewHodKeyDokumen,
  validasiReview,
  isKategori,
  isWilayah,
  gudangUntukCabang,
  kategoriDariKlasifikasi,
  kelompokkanRekap,
  kodeDokumen,
  labelJenis,
  periodeDariBulan,
  qtyEfektif,
  usulanMasihBerjalan,
  validasiJenis,
} from "./forecast.js";
import { hodSalesUntukRegion } from "./sales.js";

const e = (status: string, poDiterima = false, poMati = false) => ({ status, poDiterima, poMati });

test("usulanMasihBerjalan: draft & submitted selalu menahan usulan baru", () => {
  assert.equal(usulanMasihBerjalan(e("draft")), true);
  assert.equal(usulanMasihBerjalan(e("submitted")), true);
});

test("usulanMasihBerjalan: ordered menahan selama PO hidup & barang belum diterima", () => {
  assert.equal(usulanMasihBerjalan(e("ordered")), true);
  assert.equal(usulanMasihBerjalan(e("ordered", true)), false);
  assert.equal(usulanMasihBerjalan(e("ordered", false, true)), false);
});

test("usulanMasihBerjalan: dismissed tidak menahan", () => {
  assert.equal(usulanMasihBerjalan(e("dismissed")), false);
});

test("kategoriDariKlasifikasi: 01 = IVD, kategori lain = Medical, tanpa klasifikasi = null", () => {
  assert.equal(kategoriDariKlasifikasi("01"), "IVD");
  assert.equal(kategoriDariKlasifikasi("02"), "Medical");
  assert.equal(kategoriDariKlasifikasi("03"), "Medical");
  assert.equal(kategoriDariKlasifikasi(null), null);
});

test("kodeDokumen: gudang-bulan-kategori, nomor urut hanya bila sudah ada", () => {
  assert.equal(kodeDokumen("SBY", "2026-11-01", "IVD", 1), "FC-SBY-202611-IVD");
  assert.equal(kodeDokumen("SBY", "2026-11-01", "Medical", 2), "FC-SBY-202611-MED-2");
  assert.equal(kodeDokumen("JOGJA", "2026-01-01", null, 1), "FC-JOGJA-202601-NA");
});

test("periodeDariBulan: YYYY-MM → tanggal 1, format salah → null", () => {
  assert.equal(periodeDariBulan("2026-11"), "2026-11-01");
  assert.equal(periodeDariBulan("2026-13"), null);
  assert.equal(periodeDariBulan("11-2026"), null);
  assert.equal(periodeDariBulan(undefined), null);
});

test("qtyEfektif: qty final menang, kosong → usulan sistem", () => {
  assert.equal(qtyEfektif({ finalQty: 5, suggestedQty: 9 }), 5);
  assert.equal(qtyEfektif({ finalQty: null, suggestedQty: 9 }), 9);
});

test("bisaTautPo: disetujui tanpa PO, atau PO mati", () => {
  assert.equal(bisaTautPo({ status: "submitted", poNumber: null, poMati: false }), true);
  assert.equal(bisaTautPo({ status: "ordered", poNumber: "1/PO", poMati: false }), false);
  assert.equal(bisaTautPo({ status: "ordered", poNumber: "1/PO", poMati: true }), true);
});

test("kelompokkanRekap: jumlahkan qty semua cabang per barang", () => {
  const base = { dokumenKode: "FC", status: "submitted", poNumber: null, poMati: false, notes: null, itemNo: null };
  const out = kelompokkanRekap([
    { ...base, suggestionId: "a", itemId: 2, itemName: "Reagen B", kategori: "IVD", warehouseKode: "SBY", warehouseNama: "Surabaya", qty: 10 },
    { ...base, suggestionId: "b", itemId: 2, itemName: "Reagen B", kategori: "IVD", warehouseKode: "SOLO", warehouseNama: "Solo", qty: 5, status: "ordered", poNumber: "9/PO" },
    { ...base, suggestionId: "c", itemId: 1, itemName: "Alat A", kategori: "Medical", warehouseKode: "SBY", warehouseNama: "Surabaya", qty: 1 },
  ]);
  assert.deepEqual(out.map((b) => [b.itemName, b.totalQty, b.cabang.length, b.belumPo]), [
    ["Reagen B", 15, 2, 1],
    ["Alat A", 1, 1, 1],
  ]);
});

test("jumlahBulan: bulan kalender utuh dihitung bulat, rentang bebas pakai hari", () => {
  assert.equal(jumlahBulan({ dari: "2026-08-01", sampai: "2026-10-31" }), 3);
  assert.equal(jumlahBulan({ dari: "2026-05-01", sampai: "2026-10-31" }), 6);
  assert.equal(jumlahBulan({ dari: "2025-12-01", sampai: "2026-02-28" }), 3);
  assert.ok(Math.abs(jumlahBulan({ dari: "2026-08-15", sampai: "2026-09-14" }) - 31 / 30.4375) < 1e-9);
});

test("rentangBulanTerakhir: N bulan utuh sebelum bulan berjalan", () => {
  assert.deepEqual(rentangBulanTerakhir("2026-11-15"), { dari: "2026-05-01", sampai: "2026-10-31" });
  assert.deepEqual(rentangBulanTerakhir("2026-02-10", 3), { dari: "2025-11-01", sampai: "2026-01-31" });
});

test("validasiRentang: kosong = 6 bulan, tolak terbalik / masa depan / > 36 bulan", () => {
  assert.deepEqual(validasiRentang({}, "2026-11-15"), { dari: "2026-05-01", sampai: "2026-10-31" });
  assert.deepEqual(validasiRentang({ dari: "2026-08-01", sampai: "2026-10-31" }, "2026-11-15"), { dari: "2026-08-01", sampai: "2026-10-31" });
  assert.ok("error" in validasiRentang({ dari: "2026-10-31", sampai: "2026-08-01" }, "2026-11-15"));
  assert.ok("error" in validasiRentang({ dari: "2026-08-01", sampai: "2026-12-01" }, "2026-11-15"));
  assert.ok("error" in validasiRentang({ dari: "2022-01-01", sampai: "2026-10-31" }, "2026-11-15"));
  assert.ok("error" in validasiRentang({ dari: "2026-08-01" }, "2026-11-15"));
});

test("bufferEfektif: persen × rata-rata; tanpa persen pakai angka tetap lama", () => {
  assert.equal(bufferEfektif({ bufferPersen: 20, bufferQty: null }, 70), 14);
  assert.equal(bufferEfektif({ bufferPersen: 150, bufferQty: 3 }, 10), 15);
  assert.equal(bufferEfektif({ bufferPersen: null, bufferQty: 4 }, 70), 4);
  assert.equal(bufferEfektif({ bufferPersen: null, bufferQty: null }, 70), null);
});

test("hitungUsulan: tutup kekurangan ke buffer + 1 bulan rata-rata", () => {
  assert.equal(hitungUsulan(0, 14, 70), 84);
  assert.equal(hitungUsulan(20, 14, 70), 70);
  assert.equal(hitungUsulan(0, null, 12.4), 12);
});

test("labelRentang: satu rentang, beragam, atau baris lama", () => {
  assert.equal(labelRentang([{ dari: "2026-08-01", sampai: "2026-10-31" }, { dari: "2026-08-01", sampai: "2026-10-31" }]), "1 Agu 2026 – 31 Okt 2026");
  assert.equal(labelRentang([{ dari: "2026-08-01", sampai: "2026-10-31" }, null]), "beragam per barang");
  assert.equal(labelRentang([null]), "6 bulan terakhir");
});

test("gudangUntukCabang: peta manual menang, lalu nama sama dengan kode/cabang/nama gudang", () => {
  const gudang = [
    { kode: "SBY", cabang: "Surabaya", nama: "Gudang Surabaya" },
    { kode: "JEMBER", cabang: "Jember", nama: "Gudang Jember" },
    { kode: "SOLO", cabang: "Solo", nama: "Gudang Solo" },
  ];
  const manual = new Map([["SBY 2", "SBY"], ["SOLO & YOGYAKARTA", "SOLO"]]);
  assert.equal(gudangUntukCabang("JEMBER", manual, gudang), "JEMBER");
  assert.equal(gudangUntukCabang("surabaya", manual, gudang), "SBY");
  assert.equal(gudangUntukCabang("SBY 2", manual, gudang), "SBY");
  assert.equal(gudangUntukCabang(" solo & yogyakarta ", manual, gudang), "SOLO");
  assert.equal(gudangUntukCabang("MALANG", manual, gudang), null);
  assert.equal(gudangUntukCabang(null, manual, gudang), null);
});

test("tentukanWilayah: ikut HoD cabang penjualan; kosong / tanpa HoD / campur → null", () => {
  const hod = new Map([["rocky", "east"], ["yogi", "west"]]);
  assert.deepEqual(tentukanWilayah([{ cabang: "JAKARTA", hod: "yogi" }, { cabang: "PALEMBANG", hod: "Yogi" }], hod), { wilayah: "west" });
  assert.deepEqual(tentukanWilayah([{ cabang: "MALANG", hod: "rocky" }, { cabang: "X", hod: null }], hod), { wilayah: "east" });
  assert.equal(tentukanWilayah([], hod).wilayah, null);
  assert.equal(tentukanWilayah([{ cabang: "X", hod: null }], hod).wilayah, null);
  assert.equal(tentukanWilayah([{ cabang: "A", hod: "rocky" }, { cabang: "B", hod: "yogi" }], hod).wilayah, null);
});

test("validasiJenis: kosong = semua, nilai lain ditolak", () => {
  assert.equal(validasiJenis(undefined), "semua");
  assert.equal(validasiJenis("KSO"), "kso");
  assert.equal(validasiJenis("regular"), "regular");
  assert.equal(validasiJenis("tender"), null);
});

test("labelJenis: satu jenis, baris lama = KSO & Regular, campur = beragam", () => {
  assert.equal(labelJenis(["kso", "kso"]), "penjualan KSO");
  assert.equal(labelJenis([null]), "penjualan KSO & Regular");
  assert.equal(labelJenis(["kso", "regular"]), "jenis penjualan beragam");
});

// ── Review HoD Sales wilayah (migrasi 326) — nilai sintetis ────────────────
const aktor = (x: Partial<{ role: string | null; hodKey: string | null; superuser: boolean }>) => ({
  userId: "00000000-0000-0000-0000-000000000001", nama: "Penguji", role: "user", hodKey: null, superuser: false, ...x,
});

test("bolehReview: HoD Sales wilayah dokumen boleh, HoD lain tidak", () => {
  assert.equal(bolehReview(aktor({ hodKey: "hod-a" }), "hod-a"), true);
  assert.equal(bolehReview(aktor({ hodKey: "HOD-A" }), "hod-a"), true);
  assert.equal(bolehReview(aktor({ hodKey: "hod-b" }), "hod-a"), false);
  assert.equal(bolehReview(aktor({ hodKey: null }), "hod-a"), false);
  assert.equal(bolehReview(aktor({ hodKey: "hod-a" }), null), false);
  assert.equal(bolehReview(aktor({ hodKey: "" }), ""), false);
});

test("bolehReview: Direktur, admin, superuser jadi cadangan; viewer/user biasa tidak", () => {
  assert.equal(bolehReview(aktor({ role: "direktur" }), "hod-a"), true);
  assert.equal(bolehReview(aktor({ role: "Admin" }), "hod-a"), true);
  assert.equal(bolehReview(aktor({ superuser: true }), "hod-a"), true);
  assert.equal(bolehReview(aktor({ role: "direktur" }), null), true);
  assert.equal(bolehReview(aktor({ role: "viewer" }), "hod-a"), false);
  assert.equal(bolehReview(aktor({ role: "user" }), "hod-a"), false);
  assert.equal(bolehReview(null, "hod-a"), false);
});

test("validasiReview: keputusan wajib valid; tolak wajib catatan (di-trim)", () => {
  assert.deepEqual(validasiReview({ keputusan: "disetujui" }), { keputusan: "disetujui", catatan: null });
  assert.deepEqual(validasiReview({ keputusan: "disetujui", catatan: "  ok  " }), { keputusan: "disetujui", catatan: "ok" });
  assert.deepEqual(validasiReview({ keputusan: "ditolak", catatan: " qty terlalu besar " }), { keputusan: "ditolak", catatan: "qty terlalu besar" });
  assert.ok("error" in validasiReview({ keputusan: "ditolak", catatan: "   " }));
  assert.ok("error" in validasiReview({ keputusan: "ditolak" }));
  assert.ok("error" in validasiReview({ keputusan: "approved" }));
  assert.ok("error" in validasiReview(undefined));
  assert.ok("error" in validasiReview({ keputusan: "ditolak", catatan: "x".repeat(1001) }));
});

test("reviewHodKeyDokumen: tersimpan menang; dokumen lama ikut wilayah gudang", () => {
  assert.equal(reviewHodKeyDokumen("hod-a", "west"), "hod-a");
  assert.equal(reviewHodKeyDokumen(null, "east"), hodSalesUntukRegion("East"));
  assert.equal(reviewHodKeyDokumen(null, "utara"), null);
  assert.equal(reviewHodKeyDokumen(null, null), null);
});

test("hodSalesUntukRegion: East/West punya HoD Sales berbeda, region lain null", () => {
  const east = hodSalesUntukRegion("east");
  const west = hodSalesUntukRegion("West");
  assert.ok(east && west && east !== west);
  assert.equal(hodSalesUntukRegion("OFFICE"), null);
  assert.equal(hodSalesUntukRegion(null), null);
});

test("labelReview: menunggu / disetujui / ditolak + catatan; belum diajukan kosong", () => {
  assert.equal(labelReview({ reviewStatus: "menunggu", reviewRegion: "East" }), "Menunggu review HoD Sales East");
  assert.equal(labelReview({ reviewStatus: "disetujui", reviewedBy: "Penguji" }), "Disetujui oleh Penguji");
  assert.equal(labelReview({ reviewStatus: "ditolak", reviewedBy: "Penguji", reviewNote: "kurangi qty" }), "Ditolak oleh Penguji: kurangi qty");
  assert.equal(labelReview({ reviewStatus: null }), "");
});

test("isWilayah / isKategori: kosakata lokal F19", () => {
  assert.equal(isWilayah("east"), true);
  assert.equal(isWilayah("East"), false);
  assert.equal(isKategori("Medical"), true);
  assert.equal(isKategori("QC"), false);
});
