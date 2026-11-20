import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed, featureAllowedAny } from "./feature-guard";
import { atkCreateMenus, MENU_ATK_KOREKSI } from "./atk-access";
import { featureCatalog, findNavItem, navVisible } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K5 opsi B: Kelola ATK (Master + Barang Masuk + Opname) + Ambil ATK tetap sendiri.
const perm = (p = {}) => ({ active: true, view: true, create: false, edit: false, delete: false, ...p });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("keempat key ATK tetap di katalog", () => {
  const keys = featureCatalog().map((r) => r.key);
  for (const k of ["atk-master", "atk-stock-in", "atk-stock-out", "atk-stock-opname"]) assert.ok(keys.includes(k), k);
});

test("karyawan pemegang Stock Out saja tak melihat menu Kelola ATK", () => {
  const me = u({ "atk-stock-out": perm({ create: true }) });
  assert.equal(navVisible(me, findNavItem("/atk-master")!), false);
  assert.equal(featureAllowedAny(me, atkCreateMenus("out")!, "create"), true);
  assert.equal(featureAllowedAny(me, atkCreateMenus("in")!, "create"), false);
});

test("gerbang tulis mutasi per jenis tetap lewat path lama", () => {
  const ga = u({ "atk-stock-in": perm({ create: true, edit: true, delete: true }) });
  assert.equal(featureAllowedAny(ga, atkCreateMenus("in")!, "create"), true);
  assert.equal(featureAllowedAny(ga, MENU_ATK_KOREKSI, "edit"), true);
  assert.equal(featureAllowed(ga, "/atk-master", "view"), false, "tanpa key atk-master tak membuka data master");
});
