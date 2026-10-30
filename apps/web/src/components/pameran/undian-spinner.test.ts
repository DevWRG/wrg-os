import { test } from "node:test";
import assert from "node:assert/strict";
import { jadwalPutar } from "./undian-spinner";

test("jadwal putar: cepat rata dulu, lalu melambat sampai berhenti, total ±4–7 dtk", () => {
  const j = jadwalPutar();
  const total = j.reduce((a, b) => a + b, 0);
  assert.ok(total >= 4000 && total <= 7000, `total ${total} ms`);
  assert.equal(j[0], 45);
  const ekor = j.slice(j.findIndex((d) => d > 45));
  for (let i = 1; i < ekor.length; i++) assert.ok(ekor[i] >= ekor[i - 1], "fase lambat tak boleh mempercepat lagi");
  assert.ok(j[j.length - 1] >= 400, "jeda terakhir cukup lambat untuk terbaca");
});
