import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed, featureAllowedAny } from "./feature-guard";
import { featureCatalog, findNavItem, navGate } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K2: Products + Inventory → "Katalog & Stok (Accurate)"; dua key izin tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key products & inventory tetap di katalog; /inventory milik key lama", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.ok(keys.includes("products") && keys.includes("inventory"));
  assert.equal(findNavItem("/inventory")?.feature, "inventory");
});

test("Komite (inventory tanpa products): buka menu, tab Stok; intelijen produk tetap tertutup", () => {
  const komite = u({ inventory: perm() });
  assert.equal(navGate(komite, findNavItem("/products")!, "/products"), true);
  assert.equal(featureAllowed(komite, "/products", "view"), false, "API intelijen produk = /products");
});

test("/api/products (dropdown form Deal) tetap untuk pemegang Pipeline", () => {
  assert.equal(featureAllowedAny(u({ pipeline: perm() }), ["/products", "/pipeline"], "view"), true);
});
