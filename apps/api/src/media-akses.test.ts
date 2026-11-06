import { test } from "node:test";
import assert from "node:assert/strict";
import { isInsideRoot, rootDariScope } from "./media-akses.js";

const R = { wa: "/home/u/.openclaw/media", ga: "/home/u/.wrg-os/uploads/ga-assets" };

test("isInsideRoot: di dalam root saja; traversal & folder bertetangga ditolak", () => {
  assert.ok(isInsideRoot("/home/u/.openclaw/media/a/b.jpg", R.wa));
  assert.ok(!isInsideRoot("/home/u/.openclaw/media/../secret.txt", R.wa));
  assert.ok(!isInsideRoot("/home/u/.openclaw/media-lain/x.jpg", R.wa));
  assert.ok(!isInsideRoot("/etc/passwd", R.wa));
});

test("rootDariScope: hanya root yang diminta; kosong/tak dikenal = tak ada", () => {
  assert.deepEqual(rootDariScope("wa", R), [R.wa]);
  assert.deepEqual(rootDariScope("ga", R), [R.ga]);
  assert.deepEqual(rootDariScope(" GA , wa ", R).sort(), [R.ga, R.wa].sort());
  assert.deepEqual(rootDariScope("", R), []);
  assert.deepEqual(rootDariScope(undefined, R), []);
  assert.deepEqual(rootDariScope("semua", R), []);
});
