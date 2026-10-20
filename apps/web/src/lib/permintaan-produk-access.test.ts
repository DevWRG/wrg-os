import { test } from "node:test";
import assert from "node:assert/strict";
import { canPutusPermintaan, canViewPermintaanProduk } from "./permintaan-produk-access";

const u = (o: Record<string, unknown> = {}) => ({ role: "user", superuser: false, rbac: true, groups: [{ id: 1 }], permissions: {}, ...o }) as never;
const izin = (view: boolean, edit: boolean) => ({ active: true, view, create: false, edit, delete: false });

test("menu tertutup default: hanya direktur sebelum matriks diatur; matriks menentukan sesudahnya", () => {
  assert.equal(canViewPermintaanProduk(u()), false);
  assert.equal(canViewPermintaanProduk(u({ role: "direktur" })), true);
  assert.equal(canViewPermintaanProduk(u({ permissions: { "permintaan-produk": izin(true, false) } })), true);
  assert.equal(canViewPermintaanProduk(null), false);
});

test("putusan: role admin TIDAK otomatis, superuser & centang lolos", () => {
  assert.equal(canPutusPermintaan(u({ role: "admin" })), false);
  assert.equal(canPutusPermintaan(u({ superuser: true })), true);
  assert.equal(canPutusPermintaan(u({ role: "direktur" })), true);
  assert.equal(canPutusPermintaan(u({ permissions: { "permintaan-produk-putusan": izin(true, true) } })), true);
  assert.equal(canPutusPermintaan(u({ role: "direktur", permissions: { "permintaan-produk-putusan": izin(true, false) } })), false);
});
