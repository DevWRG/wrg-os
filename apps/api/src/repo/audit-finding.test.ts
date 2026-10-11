import { test } from "node:test";
import assert from "node:assert/strict";

import { decideBlockReason } from "./audit-finding.js";

// F60 — pemisahan tugas chain approval penutupan temuan (post-fraud).
const steps = (decided: (string | null)[]) => decided.map((d, i) => ({ urutan: i + 1, decidedBy: d }));

test("anggota sah yang belum memutus tahap lain → boleh", () => {
  assert.equal(decideBlockReason({ deciderUserId: "b", requestedBy: "a", currentUrutan: 2, steps: steps(["c", null]) }), null);
});

test("pengaju tidak boleh memutus pengajuannya sendiri", () => {
  assert.match(decideBlockReason({ deciderUserId: "a", requestedBy: "a", currentUrutan: 1, steps: steps([null, null]) }) ?? "", /pengaju/);
});

test("orang yang sudah memutus tahap 1 tidak boleh memutus tahap 2", () => {
  assert.match(decideBlockReason({ deciderUserId: "b", requestedBy: "a", currentUrutan: 2, steps: steps(["b", null]) }) ?? "", /tahap 1/);
});

test("pengaju null (user dihapus) tidak memblokir siapa pun", () => {
  assert.equal(decideBlockReason({ deciderUserId: "b", requestedBy: null, currentUrutan: 1, steps: steps([null, null]) }), null);
});

test("decidedBy di tahap current sendiri tidak dihitung (baris belum diputus)", () => {
  assert.equal(decideBlockReason({ deciderUserId: "b", requestedBy: "a", currentUrutan: 1, steps: steps(["b", null]) }), null);
});
