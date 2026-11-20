import { test } from "node:test";
import assert from "node:assert/strict";

import { salesAnalyticsMenus } from "./sales-analytics-access";

test("alert & daftar tujuan WA hanya menu Sales Alerts", () => {
  assert.deepEqual(salesAnalyticsMenus("alerts"), ["/sales-alerts"]);
  assert.deepEqual(salesAnalyticsMenus("alerts/abc"), ["/sales-alerts"]);
  assert.deepEqual(salesAnalyticsMenus("alert-targets"), ["/sales-alerts"]);
});

test("evaluate (kirim WA) → null = admin saja", () => {
  assert.equal(salesAnalyticsMenus("alerts/evaluate"), null);
});

test("endpoint Kinerja Saya tetap terbuka untuk /me; sisanya Sales Analytics", () => {
  assert.deepEqual(salesAnalyticsMenus("overview"), ["/sales-analytics", "/me"]);
  assert.deepEqual(salesAnalyticsMenus("my-ar"), ["/sales-analytics", "/me"]);
  assert.deepEqual(salesAnalyticsMenus("per-am"), ["/sales-analytics"]);
});
