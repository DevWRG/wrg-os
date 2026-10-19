import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import { canUnggahBuktiPembayaran, canViewBuktiPembayaran } from "./bukti-pembayaran-access";

const izin = (p: Partial<EffectivePerm>): EffectivePerm => ({ active: true, view: false, create: false, edit: false, delete: false, ...p });

test("tanpa matriks: Direktur & Finance melihat; AM, HoD lain, anonim tidak", () => {
  assert.equal(canViewBuktiPembayaran({ role: "direktur" }), true);
  assert.equal(canViewBuktiPembayaran({ role: "hod", hod_key: "ika" }), true);
  assert.equal(canViewBuktiPembayaran({ role: "staff", title: "Finance" }), true);
  assert.equal(canViewBuktiPembayaran({ role: "admin" }), true);
  assert.equal(canViewBuktiPembayaran({ role: "am" }), false);
  assert.equal(canViewBuktiPembayaran({ role: "hod", hod_key: "rocky" }), false);
  assert.equal(canViewBuktiPembayaran(null), false);
});

test("tanpa matriks: unggah = Finance/admin; Direktur hanya membaca", () => {
  assert.equal(canUnggahBuktiPembayaran({ role: "staff", hod_key: "ika" }), true);
  assert.equal(canUnggahBuktiPembayaran({ role: "admin" }), true);
  assert.equal(canUnggahBuktiPembayaran({ role: "direktur" }), false);
  assert.equal(canUnggahBuktiPembayaran({ role: "am" }), false);
});

test("matriks Akses Grup menang atas fallback", () => {
  const grup = [{ id: 1, key: "g", name: "G" }];
  const dicabut = { role: "direktur", rbac: true, groups: grup, permissions: { "bukti-pembayaran": izin({ view: false }) } };
  assert.equal(canViewBuktiPembayaran(dicabut), false);
  const staf = { role: "staff", rbac: true, groups: grup, permissions: { "bukti-pembayaran": izin({ view: true, create: true }) } };
  assert.equal(canViewBuktiPembayaran(staf), true);
  assert.equal(canUnggahBuktiPembayaran(staf), true);
  const bacaSaja = { role: "staff", rbac: true, groups: grup, permissions: { "bukti-pembayaran": izin({ view: true }) } };
  assert.equal(canUnggahBuktiPembayaran(bacaSaja), false);
});
