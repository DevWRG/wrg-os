// Tes aturan AKSES insentif F67 (PRD §E) — bagian yang paling mahal kalau salah:
// ini angka penghasilan orang, bukan skor analitik. Murni (tanpa DB), jadi bisa jalan
// di mana saja: `node --test apps/api/dist/repo/insentif.test.js`.
//
// Cabang HoD (scope.cabangScope) TIDAK diuji di sini karena ia menyentuh master_user;
// itu bagian uji integrasi/HTTP. Yang diuji di sini justru cabang-cabang yang menentukan
// fail-closed — kasus yang paling gampang berubah tanpa sengaja.

import test from "node:test";
import assert from "node:assert/strict";

import { resolveAkses, resolveVisibleAms } from "./insentif.js";
import { FULL_SCOPE, type DataScope } from "./access-scope.js";

const scope = (p: Partial<DataScope>): DataScope => ({ ...FULL_SCOPE, ...p });

test("tanpa identitas → TERTUTUP, bukan 'all'", async () => {
  // Inti §E.2.2. resolveScope() jatuh ke FULL_SCOPE kalau x-user-id hilang / user tak
  // ketemu / role bukan 'AM'; untuk payroll itu TIDAK boleh berarti lihat semua.
  // Termasuk panggilan ber-x-service-token tanpa x-user-id — beda dari visibleAms() NPK
  // yang mengembalikan "all" untuk kasus itu.
  for (const s of [undefined, FULL_SCOPE, scope({ userId: null })]) {
    const a = await resolveAkses(s);
    assert.equal(a.level, "none");
    assert.deepEqual(a.ams, []);
    assert.equal(a.selfAmId, null);
  }
});

test("admin/superuser → semua baris", async () => {
  const a = await resolveAkses(scope({ userId: "u1", superuser: true }));
  assert.equal(a.level, "all");
  assert.equal(a.ams, "all");
});

test("admin tanpa am_id tetap 'all', tapi selfAmId null (→ /self balas linked:false)", async () => {
  const a = await resolveAkses(scope({ userId: "u2", superuser: true, amId: null }));
  assert.equal(a.level, "all");
  assert.equal(a.selfAmId, null);
});

test("staff AM → hanya dirinya", async () => {
  const a = await resolveAkses(scope({ userId: "u3", amOnly: true, amId: "1001" }));
  assert.equal(a.level, "self");
  assert.deepEqual(a.ams, ["1001"]);
  assert.equal(a.selfAmId, "1001");
});

test("tertaut karyawan tapi role BUKAN 'AM' (mis. OSP) → dirinya saja", async () => {
  // SENGAJA beda dari visibleAms() di npk-am.ts yang memberi [] untuk kasus ini.
  // Bukan pelebaran akses: /insentif/self sudah memberi data ini sebelum resolver
  // disatukan. Yang diperbaiki: /insentif/:amId untuk am_id DIRI SENDIRI tadinya 404
  // padahal /self 200. 15 OSP masuk skema per SK Pasal 9.4.
  const a = await resolveAkses(scope({ userId: "u4", amOnly: false, amId: "2001" }));
  assert.equal(a.level, "self");
  assert.deepEqual(a.ams, ["2001"]);
});

test("level 'self' TIDAK berhak /insentif/list — dibedakan dari 'team'", async () => {
  // Pagar /list membaca level, bukan panjang daftar. Kalau suatu saat level "self"
  // ikut lolos, AM & OSP dapat menu tim.
  const berhakList = (level: string) => level === "team" || level === "all";
  for (const s of [
    scope({ userId: "u5", amOnly: true, amId: "1001" }),
    scope({ userId: "u6", amOnly: false, amId: "2001" }),
  ]) {
    const a = await resolveAkses(s);
    assert.equal(a.level, "self");
    assert.equal(berhakList(a.level), false, "level 'self' tak boleh lolos pagar /list");
  }
});

test("bukan superuser, tak tertaut, tanpa cabang → TERTUTUP", async () => {
  // Staf office: di menu analitik boleh permisif, di insentif tidak.
  const a = await resolveAkses(scope({ userId: "u7" }));
  assert.equal(a.level, "none");
  assert.deepEqual(a.ams, []);
});

test("HoD yang juga punya am_id: cabang menang atas self (bukan sebaliknya)", async () => {
  // Tanpa cabangScope ter-map, hodKey saja tidak memberi apa pun — resolveScope yang
  // mengisi cabangScope. Di sini hodKey tanpa cabangScope + tanpa am_id → tertutup,
  // bukan "all" (HoD tanpa territory ter-map di resolveScope jatuh ke lihat-semua;
  // insentif TIDAK ikut jatuh ke sana).
  const a = await resolveAkses(scope({ userId: "u8", hodKey: "rocky" }));
  assert.equal(a.level, "none");
});

test("resolveVisibleAms = pembungkus tipis, sepakat dengan resolveAkses", async () => {
  const s = scope({ userId: "u9", amOnly: true, amId: "1001" });
  assert.deepEqual(await resolveVisibleAms(s), (await resolveAkses(s)).ams);
  assert.deepEqual(await resolveVisibleAms(undefined), []);
});
