import assert from "node:assert/strict";
import { test } from "node:test";

import { gatewayFetch, pathGatewayAman } from "./gateway";

// Uji dev 12 Okt 2026: Next 16 men-decode %2F di param [id], lalu fetch()
// menormalkan dot-segment → permintaan ber-x-service-token lari ke route lain.
test("path sah tetap lolos", () => {
  for (const p of ["/print-specs/12", "/kso-kontrak/a1b2/status", "/media/foto.v2.jpg", "/report/calendar/day?date=2026-10-12", "/x?q=../y", "/", ""]) {
    assert.equal(pathGatewayAman(p), true, p);
  }
});

test("dot-segment, ter-encode, dan backslash ditolak", () => {
  for (const p of [
    "/print-specs/../../users",
    "/print-specs/..",
    "/print-specs/./x",
    "/print-specs/%2e%2e/users",
    "/print-specs/.%2E/users",
    "/print-specs/..\\health",
    "/print-specs/%E0%A4%A",
  ]) {
    assert.equal(pathGatewayAman(p), false, p);
  }
});

test("gatewayFetch menolak path tak sah dengan 400 tanpa memanggil backend", async () => {
  const asli = globalThis.fetch;
  let dipanggil = false;
  globalThis.fetch = (async () => {
    dipanggil = true;
    return new Response("{}");
  }) as typeof fetch;
  try {
    const res = await gatewayFetch("/print-specs/../../users");
    assert.equal(res.status, 400);
    assert.equal(dipanggil, false);
  } finally {
    globalThis.fetch = asli;
  }
});
