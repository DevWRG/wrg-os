import assert from "node:assert/strict";
import { test } from "node:test";

import { putusanDeteksiAi } from "./detectleave.js";

// #2007 — 5 Nov 2026 kuota OpenRouter habis; services/ai balas 200 +
// is_leave:false dengan model "dry-run-fallback", dan detect-leave menandai tiga
// pengajuan izin asli `not-leave` secara permanen. "bukan-izin" hanya boleh lahir
// dari LLM yang benar-benar berjalan.

const izinJelas = { is_leave: true, nama: "Budi", jenis: "sakit", confidence: 0.95, model: "anthropic/claude-haiku-4.5", dry_run: false };

test("LLM sungguhan bilang izin → izin", () => {
  assert.equal(putusanDeteksiAi(200, izinJelas), "izin");
});

test("LLM sungguhan bilang bukan izin → bukan-izin (boleh ditandai)", () => {
  assert.equal(putusanDeteksiAi(200, { is_leave: false, confidence: 0.9, model: "anthropic/claude-haiku-4.5", dry_run: false }), "bukan-izin");
});

test("confidence rendah dari LLM sungguhan → bukan-izin", () => {
  assert.equal(putusanDeteksiAi(200, { ...izinJelas, confidence: 0.4 }), "bukan-izin");
});

test("insiden 5 Nov: fallback 200 ber-is_leave false → coba lagi, BUKAN bukan-izin", () => {
  const balasan = { is_leave: false, nama: null, jenis: null, confidence: 0.0, model: "dry-run-fallback", dry_run: true };
  assert.equal(putusanDeteksiAi(200, balasan), "coba-lagi");
});

test("fallback tanpa flag dry_run tetap dikenali dari model", () => {
  assert.equal(putusanDeteksiAi(200, { is_leave: false, confidence: 0, model: "dry-run-fallback" }), "coba-lagi");
});

test("services/ai tanpa key (model dry-run) → coba lagi", () => {
  assert.equal(putusanDeteksiAi(200, { is_leave: false, model: "dry-run", dry_run: true }), "coba-lagi");
});

test("503 dari callAi (hasil terdegradasi ditolak) → coba lagi", () => {
  assert.equal(putusanDeteksiAi(503, { error: "x", degraded: true, model: "dry-run-fallback" }), "coba-lagi");
});

test("services/ai error 500 → coba lagi", () => {
  assert.equal(putusanDeteksiAi(500, {}), "coba-lagi");
});
