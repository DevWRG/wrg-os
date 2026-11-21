import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed } from "./feature-guard";
import { featureCatalog, findNavItem, navGate } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

// K15: Product Scorecard + Revenue per Lini → "Kinerja Produk"; dua key izin tetap.
const perm = () => ({ active: true, view: true, create: false, edit: false, delete: false });
const deny = () => ({ active: true, view: false, create: false, edit: false, delete: false });
const u = (o: Partial<SessionUserSrv>): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions: {}, ...o }) as SessionUserSrv;

test("key revenue-stream tetap di katalog; /revenue-stream milik key lama", () => {
  assert.ok(featureCatalog().some((r) => r.key === "revenue-stream"));
  assert.equal(findNavItem("/revenue-stream")?.feature, "revenue-stream");
});

test("Direktur (revenue-stream ya, product-scorecard deny): menu ya, API Scorecard tidak", () => {
  const dir = u({ title: "Direktur", permissions: { "revenue-stream": perm(), "product-scorecard": deny() } });
  assert.equal(navGate(dir, findNavItem("/product-scorecard")!, "/product-scorecard"), true);
  assert.equal(featureAllowed(dir, "/revenue-stream", "view"), true);
  assert.equal(featureAllowed(dir, "/product-scorecard", "view"), false);
});
