import { test } from "node:test";
import assert from "node:assert/strict";

import { monitorGate } from "./monitor-access";

test("sub-path Monitor dipetakan ke menu pemiliknya", () => {
  assert.deepEqual(monitorGate("resume", "GET"), { menus: ["/monitor/resume"], action: "view" });
  assert.deepEqual(monitorGate("stats", "GET"), { menus: ["/monitor/rekap"], action: "view" });
  assert.deepEqual(monitorGate("groups", "GET")?.menus, ["/monitor/pola", "/monitor/members"]);
});

test("generate cukup izin lihat; ubah data butuh edit", () => {
  assert.equal(monitorGate("resume/generate", "POST")?.action, "view");
  assert.equal(monitorGate("rekap/generate", "POST")?.action, "view");
  assert.equal(monitorGate("members", "POST")?.action, "edit");
  assert.equal(monitorGate("pola", "POST")?.action, "edit");
});

test("segmen tak dikenal → null (route menolak kecuali admin)", () => {
  assert.equal(monitorGate("rahasia", "GET"), null);
  assert.equal(monitorGate("", "POST"), null);
});
