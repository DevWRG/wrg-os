import { test } from "node:test";
import assert from "node:assert/strict";

import { MateriError, cekBerkas, namaFileDrive, nilaiAkses, validasiMateri } from "./materi.js";

// F130 Brosur & video — bagian murni.

const tolak = (f: () => unknown, pesan: RegExp) =>
  assert.throws(f, (e: unknown) => e instanceof MateriError && e.status === 400 && pesan.test(e.message));

test("validasiMateri: brosur tak butuh tautan; video wajib https", () => {
  const b = validasiMateri({ jenis: "brosur", judul: "  Zybio   Z3 ", brand: "ZYBIO", url: "ngawur" });
  assert.equal(b.judul, "Zybio Z3");
  assert.equal(b.url, null); // tautan brosur dari Drive, bukan isian
  const v = validasiMateri({ jenis: "video", judul: "Training Z3", produk: "Z3", url: " https://youtu.be/abc " });
  assert.equal(v.url, "https://youtu.be/abc");
  tolak(() => validasiMateri({ jenis: "video", judul: "x", brand: "Z", url: "http://youtu.be/abc" }), /https/);
  tolak(() => validasiMateri({ jenis: "video", judul: "x", brand: "Z", url: "youtube" }), /tidak sah/);
  tolak(() => validasiMateri({ jenis: "brosur", judul: " ", brand: "Z" }), /judul/);
  tolak(() => validasiMateri({ jenis: "brosur", judul: "x" }), /brand atau nama produk/);
  tolak(() => validasiMateri({ jenis: "poster", judul: "x", brand: "Z" }), /jenis/);
  tolak(() => validasiMateri({ jenis: "brosur", judul: "x", brand: "Z", kategori: "Alkes" }), /kategori/);
});

test("cekBerkas: PDF/gambar ≤20 MB", () => {
  assert.equal(cekBerkas({ isi: Buffer.from("x"), nama: "a.pdf", mime: "application/pdf" }), "pdf");
  tolak(() => cekBerkas({ isi: Buffer.from("x"), nama: "a.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), /PDF, JPG/);
  tolak(() => cekBerkas({ isi: Buffer.alloc(0), nama: "a.pdf", mime: "application/pdf" }), /kosong/);
  tolak(() => cekBerkas({ isi: Buffer.alloc(20 * 1024 * 1024 + 1), nama: "a.pdf", mime: "application/pdf" }), /20 MB/);
});

test("namaFileDrive: buang karakter terlarang", () => {
  assert.equal(namaFileDrive('Zybio Z3 / Z5: "Hematologi"', "pdf"), "Zybio Z3 Z5 Hematologi.pdf");
  assert.equal(namaFileDrive("   ", "png"), "Brosur.png");
});

test("nilaiAkses: Drive privat mengalihkan ke login Google", () => {
  assert.equal(nilaiAkses(200, null), true);
  assert.equal(nilaiAkses(302, "https://accounts.google.com/ServiceLogin?continue=x"), false);
  assert.equal(nilaiAkses(301, "https://www.youtube.com/watch?v=abc"), "ikuti");
  assert.equal(nilaiAkses(403, null), false);
  assert.equal(nilaiAkses(500, null), null);
});
