import { test } from "node:test";
import assert from "node:assert/strict";
import { cariKabKota, intiNama, type KabKota } from "./pilih-kab-kota";

const D: KabKota[] = [
  { kode: "35.07", nama: "Kabupaten Malang", provinsi: "Jawa Timur" },
  { kode: "35.73", nama: "Kota Malang", provinsi: "Jawa Timur" },
  { kode: "35.78", nama: "Kota Surabaya", provinsi: "Jawa Timur" },
  { kode: "35.15", nama: "Kabupaten Sidoarjo", provinsi: "Jawa Timur" },
  { kode: "31.71", nama: "Kota Administrasi Jakarta Pusat", provinsi: "DKI Jakarta" },
  { kode: "12.07", nama: "Kabupaten Labuhanbatu", provinsi: "Sumatera Utara" },
  { kode: "12.10", nama: "Kabupaten Labuhanbatu Selatan", provinsi: "Sumatera Utara" },
];
const nama = (q: string) => cariKabKota(D, q).map((k) => k.nama);

test("inti nama membuang jenis wilayah", () => {
  assert.equal(intiNama("Kabupaten Malang"), "malang");
  assert.equal(intiNama("Kota Administrasi Jakarta Pusat"), "jakarta pusat");
});

test("cari kab/kota: tanpa awalan, singkatan kab., provinsi, urutan", () => {
  assert.deepEqual(nama("malang").sort(), ["Kabupaten Malang", "Kota Malang"]);
  assert.deepEqual(nama("kota malang"), ["Kota Malang"]);
  assert.deepEqual(nama("kab. malang"), ["Kabupaten Malang"]);
  assert.deepEqual(nama("kab malang"), ["Kabupaten Malang"]);
  assert.deepEqual(nama("SURABAYA"), ["Kota Surabaya"]);
  assert.deepEqual(nama("jakarta"), ["Kota Administrasi Jakarta Pusat"]);
  assert.equal(nama("jawa timur").length, 4);
  assert.deepEqual(nama("labuhanbatu"), ["Kabupaten Labuhanbatu", "Kabupaten Labuhanbatu Selatan"]);
  assert.deepEqual(nama(""), []);
  assert.deepEqual(nama("xyz"), []);
});
