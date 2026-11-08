import assert from "node:assert/strict";
import { test } from "node:test";

import { accountIdDariCustomer, nomorTujuan, tujuanDiizinkan } from "./sales-doc-gate.js";

test("nomorTujuan menormalkan format umum ke 62…", () => {
  assert.equal(nomorTujuan("0812-3456-7890"), "6281234567890");
  assert.equal(nomorTujuan("+62 812 3456 7890"), "6281234567890");
  assert.equal(nomorTujuan("62 0812 3456 7890"), "6281234567890");
  assert.equal(nomorTujuan("6281234567890@c.us"), "6281234567890");
  assert.equal(nomorTujuan("6281234567890@s.whatsapp.net"), "6281234567890");
});

test("nomorTujuan menolak JID grup/JID lain, kosong, dan bukan nomor", () => {
  assert.equal(nomorTujuan("120363000000000000@g.us"), null);
  assert.equal(nomorTujuan("6281234567890@lid"), null);
  assert.equal(nomorTujuan(""), null);
  assert.equal(nomorTujuan(null), null);
  assert.equal(nomorTujuan("123"), null);
  assert.equal(nomorTujuan("abc"), null);
});

test("tujuanDiizinkan: cocok kontak WA customer walau beda format", () => {
  const kontak = ["0812 3456 7890", null, "+62 811-1111-111"];
  assert.equal(tujuanDiizinkan("6281234567890", kontak), true);
  assert.equal(tujuanDiizinkan("+6281111111 11", kontak), true);
});

test("tujuanDiizinkan: nomor asing / grup / tanpa kontak ditolak", () => {
  assert.equal(tujuanDiizinkan("081299999999", ["081234567890"]), false);
  assert.equal(tujuanDiizinkan("120363000000000000@g.us", ["120363000000000000"]), false);
  assert.equal(tujuanDiizinkan("081234567890", []), false);
  // kontak rusak tak boleh membuka jalan (kosong == kosong)
  assert.equal(tujuanDiizinkan("", ["", null]), false);
});

test("accountIdDariCustomer: hanya id numerik (crm_contact.account_id bigint)", () => {
  assert.equal(accountIdDariCustomer("12345"), "12345");
  assert.equal(accountIdDariCustomer(" 12345 "), "12345");
  assert.equal(accountIdDariCustomer("RS Fixture Sehat"), null);
  assert.equal(accountIdDariCustomer("12a"), null);
  assert.equal(accountIdDariCustomer(null), null);
  assert.equal(accountIdDariCustomer("1".repeat(19)), null); // lewat batas bigint
});
