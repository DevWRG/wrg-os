import { test } from "node:test";
import assert from "node:assert/strict";

import { isoWib } from "./tanggal-wib";

test("03:06 WIB = 20:06 UTC kemarin → tetap tanggal WIB", () => {
  assert.equal(isoWib(new Date("2026-10-11T20:06:00Z")), "2026-10-12");
});

test("16:59 UTC = 23:59 WIB → belum ganti hari", () => {
  assert.equal(isoWib(new Date("2026-10-12T16:59:00Z")), "2026-10-12");
});
