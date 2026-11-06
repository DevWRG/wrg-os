import { test } from "node:test";
import assert from "node:assert/strict";

import { scopeMedia } from "./media-scope";
import { featureKey, findNavItem } from "./nav";
import type { SessionUserSrv } from "./admin-guard";

const lihat = { active: true, view: true, create: false, edit: false, delete: false };
const kunci = (url: string) => { const it = findNavItem(url)!; return it.feature ?? featureKey(it.url); };
const user = (o: Partial<SessionUserSrv>): SessionUserSrv =>
  ({ id: "u", email: "u@x", role: "user", rbac: true, groups: [{ id: 2, key: "g", name: "G" }], permissions: {}, ...o }) as SessionUserSrv;

test("login tanpa izin menu terkait → tak ada scope (dulu cukup login)", () => {
  assert.deepEqual(scopeMedia(user({})), []);
  assert.deepEqual(scopeMedia(user({ permissions: { overview: lihat } })), []);
});

test("izin lihat Visits → hanya foto kunjungan WA", () => {
  assert.deepEqual(scopeMedia(user({ permissions: { [kunci("/visits")]: lihat } })), ["wa"]);
});

test("izin lihat Aset GA atau Relokasi Aset → hanya berkas GA", () => {
  assert.deepEqual(scopeMedia(user({ permissions: { [kunci("/ga-aset")]: lihat } })), ["ga"]);
  assert.deepEqual(scopeMedia(user({ permissions: { [kunci("/ga-relokasi")]: lihat } })), ["ga"]);
});

test("admin / superuser → keduanya", () => {
  assert.deepEqual(scopeMedia(user({ role: "admin" })), ["wa", "ga"]);
  assert.deepEqual(scopeMedia(user({ superuser: true })), ["wa", "ga"]);
});
