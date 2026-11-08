import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewPenerbitanFaktur } from "./penerbitan-faktur-access";

const u = (o: Record<string, unknown> = {}) => ({ role: "user", superuser: false, rbac: true, groups: [{ id: 1 }], permissions: {}, ...o }) as never;
const izin = (view: boolean) => ({ active: true, view, create: false, edit: false, delete: false });

test("menu Penerbitan Faktur tertutup default; admin/superuser & centang lolos", () => {
  assert.equal(canViewPenerbitanFaktur(u()), false);
  assert.equal(canViewPenerbitanFaktur(u({ role: "direktur" })), false);
  assert.equal(canViewPenerbitanFaktur(u({ superuser: true })), true);
  assert.equal(canViewPenerbitanFaktur(u({ permissions: { "penerbitan-faktur": izin(true) } })), true);
  assert.equal(canViewPenerbitanFaktur(u({ permissions: { "penerbitan-faktur": izin(false) } })), false);
  assert.equal(canViewPenerbitanFaktur(null), false);
});
