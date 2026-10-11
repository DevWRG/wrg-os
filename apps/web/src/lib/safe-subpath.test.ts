import { test } from "node:test";
import assert from "node:assert/strict";

import { safeSubpath } from "./safe-subpath";

test("segmen polos diteruskan apa adanya", () => {
  assert.equal(safeSubpath(["summary"]), "summary");
  assert.equal(safeSubpath(["am", "rocky", "2026-10"]), "am/rocky/2026-10");
  assert.equal(safeSubpath(["file_v1.2"]), "file_v1.2");
  assert.equal(safeSubpath([]), "");
  assert.equal(safeSubpath(undefined), "");
});

test("segmen tak polos ditolak", () => {
  for (const s of ["..", ".", "a/b", "a\\b", "a%2Fb", "a b", "a?b", ""]) {
    assert.equal(safeSubpath(["ok", s]), null, s);
  }
});
