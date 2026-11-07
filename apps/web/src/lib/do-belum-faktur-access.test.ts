import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewDoBelumFaktur } from "./do-belum-faktur-access";

const u = (o: Record<string, unknown> = {}) => ({ role: "user", superuser: false, rbac: true, groups: [{ id: 1 }], permissions: {}, ...o }) as never;
const izin = (view: boolean) => ({ active: true, view, create: false, edit: false, delete: false });

test("menu DO belum difaktur tertutup default; admin/superuser & centang lolos", () => {
  assert.equal(canViewDoBelumFaktur(u()), false);
  assert.equal(canViewDoBelumFaktur(u({ role: "direktur" })), false);
  assert.equal(canViewDoBelumFaktur(u({ superuser: true })), true);
  assert.equal(canViewDoBelumFaktur(u({ permissions: { "do-belum-faktur": izin(true) } })), true);
  assert.equal(canViewDoBelumFaktur(u({ permissions: { "do-belum-faktur": izin(false) } })), false);
  assert.equal(canViewDoBelumFaktur(null), false);
});
