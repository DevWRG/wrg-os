import { test } from "node:test";
import assert from "node:assert/strict";

import { atkCreateMenus, MENU_ATK_KOREKSI } from "./atk-access";
import { findNavItem } from "./nav";

test("catat masuk: Stock In atau Opname — bukan Stock Out", () => {
  assert.deepEqual(atkCreateMenus("in"), ["/atk-stock-in", "/atk-stock-opname"]);
});

test("catat keluar: Stock Out atau Opname — bukan Stock In", () => {
  assert.deepEqual(atkCreateMenus("out"), ["/atk-stock-out", "/atk-stock-opname"]);
});

test("jenis tak dikenal → null (400)", () => {
  assert.equal(atkCreateMenus("adjust"), null);
  assert.equal(atkCreateMenus(undefined), null);
});

test("koreksi (edit/hapus) hanya menu Stock In, dan semua path ada di NAV", () => {
  assert.deepEqual(MENU_ATK_KOREKSI, ["/atk-stock-in"]);
  for (const p of ["/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"]) assert.equal(findNavItem(p)?.url, p);
});
