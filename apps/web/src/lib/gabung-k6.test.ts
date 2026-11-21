import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K6: Relokasi Aset → tab di Aset GA; dua key izin tetap.
const perm = (p = {}) => ({ active: true, view: true, create: false, edit: false, delete: false, ...p });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key ga-relokasi & ga-finance-approval tetap di katalog", () => {
  const keys = featureCatalog().map((r) => r.key);
  for (const k of ["ga-aset", "ga-relokasi", "ga-finance-approval"]) assert.ok(keys.includes(k), k);
});

test("pemegang relokasi saja: BFF relokasi ya, BFF Aset GA tidak", () => {
  const me = u({ "ga-relokasi": perm() });
  assert.equal(featureAllowed(me, "/ga-relokasi", "view"), true);
  assert.equal(featureAllowed(me, "/ga-aset", "view"), false);
});

test("pemegang approval Finance tetap membuka data Aset GA (sub-izin induk)", () => {
  const me = u({ "ga-finance-approval": perm() });
  assert.equal(featureAllowed(me, "/ga-aset", "view"), true);
});
