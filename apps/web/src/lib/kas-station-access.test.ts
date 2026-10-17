import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectivePerm } from "./perms";
import {
  bolehSalahSatu, canKasStation, canKasStationReview, canViewKasStation, izinUntukRute,
} from "./kas-station-access";

const izin = (p: Partial<EffectivePerm>): EffectivePerm => ({ active: true, view: false, create: false, edit: false, delete: false, ...p });

test("tanpa matriks grup: hanya direktur/admin/superuser; AM, HoD, anonim tidak", () => {
  assert.equal(canViewKasStation({ role: "direktur" }), true);
  assert.equal(canViewKasStation({ role: " Admin " }), true);
  assert.equal(canViewKasStation({ role: "am", superuser: true }), true);
  assert.equal(canViewKasStation({ role: "am" }), false);
  assert.equal(canViewKasStation({ role: "hod", is_hod: true }), false);
  assert.equal(canViewKasStation(null), false);
  assert.equal(canViewKasStation(undefined), false);
});

test("matriks Akses Grup menang atas fallback: Direktur dicabut ditolak", () => {
  const u = { role: "direktur", rbac: true, groups: [{ id: 1, key: "g", name: "G" }], permissions: { "kas-station": izin({ view: false }), "kas-station-review": izin({ view: false }) } };
  assert.equal(canViewKasStation(u), false);
});

test("station dan pusat dipisah: station tak bisa approve, pusat tak bisa mencatat", () => {
  const station = { role: "staff", rbac: true, groups: [{ id: 1, key: "st", name: "St" }], permissions: { "kas-station": izin({ view: true, create: true, edit: true }) } };
  const pusat = { role: "finance", rbac: true, groups: [{ id: 2, key: "pu", name: "Pu" }], permissions: { "kas-station-review": izin({ view: true, edit: true }) } };
  assert.equal(canKasStation(station, "create"), true);
  assert.equal(canKasStation(station, "delete"), false);
  assert.equal(canKasStationReview(station, "edit"), false);
  assert.equal(canKasStationReview(pusat, "edit"), true);
  assert.equal(canKasStation(pusat, "create"), false);
  assert.equal(canViewKasStation(station), true);
  assert.equal(canViewKasStation(pusat), true);
});

test("user tanpa grup = tanpa akses walau role direktur (by design canOrLegacy)", () => {
  assert.equal(canViewKasStation({ role: "direktur", rbac: true, groups: [], permissions: {} }), false);
});

test("izinUntukRute: peta method + path ke izin yang tepat", () => {
  assert.deepEqual(izinUntukRute("GET", "cabang"), [["kas-station", "view"], ["kas-station-review", "view"]]);
  assert.deepEqual(izinUntukRute("GET", "harian"), [["kas-station", "view"]]);
  assert.deepEqual(izinUntukRute("GET", "rekap/abc"), [["kas-station", "view"], ["kas-station-review", "view"]]);
  assert.deepEqual(izinUntukRute("POST", "harian"), [["kas-station", "create"]]);
  assert.deepEqual(izinUntukRute("POST", "rekap/abc/submit"), [["kas-station", "create"]]);
  assert.deepEqual(izinUntukRute("POST", "rekap/abc/decide"), [["kas-station-review", "edit"]]);
  assert.deepEqual(izinUntukRute("POST", "rekap/abc/realisasi"), [["kas-station-review", "edit"]]);
  assert.deepEqual(izinUntukRute("PATCH", "harian/abc/transaksi/x"), [["kas-station", "edit"]]);
  assert.deepEqual(izinUntukRute("DELETE", "harian/abc"), [["kas-station", "delete"]]);
  assert.deepEqual(izinUntukRute("post", "harian"), [["kas-station", "create"]]);
});

test("izinUntukRute: rute tak dikenal / method tak didukung → null (tidak diteruskan)", () => {
  assert.equal(izinUntukRute("GET", ""), null);
  assert.equal(izinUntukRute("GET", "harian/abc/transaksi"), null);
  assert.equal(izinUntukRute("PUT", "harian/abc"), null);
  assert.equal(izinUntukRute("POST", "rekap/abc/hapus"), null);
  assert.equal(izinUntukRute("POST", "rekap/abc/decide/extra"), null);
  assert.equal(izinUntukRute("DELETE", "rekap/abc"), null);
  assert.equal(izinUntukRute("GET", "../users"), null);
  assert.equal(izinUntukRute("PATCH", "rekap/abc"), null);
});

test("bolehSalahSatu: pusat boleh baca rekap tapi bukan harian", () => {
  const pusat = { role: "finance", rbac: true, groups: [{ id: 2, key: "pu", name: "Pu" }], permissions: { "kas-station-review": izin({ view: true }) } };
  assert.equal(bolehSalahSatu(pusat, izinUntukRute("GET", "rekap")!), true);
  assert.equal(bolehSalahSatu(pusat, izinUntukRute("GET", "harian")!), false);
  assert.equal(bolehSalahSatu(pusat, izinUntukRute("POST", "rekap/x/decide")!), false); // view saja, tanpa edit
});
