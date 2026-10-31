import { test } from "node:test";
import assert from "node:assert/strict";
import { izinHargaBeli } from "./kso-harga-beli.js";
import type { Effective } from "./rbac.js";

const eff = (o: Partial<Effective> = {}): Effective => ({ superuser: false, groups: [{ id: 1, key: "g", name: "G" }], permissions: {}, ...o });
const p = (view: boolean, edit: boolean, active = true) => ({ "kso-simulator-hargabeli": { active, view, create: false, edit, delete: false } });

test("izin kelola harga beli: default tertutup, matriks menentukan, superuser lolos", () => {
  assert.deepEqual(izinHargaBeli(eff()), { lihat: false, ubah: false });
  assert.deepEqual(izinHargaBeli(eff({ superuser: true })), { lihat: true, ubah: true });
  assert.deepEqual(izinHargaBeli(eff({ permissions: p(true, false) })), { lihat: true, ubah: false });
  assert.deepEqual(izinHargaBeli(eff({ permissions: p(false, true) })), { lihat: true, ubah: true });
  assert.deepEqual(izinHargaBeli(eff({ permissions: p(true, true, false) })), { lihat: false, ubah: false });
});
