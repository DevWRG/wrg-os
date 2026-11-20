import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog, findNavItem } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K7: DO Belum Difaktur + Penerbitan Faktur → menu "Faktur"; dua key izin tetap.
const perm = (p = {}) => ({ active: true, view: true, create: false, edit: false, delete: false, ...p });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key do-belum-faktur & penerbitan-faktur tetap di katalog; path lama milik key lama", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.ok(keys.includes("do-belum-faktur") && keys.includes("penerbitan-faktur"));
  assert.equal(findNavItem("/penerbitan-faktur/revisi")?.feature, "penerbitan-faktur");
});

test("pemegang Penerbitan saja: BFF penerbitan ya (termasuk edit), BFF DO tidak", () => {
  const me = u({ "penerbitan-faktur": perm({ edit: true }) });
  assert.equal(featureAllowed(me, "/penerbitan-faktur", "edit"), true);
  assert.equal(featureAllowed(me, "/do-belum-faktur", "view"), false);
});

test("pemegang DO saja: BFF DO ya, BFF penerbitan tidak", () => {
  const me = u({ "do-belum-faktur": perm() });
  assert.equal(featureAllowed(me, "/do-belum-faktur", "view"), true);
  assert.equal(featureAllowed(me, "/penerbitan-faktur", "view"), false);
});
