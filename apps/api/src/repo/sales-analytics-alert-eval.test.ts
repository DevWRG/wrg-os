import { test } from "node:test";
import assert from "node:assert/strict";
import { nasibKirim } from "./sales-analytics-alert-eval.js";

test("nasibKirim: ditolak/gagal → gagal (status alert tak diubah); stub/dry-run → uji; live → terkirim", () => {
  assert.equal(nasibKirim({ sent: false, stub: false }), "gagal");               // DITOLAK allowlist / error gateway
  assert.equal(nasibKirim({ sent: false, stub: false, dryRun: false }), "gagal");
  assert.equal(nasibKirim({ sent: true, stub: true }), "uji");                   // dev tanpa gateway
  assert.equal(nasibKirim({ sent: true, stub: false, dryRun: true }), "uji");    // gateway dry-run
  assert.equal(nasibKirim({ sent: true, stub: false, dryRun: false }), "terkirim");
});
