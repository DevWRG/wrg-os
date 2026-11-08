import { test } from "node:test";
import assert from "node:assert/strict";
import { canViewRegisterCek, izinAksi } from "./register-cek-access";

const u = (o: Record<string, unknown> = {}) => ({ role: "user", superuser: false, rbac: true, groups: [{ id: 1 }], permissions: {}, ...o }) as never;
const izin = (view: boolean) => ({ active: true, view, create: false, edit: false, delete: false });

test("menu Register Cek tertutup default; admin/superuser & centang lolos", () => {
  assert.equal(canViewRegisterCek(u()), false);
  assert.equal(canViewRegisterCek(u({ role: "direktur" })), false);
  assert.equal(canViewRegisterCek(u({ superuser: true })), true);
  assert.equal(canViewRegisterCek(u({ permissions: { "register-cek": izin(true) } })), true);
  assert.equal(canViewRegisterCek(u({ permissions: { "register-cek": izin(false) } })), false);
  assert.equal(canViewRegisterCek(null), false);
});

test("izinAksi: setujui/tolak = ubah, sisanya tambah, tak dikenal = null", () => {
  assert.equal(izinAksi("setujui"), "edit");
  assert.equal(izinAksi("tolak"), "edit");
  for (const a of ["ajukan", "serahkan", "cair", "tolak_bank", "batal"]) assert.equal(izinAksi(a), "create");
  assert.equal(izinAksi("hapus"), null);
  assert.equal(izinAksi("../x"), null);
});
