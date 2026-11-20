import { test } from "node:test";
import assert from "node:assert/strict";

import { npkGate } from "./npk-api-access";

test("daftar skor = menu tim; skor satu orang = menu tim atau Saya", () => {
  assert.deepEqual(npkGate("scores", "GET"), { menus: ["/npk"], action: "view" });
  assert.deepEqual(npkGate("scores/42", "GET"), { menus: ["/npk", "/npk/self"], action: "view" });
  assert.deepEqual(npkGate("am/scores", "GET"), { menus: ["/npk/am"], action: "view" });
  assert.deepEqual(npkGate("am/scores/AM07", "GET"), { menus: ["/npk/am", "/npk/am-self"], action: "view" });
});

test("hitung ulang butuh aksi create di menu tim", () => {
  assert.deepEqual(npkGate("compute", "POST"), { menus: ["/npk"], action: "create" });
  assert.deepEqual(npkGate("am/compute", "POST"), { menus: ["/npk/am"], action: "create" });
});

test("sub-path atau method di luar peta → null", () => {
  assert.equal(npkGate("scores", "POST"), null);
  assert.equal(npkGate("compute", "GET"), null);
  assert.equal(npkGate("scores/1/x", "GET"), null);
  assert.equal(npkGate("rahasia", "GET"), null);
});
