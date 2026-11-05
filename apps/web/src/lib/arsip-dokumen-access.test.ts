import { test } from "node:test";
import assert from "node:assert/strict";
import { canAturBukuArsip, canViewArsipDokumen } from "./arsip-dokumen-access";

const u = (o: Record<string, unknown> = {}) => ({ role: "user", superuser: false, rbac: true, groups: [{ id: 1 }], permissions: {}, ...o }) as never;
const izin = (view: boolean) => ({ active: true, view, create: false, edit: false, delete: false });

test("menu arsip tertutup default: hanya admin/superuser sebelum matriks diatur; matriks menentukan sesudahnya", () => {
  assert.equal(canViewArsipDokumen(u()), false);
  assert.equal(canViewArsipDokumen(u({ role: "direktur" })), false);
  assert.equal(canViewArsipDokumen(u({ superuser: true })), true);
  assert.equal(canViewArsipDokumen(u({ permissions: { "arsip-dokumen": izin(true) } })), true);
  assert.equal(canViewArsipDokumen(u({ permissions: { "arsip-dokumen": izin(false) } })), false);
  assert.equal(canViewArsipDokumen(null), false);
});

test("kode buku: admin/superuser saja, centang menu arsip tidak cukup", () => {
  assert.equal(canAturBukuArsip(u({ role: "admin" })), true);
  assert.equal(canAturBukuArsip(u({ superuser: true })), true);
  assert.equal(canAturBukuArsip(u({ permissions: { "arsip-dokumen": izin(true) } })), false);
  assert.equal(canAturBukuArsip(null), false);
});
