import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog, findNavItem } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K16: Readiness Board → tab di Instalasi Alat; dua key izin tetap.
const perm = (p = {}) => ({ active: true, view: true, create: false, edit: false, delete: false, ...p });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key installations & readiness-board tetap di katalog; path lama milik key lama", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.ok(keys.includes("installations") && keys.includes("readiness-board"));
  assert.equal(findNavItem("/readiness-board")?.feature, "readiness-board");
});

test("gerbang BFF dua arah (jadwal install butuh readiness-board)", () => {
  const ready = u({ "readiness-board": perm({ create: true }) });
  assert.equal(featureAllowed(ready, "/readiness-board", "create"), true);
  assert.equal(featureAllowed(ready, "/installations", "view"), false);
  assert.equal(featureAllowed(u({ installations: perm() }), "/readiness-board", "view"), false);
});
