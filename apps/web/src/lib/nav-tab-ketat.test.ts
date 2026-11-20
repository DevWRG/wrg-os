import { test } from "node:test";
import assert from "node:assert/strict";
import { LayoutGrid } from "lucide-react";

import { findNavItem, navGate, navOwnVisible, navVisible, tabVisible, featureCatalog, type NavGroup, type NavItem } from "./nav";
import type { AccessUser } from "./pricelist-access";

// Fondasi peleburan menu jadi tab (lampiran teknis evaluasi menu, resep R2/R5):
// pemegang key TAB hanya boleh URL induk persis + path tab, tak pernah data induk.
const perm = (view = true) => ({ active: true, view, create: false, edit: false, delete: false });
const grup = [{ id: 9, key: "uji", name: "Uji" }];
const u = (o: Partial<AccessUser>): AccessUser => ({ role: "user", rbac: true, groups: grup, permissions: {}, ...o }) as AccessUser;

const INDUK: NavItem = {
  title: "Induk", url: "/induk", icon: LayoutGrid, tabKetat: true,
  show: (me) => me?.title === "kepala",
  features: [
    { key: "lama-a", name: "Induk — tab A", path: "/lama-a", show: (me) => me?.title === "staf-a" },
    { key: "lama-b", name: "Induk — tab B", path: "/lama-b" },
  ],
};
const NAVUJI: NavGroup[] = [{ label: "Uji", items: [INDUK] }];

test("(a) grup sudah diatur, hanya key tab → URL induk persis boleh, data & rute anak induk tidak", () => {
  const me = u({ permissions: { "lama-b": perm() } });
  assert.equal(navVisible(me, INDUK), true, "sidebar tampil");
  assert.equal(navOwnVisible(me, INDUK), false, "bukan pemegang induk");
  assert.equal(navGate(me, INDUK, "/induk"), true, "URL induk persis");
  assert.equal(navGate(me, INDUK, "/induk/123"), false, "rute anak induk");
  assert.equal(navGate(me, INDUK), false, "BFF data induk");
  const tabB = findNavItem("/lama-b", NAVUJI)!;
  assert.equal(tabB.feature, "lama-b");
  assert.equal(navGate(me, tabB), true, "BFF/path tab B");
  assert.equal(navGate(me, findNavItem("/lama-a/x", NAVUJI)!), false, "tab A tidak");
});

test("(b) grup belum diatur + kunci lama tab → hanya tab itu, kunci lama tab tak membuka induk", () => {
  const me = u({ title: "staf-a", permissions: {} });
  assert.equal(tabVisible(me, INDUK.features![0]), true);
  assert.equal(navVisible(me, INDUK), true);
  assert.equal(navOwnVisible(me, INDUK), false);
  assert.equal(navGate(me, INDUK, "/induk/1"), false);
  assert.equal(navGate(me, findNavItem("/lama-a", NAVUJI)!), true);
  assert.equal(navGate(me, findNavItem("/lama-b", NAVUJI)!), false);
});

test("(b2) kunci lama induk tetap membuka induk (show induk tak diubah)", () => {
  const me = u({ title: "kepala", permissions: {} });
  assert.equal(navOwnVisible(me, INDUK), true);
  assert.equal(navGate(me, INDUK, "/induk/1"), true);
});

test("(c) izin tak tersedia (fail-open) → sidebar & akses sama dengan kunci lama", () => {
  const staf = { role: "user", title: "staf-a" } as AccessUser;
  assert.equal(navVisible(staf, INDUK), true, "menu induk tampil karena kunci lama tab A");
  assert.equal(navGate(staf, findNavItem("/lama-a", NAVUJI)!), true);
  assert.equal(navOwnVisible(staf, INDUK), false);
});

test("admin lolos semua; menu tanpa tabKetat tetap perilaku lama (OR)", () => {
  const adm = u({ role: "admin" });
  assert.equal(navGate(adm, INDUK, "/induk/1"), true);
  const biasa: NavItem = { ...INDUK, tabKetat: undefined };
  const me = u({ permissions: { "lama-b": perm() } });
  assert.equal(navGate(me, biasa, "/induk/1"), true);
});

test("findNavItem: path tab lama menang atas induk; induk tetap untuk url-nya", () => {
  assert.equal(findNavItem("/induk", NAVUJI)?.url, "/induk");
  assert.equal(findNavItem("/lama-a/7", NAVUJI)?.feature, "lama-a");
  assert.equal(findNavItem("/lain", NAVUJI), null);
});

test("katalog fitur NAV asli tetap utuh: tiap key sekali, termasuk entri features", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("pricelist") && keys.includes("pricebook"));
});
