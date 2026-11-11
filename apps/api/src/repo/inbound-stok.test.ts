import test from "node:test";
import assert from "node:assert/strict";

import { labelSegarStok } from "./inbound.js";

test("#STOK menyebut waktu sinkron, tandai basi lewat 1 jam", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  assert.match(labelSegarStok(new Date("2026-11-11T09:55:00Z"), now), /^data Accurate per .*16[.:]55$/);
  assert.match(labelSegarStok(new Date("2026-09-09T11:35:00Z"), now), /belum tersegarkan/);
  assert.equal(labelSegarStok(null, now), "waktu sinkron tidak diketahui");
});
