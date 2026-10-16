import { test } from "node:test";
import assert from "node:assert/strict";

import { canViewMargin, canViewProductScorecard } from "./product-scorecard-access";

test("lihat: direktur/admin/HoD default; AM tidak; matriks menang", () => {
  assert.equal(canViewProductScorecard({ role: "direktur" }), true);
  assert.equal(canViewProductScorecard({ role: "user", is_hod: true }), true);
  assert.equal(canViewProductScorecard({ role: "user", title: "HoD Business" }), true);
  assert.equal(canViewProductScorecard({ role: "user", title: "AM" }), false);
  assert.equal(canViewProductScorecard({ role: "user", title: "AM", permissions: { "product-scorecard": { active: true, view: true, create: false, edit: false, delete: false } } }), true);
  assert.equal(canViewProductScorecard(null), false);
});

test("margin: HoD Business / Purchasing / admin / direktur saja", () => {
  assert.equal(canViewMargin({ role: "direktur" }), true);
  assert.equal(canViewMargin({ role: "admin" }), true);
  assert.equal(canViewMargin({ role: "user", title: "HoD Business" }), true);
  assert.equal(canViewMargin({ role: "user", title: "Purchasing" }), true);
  assert.equal(canViewMargin({ role: "user", is_hod: true, title: "HoD Sales East" }), false);
  assert.equal(canViewMargin({ role: "user", title: "AM", permissions: { "product-scorecard": { active: true, view: true, create: false, edit: false, delete: false } } }), false);
});
