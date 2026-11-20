import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed, featureAllowedAny } from "./feature-guard";
import { featureCatalog, findNavItem, navGate } from "./nav";
import { monitorGate } from "./monitor-access";
import type { SessionUserSrv } from "./admin-guard";

// K1: Monitor (4) + Digest History → "Monitor Grup WA"; lima key izin tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("kelima key tetap di katalog; path lama milik key lama", () => {
  const keys = featureCatalog().map((r) => r.key);
  for (const k of ["monitor-rekap", "monitor-resume", "monitor-pola", "monitor-members", "digests"]) assert.ok(keys.includes(k), k);
  assert.equal(findNavItem("/monitor/resume")?.feature, "monitor-resume");
  assert.equal(findNavItem("/digests")?.feature, "digests");
});

test("Komite (monitor-resume saja): buka menu, proxy resume ya, rekap & digest tidak", () => {
  const komite = u({ "monitor-resume": perm() });
  assert.equal(navGate(komite, findNavItem("/monitor/rekap")!, "/monitor/rekap"), true);
  const g = (sub: string) => monitorGate(sub, "GET")!;
  assert.equal(featureAllowedAny(komite, g("resume").menus, "view"), true);
  assert.equal(featureAllowedAny(komite, g("rekap").menus, "view"), false);
  assert.equal(featureAllowedAny(komite, g("digests").menus, "view"), false);
  assert.equal(featureAllowed(komite, "/digests", "view"), false);
});
