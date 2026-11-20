import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K4: Kurir Performance → tab di Tracking Pengiriman; dua key izin tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key courier-performance & shipment-tracking tetap di katalog", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.ok(keys.includes("courier-performance") && keys.includes("shipment-tracking"));
});

test("gerbang BFF dua arah", () => {
  assert.equal(featureAllowed(u({ "courier-performance": perm() }), "/courier-performance", "view"), true);
  assert.equal(featureAllowed(u({ "courier-performance": perm() }), "/shipment-tracking", "view"), false);
  assert.equal(featureAllowed(u({ "shipment-tracking": perm() }), "/courier-performance", "view"), false);
});
