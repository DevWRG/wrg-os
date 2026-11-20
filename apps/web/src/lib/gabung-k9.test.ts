import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog, findNavItem, navGate } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K9: Customers + Accounts → "Customer & Akun"; dua key izin tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key accounts & customers tetap di katalog; /customers milik key lama", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.ok(keys.includes("accounts") && keys.includes("customers"));
  assert.equal(findNavItem("/customers")?.feature, "customers");
});

test("customers saja (pola Finance HOD/Komite): buka menu & /customers, profil akun tetap tertutup", () => {
  const c = u({ customers: perm() });
  const induk = findNavItem("/accounts")!;
  assert.equal(navGate(c, induk, "/accounts"), true);
  assert.equal(navGate(c, findNavItem("/accounts/123")!, "/accounts/123"), false);
  assert.equal(featureAllowed(c, "/accounts", "view"), false, "API /api/accounts = key accounts");
  assert.equal(featureAllowed(c, "/customers", "view"), true);
});

test("accounts saja: profil akun terbuka, data revenue pelanggan tertutup", () => {
  const a = u({ accounts: perm() });
  assert.equal(navGate(a, findNavItem("/accounts/123")!, "/accounts/123"), true);
  assert.equal(featureAllowed(a, "/customers", "view"), false);
});
