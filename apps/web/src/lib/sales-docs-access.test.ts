import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyDenganPelaku } from "./sales-docs-access";

test("identitas dari body ditimpa pelaku sesi", () => {
  const b = bodyDenganPelaku({ to: "0812", approver_id: "Orang Lain" }, "approver_id", "Saya");
  assert.deepEqual(b, { to: "0812", approver_id: "Saya" });
});

test("field identitas lain ikut dibuang", () => {
  const b = bodyDenganPelaku({ line_item_id: 3, confirmed_by: "X", created_by: "Y", reviewer_id: "Z" }, "confirmed_by", "Saya");
  assert.deepEqual(b, { line_item_id: 3, confirmed_by: "Saya" });
});

test("body bukan objek → objek kosong + pelaku", () => {
  assert.deepEqual(bodyDenganPelaku(null, "reviewer_id", "Saya"), { reviewer_id: "Saya" });
  assert.deepEqual(bodyDenganPelaku([1, 2], null, "Saya"), {});
  assert.deepEqual(bodyDenganPelaku("x", "created_by", "Saya"), { created_by: "Saya" });
});
