import assert from "node:assert/strict";
import { test } from "node:test";

import { perluApprovalFinance } from "./ga-maintenance.js";

// Ambang default Rp5jt (GA_MAINTENANCE_FINANCE_THRESHOLD tak diset di tes).

test("biaya di atas ambang butuh Finance; di bawah tidak", () => {
  assert.equal(perluApprovalFinance(6_000_000, false, false), true);
  assert.equal(perluApprovalFinance(5_000_000, false, false), false);
  assert.equal(perluApprovalFinance(100_000, false, false), false);
});

test("sudah disetujui Finance → tak perlu lagi", () => {
  assert.equal(perluApprovalFinance(9_000_000, true, false), false);
});

test("pernah ditolak → wajib approval lagi walau biaya diturunkan di bawah ambang", () => {
  // Tanpa ini, tolak Finance lalu ketik ulang biaya 4,9 jt = lolos tanpa Finance.
  assert.equal(perluApprovalFinance(4_900_000, false, true), true);
  assert.equal(perluApprovalFinance(0, false, true), true);
});
