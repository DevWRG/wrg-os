import assert from "node:assert/strict";
import { test } from "node:test";

import { findNavItem, NAV } from "./nav.js";

// findNavItem dipakai (dashboard)/layout.tsx sebagai GATE rute: item null =
// rute lolos tanpa diperiksa izinnya. Jadi tes di sini bukan soal sorot
// sidebar, melainkan soal "rute mana yang punya penjaga".

test("rute anak yang hidup di prefiks lain tetap ketemu menunya (matchPrefix)", () => {
  // /sph/new = form SPH, milik menu "Sales Docs" (url /sales-docs) lewat
  // matchPrefix. Dulu findNavItem hanya melihat `url`, jadi rute ini tak punya
  // padanan menu dan layout melewatkan gate-nya → terbuka untuk siapa pun yang
  // bisa login, termasuk viewer.
  assert.equal(findNavItem("/sph/new")?.url, "/sales-docs");
  assert.equal(findNavItem("/sph")?.url, "/sales-docs");
  assert.equal(findNavItem("/sales-docs")?.url, "/sales-docs");
});

test("prefiks terpanjang menang", () => {
  // /insentif dan /insentif/tim dua menu berbeda dengan izin berbeda; rute anak
  // harus jatuh ke yang lebih spesifik, bukan ke induknya.
  assert.equal(findNavItem("/insentif/tim")?.url, "/insentif/tim");
  assert.equal(findNavItem("/insentif/tim/AM01")?.url, "/insentif/tim");
  assert.equal(findNavItem("/insentif")?.url, "/insentif");
});

test("rute di luar katalog menu tetap null", () => {
  // Perilaku yang memang disengaja (lihat komentar di layout): rute non-menu
  // seperti /akses-ditolak tak di-gate. Dites supaya perubahan di atas tidak
  // diam-diam menjadikan segalanya cocok.
  assert.equal(findNavItem("/akses-ditolak"), null);
  assert.equal(findNavItem("/rute-yang-tidak-ada"), null);
});

test("setiap matchPrefix menunjuk ke rute nyata, bukan salah ketik", () => {
  // matchPrefix yang salah ketik gagal secara SENYAP: tak ada error, cuma
  // rute yang kembali tanpa penjaga. Minimal pastikan ia tidak bertabrakan
  // dengan url menu lain (yang berarti dua menu mengklaim rute yang sama).
  const urls = new Set(NAV.flatMap((g) => g.items.map((it) => it.url)));
  for (const g of NAV) {
    for (const it of g.items) {
      for (const p of it.matchPrefix ?? []) {
        assert.ok(p.startsWith("/"), `matchPrefix harus absolut: ${p}`);
        assert.ok(!urls.has(p), `matchPrefix "${p}" bentrok dengan url menu lain`);
      }
    }
  }
});
