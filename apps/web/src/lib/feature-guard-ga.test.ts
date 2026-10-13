import { test } from "node:test";
import assert from "node:assert/strict";

import { featureAllowed, featureAllowedAny } from "./feature-guard";
import type { SessionUserSrv } from "./admin-guard";

// Gerbang BFF grup General Affairs (13 Okt 2026): sebelumnya ~45 route GA cuma
// butuh login — user tanpa menu GA bisa mengubah aset, tiket, kendaraan, dan stok
// ATK lewat curl. Sekarang tiap route ikut menu pemiliknya.
const perm = (p: Partial<{ view: boolean; create: boolean; edit: boolean; delete: boolean }>) => ({
  active: true, view: false, create: false, edit: false, delete: false, ...p,
});
const user = (o: Partial<SessionUserSrv>): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [], permissions: {}, ...o }) as SessionUserSrv;
const grup = (permissions: SessionUserSrv["permissions"]) =>
  user({ groups: [{ id: 3, key: "ga", name: "GA" }], permissions });

// Path menu salah ketik = tertutup untuk SEMUA orang (route jadi mati diam-diam),
// jadi pastikan tiap menu yang dipakai gerbang GA memang ada di nav.
test("semua menu yang dipakai gerbang GA ada di nav", () => {
  const admin = user({ role: "admin" });
  for (const m of ["/ga-aset", "/ga-helpdesk", "/vehicles", "/asset-tag", "/atk-master", "/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"]) {
    assert.equal(featureAllowed(admin, m, "view"), true, m);
  }
});

test("user login tanpa menu GA → tertutup", () => {
  assert.equal(featureAllowed(user({}), "/ga-aset", "edit"), false);
  assert.equal(featureAllowedAny(user({}), ["/atk-stock-in", "/atk-stock-out"], "create"), false);
});

test("daftar menu: lolos bila SALAH SATU menu mengizinkan", () => {
  const u = grup({ "atk-stock-out": perm({ view: true, create: true }) });
  assert.equal(featureAllowedAny(u, ["/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"], "create"), true);
  assert.equal(featureAllowedAny(u, ["/atk-stock-in", "/atk-stock-opname"], "create"), false);
  assert.equal(featureAllowedAny(u, "/atk-master", "view"), false);
});

test("izin lihat saja di Aset GA → tak bisa assign/transfer (edit)", () => {
  const u = grup({ "ga-aset": perm({ view: true }) });
  assert.equal(featureAllowedAny(u, "/ga-aset", "view"), true);
  assert.equal(featureAllowedAny(u, "/ga-aset", "edit"), false);
});
