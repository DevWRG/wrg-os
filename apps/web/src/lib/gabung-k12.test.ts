import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed, featureAllowedAny } from "./feature-guard";
import { featureCatalog, findNavItem } from "./nav";
import { salesAnalyticsMenus } from "./sales-analytics-access";
import type { SessionUserSrv } from "./admin-guard";

// K12: Sales Alerts → tab "Aturan Alert" di Sales Analytics; dua key izin tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key sales-alerts tetap di katalog; /sales-alerts milik key lama", () => {
  assert.ok(featureCatalog().some((r) => r.key === "sales-alerts"));
  assert.equal(findNavItem("/sales-alerts")?.feature, "sales-alerts");
});

test("pemegang alert saja: BFF alert ya, BFF analitik tidak", () => {
  const me = u({ "sales-alerts": perm() });
  assert.equal(featureAllowedAny(me, salesAnalyticsMenus("alerts")!, "view"), true);
  assert.equal(featureAllowedAny(me, salesAnalyticsMenus("per-am")!, "view"), false);
});

test("pemegang Sales Analytics saja (mis. AM): analitik ya, alert tidak; Kinerja Saya tetap", () => {
  const am = u({ "sales-analytics": perm(), me: perm() });
  assert.equal(featureAllowedAny(am, salesAnalyticsMenus("per-am")!, "view"), true);
  assert.equal(featureAllowedAny(am, salesAnalyticsMenus("alert-targets")!, "view"), false);
  assert.equal(featureAllowed(u({ me: perm() }), "/me", "view"), true);
});
