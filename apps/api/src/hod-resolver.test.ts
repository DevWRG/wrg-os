import assert from "node:assert/strict";
import { test } from "node:test";

import { hodStatus, resolveHod, resolveHods, type Hod } from "./hod-resolver.js";

// Daftar HoD kini datang dari master_hod (migrasi 198) dan dioper ke resolver.
// Tes memakai daftar buatan supaya yang diuji murni aturan pencocokannya.
const h = (key: string, aliases: string[], roleHints: string[]): Hod => ({
  key, name: key, panggilan: key, peran: key, role: `HoD ${key}`, aliases, roleHints,
});
const HODS: Hod[] = [
  h("rocky", ["rocky", "roki", "roky"], ["hod sales east", "sales east"]),
  h("yogi", ["yogi"], ["hod sales west", "sales west"]),
  h("muhid", ["muhid", "muhit"], ["hod aftersales", "aftersales"]),
  h("mufid", ["mufid"], ["business ivd"]),
  h("arman", ["arman"], ["business medical"]),
];

test("alias nama & hint peran", () => {
  assert.equal(resolveHod("Pak Yogi (HOD)", HODS), "yogi");
  assert.equal(resolveHod("Rocky Gunawan (HOD Sales East)", HODS), "rocky");
  assert.equal(resolveHod("Kepala Aftersales", HODS), "muhid");
});

test("multi-HoD = ambiguous, bukan tebakan", () => {
  assert.deepEqual(resolveHods("4 HOD (Rocky/Yogi/Arman/Mufid)", HODS).sort(), ["arman", "mufid", "rocky", "yogi"]);
  assert.equal(resolveHod("4 HOD (Rocky/Yogi/Arman/Mufid)", HODS), null);
  assert.equal(hodStatus("4 HOD (Rocky/Yogi/Arman/Mufid)", HODS), "ambiguous");
});

test("fuzzy hanya untuk alias ≥5 huruf", () => {
  assert.equal(resolveHod("Pak Muhud", HODS), "muhid"); // typo 1 huruf, alias 5 huruf
  assert.equal(resolveHod("Pak Yugi", HODS), null);     // alias 4 huruf → tak di-fuzzy
});

test("daftar kosong → tak ada yang ter-resolve (tanpa cadangan tersembunyi di kode)", () => {
  assert.equal(hodStatus("Pak Yogi (HOD)", []), "none");
});
