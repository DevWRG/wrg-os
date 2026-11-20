import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog, findNavItem, navGate } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K3: PO Tracker + Inbound Receiving → satu menu, dua key izin tetap.
const perm = (p = {}) => ({ active: true, view: true, create: false, edit: false, delete: false, ...p });
const u = (permissions: SessionUserSrv["permissions"]): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions }) as SessionUserSrv;

test("key inbound-receiving tetap di katalog (tak jadi zombie saat Sync Fitur)", () => {
  const keys = featureCatalog().map((r) => r.key);
  assert.ok(keys.includes("inbound-receiving"));
  assert.ok(keys.includes("purchase-orders"));
});

test("pemegang Penerimaan saja: buka menu induk, BFF penerimaan ya, BFF PO tidak", () => {
  const me = u({ "inbound-receiving": perm({ edit: true }) });
  assert.equal(navGate(me, findNavItem("/purchase-orders")!, "/purchase-orders"), true);
  assert.equal(featureAllowed(me, "/inbound-receiving", "edit"), true);
  assert.equal(featureAllowed(me, "/purchase-orders", "view"), false);
});

test("pemegang PO saja: BFF PO ya, BFF penerimaan tidak", () => {
  const me = u({ "purchase-orders": perm() });
  assert.equal(featureAllowed(me, "/purchase-orders", "view"), true);
  assert.equal(featureAllowed(me, "/inbound-receiving", "view"), false);
});
