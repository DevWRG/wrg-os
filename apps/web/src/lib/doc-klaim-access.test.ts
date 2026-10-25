import assert from "node:assert/strict";
import { test } from "node:test";

import { alasanTolakPutus, type PemutusKlaim } from "./doc-klaim-access";

const p = (x: Partial<PemutusKlaim>): PemutusKlaim => ({ amId: null, hodKey: null, role: null, superuser: false, finance: false, ...x });

test("klaim lama (tanpa approval): Direktur/admin boleh mewakili", () => {
  const k = { am_id: "A1", hod_key: "arman" };
  assert.equal(alasanTolakPutus(k, p({ role: "admin" })), null);
  assert.equal(alasanTolakPutus(k, p({ role: "direktur" })), null);
});

test("klaim di mesin approval: hanya HoD pengaju — admin & Direktur tidak mewakili", () => {
  const k = { am_id: "A1", hod_key: "arman", approval_request_id: "x" };
  assert.equal(alasanTolakPutus(k, p({ hodKey: "arman" })), null);
  assert.notEqual(alasanTolakPutus(k, p({ role: "admin", superuser: true })), null);
  assert.notEqual(alasanTolakPutus(k, p({ role: "direktur" })), null);
});

test("klaim di mesin approval tanpa HoD: hanya Direktur", () => {
  const k = { am_id: "A1", hod_key: null, approval_request_id: "x" };
  assert.equal(alasanTolakPutus(k, p({ role: "direktur" })), null);
  assert.notEqual(alasanTolakPutus(k, p({ role: "admin" })), null);
});

test("klaim sendiri selalu ditolak", () => {
  assert.notEqual(alasanTolakPutus({ am_id: "A1", hod_key: "arman", approval_request_id: "x" }, p({ amId: "A1", hodKey: "arman" })), null);
});
