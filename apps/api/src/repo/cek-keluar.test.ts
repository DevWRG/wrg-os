import { test } from "node:test";
import assert from "node:assert/strict";
import { angkaSeri, nominalAngka, buildPengingatWa, cekTransisi, deskripsiMemuatSeri, peringatanSaldo, seriLoncat } from "./cek-keluar.js";

test("cekTransisi: peta status + maker-checker + alasan wajib", () => {
  const o = { oleh: "Ika", dibuatOleh: "Kolis" };
  assert.equal(cekTransisi("draft", "ajukan", o), null);
  assert.equal(cekTransisi("diajukan", "setujui", o), null);
  assert.match(cekTransisi("draft", "setujui", o) ?? "", /tidak bisa/);
  assert.match(cekTransisi("diajukan", "setujui", { oleh: "kolis ", dibuatOleh: "Kolis" }) ?? "", /sendiri/);
  assert.match(cekTransisi("diajukan", "tolak", o) ?? "", /alasan wajib/);
  assert.equal(cekTransisi("diajukan", "tolak", { ...o, catatan: "nominal salah" }), null);
  assert.match(cekTransisi("diserahkan", "batal", { ...o, catatan: "x" }) ?? "", /tidak bisa/);
  assert.equal(cekTransisi("diserahkan", "cair", o), null);
  assert.match(cekTransisi("cair", "tolak_bank", { ...o, catatan: "x" }) ?? "", /tidak bisa/);
});

test("angkaSeri + seriLoncat", () => {
  assert.equal(angkaSeri("CEK AB 123456"), 123456);
  assert.equal(angkaSeri("tanpa angka"), null);
  assert.equal(seriLoncat("AB 123457", ["AB 123456"]), null);
  assert.equal(seriLoncat("AB 123460", ["AB 123456", "AB 123457"]), "123458");
  assert.equal(seriLoncat("AB 123450", ["AB 123456"]), null); // lebih kecil = celah/buku lain
  assert.equal(seriLoncat("CD 900", ["AB 123456"]), null); // awalan beda = buku lain
  assert.equal(seriLoncat("AB 1", []), null);
});

test("deskripsiMemuatSeri: utuh, nol depan, potongan ≥ 6 digit; seri pendek tak dicocokkan", () => {
  assert.equal(deskripsiMemuatSeri("KLIRING CEK 0123456 PT ABC", "AB 123456"), true);
  assert.equal(deskripsiMemuatSeri("CK BB9123456", "123456"), true);
  assert.equal(deskripsiMemuatSeri("TRF 5123456789", "AB 123456"), false); // ekor beda
  assert.equal(deskripsiMemuatSeri("CEK 23456", "AB 123456"), false);      // potongan < 6 digit
  assert.equal(deskripsiMemuatSeri("BIAYA 123", "AB 123"), false);         // seri < 4 digit
  assert.equal(deskripsiMemuatSeri("TRANSFER KE VENDOR", "AB 123456"), false);
});

test("peringatanSaldo", () => {
  const s = { bank_account_id: "x", label: "MDR 038", saldo: 100_000_000, saldo_tanggal: "2026-11-06", saldo_terverifikasi: true, beredar: 60_000_000, beredar_cek: 2 };
  assert.equal(peringatanSaldo(s, 40_000_000), null);
  assert.match(peringatanSaldo(s, 40_000_001) ?? "", /melebihi saldo/);
  assert.match(peringatanSaldo({ ...s, saldo: null, saldo_tanggal: null }, 1) ?? "", /belum ada/);
});

test("buildPengingatWa: HARI INI vs tanggal", () => {
  const t = buildPengingatWa("2026-11-09", [
    { id: "3", no_seri: "AB 1001", nominal: 5_000_000, penerima: "PT X", jatuh_tempo: "2026-11-09", rekening: "MDR 038" },
    { id: "4", no_seri: "AB 1002", nominal: 7_500_000, penerima: "PT Y", jatuh_tempo: "2026-11-12", rekening: "MDR 038" },
  ]);
  assert.match(t, /2 lembar/);
  assert.match(t, /C3 AB 1001 · MDR 038 · Rp5\.000\.000 → PT X · HARI INI/);
  assert.match(t, /C4 AB 1002 .* Kam, 12 Nov/);
});

test("nominalAngka: format Indonesia & angka JSON", () => {
  assert.equal(nominalAngka(45000000), 45000000);
  assert.equal(nominalAngka("45.000.000"), 45000000);
  assert.equal(nominalAngka("Rp 1.250.000,50"), 1250000.5);
  assert.ok(Number.isNaN(nominalAngka("")));
});
