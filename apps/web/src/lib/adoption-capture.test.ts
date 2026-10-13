import assert from "node:assert/strict";
import { test } from "node:test";

import { actionFeatureFor, viewFeatureFor } from "./adoption-capture.js";

test("P1 aksi tulis di route fitur → feature key menu", () => {
  assert.equal(actionFeatureFor("/api/leave", "POST"), "leave");
  assert.equal(actionFeatureFor("/api/leave/pending/12/decide", "post"), "leave");
  assert.equal(actionFeatureFor("/api/leave/12/", "PATCH"), "leave");
});
test("GET/HEAD bukan action", () => {
  assert.equal(actionFeatureFor("/api/leave", "GET"), null);
  assert.equal(actionFeatureFor("/api/leave", "HEAD"), null);
});
test("E15 rute non-aksi-kerja dikecualikan (login, health, admin, tracker sendiri)", () => {
  for (const p of ["/api/auth/login", "/api/auth/logout", "/api/health", "/api/admin/access/features/sync", "/api/adoption/view"]) {
    assert.equal(actionFeatureFor(p, "POST"), null, p);
  }
});
test("E16 path tak terpetakan tidak ditebak", () => {
  assert.equal(actionFeatureFor("/api/tidak-ada-menu-ini", "POST"), null);
  assert.equal(actionFeatureFor("/halaman", "POST"), null);
  assert.equal(actionFeatureFor(null, "POST"), null);
});
test("P2 view halaman fitur; API, root, dan tracker tak dihitung", () => {
  assert.equal(viewFeatureFor("/leave"), "leave");
  assert.equal(viewFeatureFor("/leave/123?x=1"), "leave");
  assert.equal(viewFeatureFor("/api/leave"), null);
  assert.equal(viewFeatureFor("/adoption"), null);
  assert.equal(viewFeatureFor("/halaman-tak-ada"), null);
  assert.equal(viewFeatureFor(undefined), null);
});
