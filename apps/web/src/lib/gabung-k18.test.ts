import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog, findNavItem } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K18 opsi C: Coaching Notes → tab di Raport Karyawan 360; Voice tetap menu sendiri.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key coaching tetap di katalog; /coaching milik key lama; Voice tetap menu", () => {
  assert.ok(featureCatalog().some((r) => r.key === "coaching"));
  assert.equal(findNavItem("/coaching")?.feature, "coaching");
  assert.equal(findNavItem("/people/voice")?.url, "/people/voice");
});

test("pemegang coaching saja: API coaching ya, data/rute Karyawan 360 tidak", () => {
  const me = u({ coaching: perm() });
  assert.equal(featureAllowed(me, "/coaching", "view"), true);
  assert.equal(featureAllowed(me, "/karyawan", "view"), false);
});

test("pemegang Karyawan 360 saja: tab coaching tertutup", () => {
  assert.equal(featureAllowed(u({ karyawan: perm() }), "/coaching", "view"), false);
});
