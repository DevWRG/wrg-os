import { test } from "node:test";
import assert from "node:assert/strict";

import { alokasiJumlah, buatKonteks, cabangPadaTanggal, kelompokAkun, KANTOR_PUSAT, tebakArea, type InputBiaya } from "./biaya-area-rules.js";

// Data fiktif (bukan data asli).
const ctx = buatKonteks({
  areaKota: [
    { kota: "KOTA KEDIRI", cabang: "KEDIRI" },
    { kota: "KAB. BADUNG", cabang: "BALI" },
    { kota: "KOTA JAKARTA BARAT", cabang: "JAKARTA" },
    { kota: "KOTA CIREBON", cabang: "CIREBON" },
    { kota: "KOTA PALEMBANG", cabang: "PALEMBANG" },
    { kota: "KOTA SURABAYA", cabang: "SBY 2" },
  ],
  alias: [
    { kata: "JAKARTA", area: "JAKARTA" },
    { kata: "DENPASAR", area: "BALI" },
  ],
  karyawan: [
    { nama: "Budi Santoso", panggilan: "Budi", cabang: "KEDIRI" },
    { nama: "Citra Dewi", panggilan: "Citra", cabang: "PUSAT" },
    { nama: "Ari Satu", panggilan: "Ari", cabang: "JAKARTA", riwayat: [{ cabang: "BALI", berlaku_mulai: "2000-01-01" }, { cabang: "JAKARTA", berlaku_mulai: "2026-08-10" }] },
    { nama: "Arif Dua", panggilan: "Arif", cabang: "SBY 2" },
    { nama: "Arif Tiga", panggilan: "Arif", cabang: "PUSAT" },
  ],
  payeeManual: [{ payee: "vendor khusus", area: "madiun" }],
});

const b = (o: Partial<InputBiaya>): InputBiaya => ({ sumber: "other-payment", tanggal: "2026-09-01", akun: "6200-02", keterangan: "", payee: "", ...o });

test("kelompokAkun: 6100/6200/6300 saja; 5100 & 7200 bukan biaya", () => {
  assert.equal(kelompokAkun("6200-11"), "OPERASIONAL");
  assert.equal(kelompokAkun("6100-01"), "SDM");
  assert.equal(kelompokAkun("6300-02"), "LUAR USAHA");
  assert.equal(kelompokAkun("5100-02"), null);
  assert.equal(kelompokAkun(undefined), null);
});

test("SDM & luar usaha → Kantor Pusat meski keterangan menyebut kota", () => {
  assert.equal(tebakArea(b({ akun: "6100-01", keterangan: "GAJI KEDIRI" }), ctx).area, KANTOR_PUSAT);
  assert.equal(tebakArea(b({ akun: "6300-02", keterangan: "BANK CHARGE BALI" }), ctx).area, KANTOR_PUSAT);
});

test("Departemen sah menang atas aturan lain; departemen asing diabaikan", () => {
  const h = tebakArea(b({ departemen: "Cirebon", keterangan: "BBM KEDIRI", payee: "BUDI" }), ctx);
  assert.deepEqual([h.area, h.dasar], ["CIREBON", "departemen Accurate"]);
  assert.equal(tebakArea(b({ departemen: "ENTAH", keterangan: "BBM KEDIRI" }), ctx).area, "KEDIRI");
});

test("override payee manual dinormalkan uppercase", () => {
  assert.equal(tebakArea(b({ payee: "Vendor Khusus", keterangan: "x" }), ctx).area, "MADIUN");
});

test("ST <kota> → titik layanan", () => {
  const h = tebakArea(b({ payee: "ST KEDIRI" }), ctx);
  assert.deepEqual([h.area, h.tertandai], ["KEDIRI", true]);
});

test("payee karyawan cabang → cabangnya; karyawan Pusat → Kantor Pusat", () => {
  assert.equal(tebakArea(b({ payee: "BUDI" }), ctx).area, "KEDIRI");
  const h = tebakArea(b({ payee: "CITRA" }), ctx);
  assert.deepEqual([h.area, h.dasar, h.tertandai], [KANTOR_PUSAT, "payee = karyawan Pusat", false]);
});

test("mutasi: ARI Bali sebelum 10 Agu 2026, Jakarta sesudahnya", () => {
  assert.equal(tebakArea(b({ payee: "ARI", tanggal: "2026-08-09" }), ctx).area, "BALI");
  assert.equal(tebakArea(b({ payee: "ARI", tanggal: "2026-08-10" }), ctx).area, "JAKARTA");
  const k = { nama: "X", panggilan: null, cabang: "JAKARTA" };
  assert.equal(cabangPadaTanggal(k, "2020-01-01"), "JAKARTA");
});

test("payee ambigu (ARIF: SBY 2 vs Pusat) tidak ditebak dari nama; jatuh ke kota/Pusat", () => {
  assert.equal(tebakArea(b({ payee: "ARIF" }), ctx).dasar, "tak tertebak");
  assert.equal(tebakArea(b({ payee: "ARIF", keterangan: "BBM CIREBON" }), ctx).area, "CIREBON");
});

test("kota di keterangan: satu area; kata terpanjang menang; multi-area dibagi", () => {
  assert.equal(tebakArea(b({ keterangan: "EXP DENPASAR" }), ctx).area, "BALI");
  const m = tebakArea(b({ keterangan: "EXP CIREBON, JAKARTA, PALEMBANG" }), ctx);
  assert.equal(m.area, "MULTI");
  assert.deepEqual([...(m.bagi ?? [])].sort(), ["CIREBON", "JAKARTA", "PALEMBANG"]);
  // "JAKARTA BARAT" dan "JAKARTA" → area sama, bukan multi
  assert.equal(tebakArea(b({ keterangan: "KIRIM JAKARTA BARAT" }), ctx).bagi, null);
});

test("faktur pembelian: kota dari nama vendor tidak dipakai; other-payment tetap memakai payee", () => {
  const fp = tebakArea(b({ sumber: "purchase-invoice", akun: "6200-19", payee: "PT KOTA JAKARTA BARAT", keterangan: "STAMP EXPENSE" }), ctx);
  assert.equal(fp.dasar, "tak tertebak");
  const op = tebakArea(b({ payee: "KOTA CIREBON PARKIR", keterangan: "x" }), ctx);
  assert.equal(op.area, "CIREBON");
});

test("alokasiJumlah: rata, jumlah total terjaga", () => {
  const m = tebakArea(b({ keterangan: "EXP CIREBON, JAKARTA, PALEMBANG" }), ctx);
  const a = alokasiJumlah(100, m);
  assert.equal(a.length, 3);
  assert.equal(a.reduce((s, x) => s + x.jumlah, 0), 100);
  assert.deepEqual(alokasiJumlah(50, tebakArea(b({ payee: "BUDI" }), ctx)), [{ area: "KEDIRI", jumlah: 50 }]);
});
