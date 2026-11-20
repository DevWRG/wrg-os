import { test } from "node:test";
import assert from "node:assert/strict";

import { NAV, findNavItem, homePath } from "./nav";
import { GRUP_TAMPIL, NAMA_TAMPIL, susunNav } from "./nav-tampil";

const semuaUrl = NAV.flatMap((g) => g.items.map((it) => it.url));

test("tak ada menu yang hilang atau dobel setelah disusun", () => {
  const hasil = susunNav(NAV).flatMap((g) => g.items.map((it) => it.url));
  assert.equal(hasil.length, semuaUrl.length);
  assert.deepEqual([...hasil].sort(), [...semuaUrl].sort());
});

test("peta tidak mencantumkan url dua kali", () => {
  const urls = GRUP_TAMPIL.flatMap((g) => g.urls);
  assert.equal(new Set(urls).size, urls.length);
});

test("setiap url NAV tercantum di peta (menu baru wajib ditambahkan)", () => {
  const dipetakan = new Set(GRUP_TAMPIL.flatMap((g) => g.urls));
  assert.deepEqual(semuaUrl.filter((u) => !dipetakan.has(u)), []);
});

test("grup tampil maksimal 13 item dan tak ada grup 1 item", () => {
  for (const g of susunNav(NAV)) {
    assert.ok(g.items.length <= 13, `${g.label}: ${g.items.length}`);
    assert.ok(g.items.length >= 2, `${g.label}: ${g.items.length}`);
  }
});

test("nama tampil hanya untuk url yang ada; katalog & rumah tak berubah", () => {
  for (const u of Object.keys(NAMA_TAMPIL)) assert.ok(findNavItem(u)?.url === u, u);
  assert.equal(homePath(null), "/overview");
});

test("menu di luar peta tetap tampil di grup aslinya", () => {
  const nav = [{ label: "Lama", items: [{ ...NAV[0].items[0], url: "/menu-baru-x", title: "Baru X" }] }];
  assert.deepEqual(susunNav(nav).map((g) => g.label), ["Lama"]);
});
