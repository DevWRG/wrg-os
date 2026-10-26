import assert from "node:assert/strict";
import { test } from "node:test";

import { pesanValidasi, type ElemenValidasi } from "./pesan-validasi.js";

const lolos: ElemenValidasi["validity"] = {
  valueMissing: false, typeMismatch: false, patternMismatch: false, tooShort: false, tooLong: false,
  rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false,
};
const el = (o: Partial<ElemenValidasi> & { gagal: Partial<ElemenValidasi["validity"]> }): ElemenValidasi => ({
  tagName: "INPUT", value: "", ...o, validity: { ...lolos, ...o.gagal },
});

test("wajib diisi: teks, pilihan, centang, tanggal", () => {
  assert.equal(pesanValidasi(el({ gagal: { valueMissing: true } })), "Kolom ini wajib diisi.");
  assert.equal(pesanValidasi(el({ tagName: "SELECT", gagal: { valueMissing: true } })), "Pilih salah satu.");
  assert.equal(pesanValidasi(el({ type: "checkbox", gagal: { valueMissing: true } })), "Centang kotak ini untuk melanjutkan.");
  assert.equal(pesanValidasi(el({ type: "date", gagal: { valueMissing: true } })), "Tanggal wajib diisi.");
});

test("batas angka & tanggal (kasus kapasitas teknisi 26 Okt)", () => {
  assert.equal(pesanValidasi(el({ type: "number", min: "1", gagal: { rangeUnderflow: true } })), "Nilai minimal 1.");
  assert.equal(pesanValidasi(el({ type: "number", max: "50", gagal: { rangeOverflow: true } })), "Nilai maksimal 50.");
  assert.equal(pesanValidasi(el({ type: "date", min: "2026-10-26", gagal: { rangeUnderflow: true } })), "Tidak boleh sebelum 26/10/2026.");
  assert.equal(pesanValidasi(el({ type: "number", gagal: { stepMismatch: true } })), "Harus bilangan bulat.");
  assert.equal(pesanValidasi(el({ type: "number", step: "0.5", gagal: { stepMismatch: true } })), "Harus kelipatan 0.5.");
});

test("format, panjang, pola", () => {
  assert.match(pesanValidasi(el({ type: "email", gagal: { typeMismatch: true } }))!, /^Format email tidak valid/);
  assert.equal(pesanValidasi(el({ value: "ab", minLength: 8, gagal: { tooShort: true } })), "Minimal 8 karakter (sekarang 2).");
  assert.equal(pesanValidasi(el({ title: "8 digit angka", gagal: { patternMismatch: true } })), "Format tidak sesuai: 8 digit angka");
  assert.equal(pesanValidasi(el({ gagal: { patternMismatch: true } })), "Format isian tidak sesuai.");
});

test("valid / tak dikenali → null", () => {
  assert.equal(pesanValidasi(el({ gagal: {} })), null);
});
