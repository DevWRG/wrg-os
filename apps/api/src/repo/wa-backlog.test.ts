// Tes `tandaBacklog` — processed_result untuk pesan tumpukan offline (tap V4
// openclaw) yang disimpan lewat /webhooks/wa/backlog tanpa diproses/dibalas.

import test from "node:test";
import assert from "node:assert/strict";

import { tandaBacklog } from "./wa.js";

test("hitung keterlambatan dari ts_ms pesan ke arrived_ms", () => {
  const r = tandaBacklog({ ts_ms: Date.parse("2026-11-26T13:40:00Z"), arrived_ms: Date.parse("2026-11-27T07:05:00Z") });
  assert.equal(r.src, "openclaw offline backlog");
  assert.equal(r.tiba, "2026-11-27T07:05:00.000Z");
  assert.equal(r.telat_menit, 1045);
});

test("ts ISO dipakai bila ts_ms tak ada", () => {
  const r = tandaBacklog({ ts: "2026-11-27T07:00:00.000Z", arrived_ms: Date.parse("2026-11-27T07:15:00Z") });
  assert.equal(r.telat_menit, 15);
});

test("tanpa arrived_ms → tiba & telat null, tidak NaN", () => {
  const r = tandaBacklog({ ts_ms: 1 });
  assert.equal(r.tiba, null);
  assert.equal(r.telat_menit, null);
});
