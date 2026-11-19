import { test } from "node:test";
import assert from "node:assert/strict";

import { findNavItem } from "./nav";
import { npkGate } from "./npk-api-access";
import { picformGate } from "./picform-access";

// featureAllowed() menolak path yang tak ada di NAV — termasuk untuk admin. Jadi
// salah ketik di gerbang BFF = route tertutup untuk semua orang tanpa pesan.
// Tes ini memastikan setiap menu yang dipakai gerbang /api tanpa-menu (digests,
// briefings, coaching, accounts, customers, products, npk, picform, network)
// benar-benar ada di katalog menu.
const MENU_GERBANG = [
  "/digests", "/briefings", "/coaching", "/accounts", "/customers", "/products",
  "/pipeline", "/network", "/sop-otomasi", "/people/raci",
  "/npk", "/npk/self", "/npk/am", "/npk/am-self",
];

test("setiap menu gerbang API ada di NAV dan cocok persis", () => {
  for (const p of MENU_GERBANG) {
    const it = findNavItem(p);
    assert.ok(it, `menu ${p} tak ada di NAV`);
    assert.equal(it.url, p, `${p} jatuh ke menu ${it.url}`);
  }
});

test("peta npk & picform hanya menunjuk menu yang ada", () => {
  const subs = ["scores", "scores/1", "am/scores", "am/scores/x"];
  for (const s of subs) for (const p of npkGate(s, "GET")?.menus ?? []) assert.ok(MENU_GERBANG.includes(p), p);
  for (const s of ["summary", "divisi", "kelengkapan", "sop-langkah", "raci", "raci-karyawan", "koordinasi", "pohon"]) {
    for (const p of picformGate(s) ?? []) assert.ok(MENU_GERBANG.includes(p), p);
  }
});
