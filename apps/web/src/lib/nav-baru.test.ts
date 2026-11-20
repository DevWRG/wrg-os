import { test } from "node:test";
import assert from "node:assert/strict";

import { lencanaMenu, RILIS } from "./nav-baru";
import { findNavItem } from "./nav";

const pada = (s: string) => new Date(`${s}T10:00:00+07:00`);

test("NEW tampil hanya 14 hari sejak rilis", () => {
  assert.equal(lencanaMenu("/riwayat-alat", "NEW", pada("2026-11-17")), "NEW");
  assert.equal(lencanaMenu("/riwayat-alat", "NEW", pada("2026-12-01")), "NEW");
  assert.equal(lencanaMenu("/riwayat-alat", "NEW", pada("2026-12-02")), null);
});

test("menu NEW tanpa tanggal rilis tidak berlencana; badge lain tetap", () => {
  assert.equal(lencanaMenu("/pipeline", "NEW", pada("2026-11-20")), null);
  assert.equal(lencanaMenu("/apa-saja", "BETA", pada("2026-11-20")), "BETA");
  assert.equal(lencanaMenu("/apa-saja", undefined, pada("2026-11-20")), null);
});

test("setiap url di RILIS ada di NAV", () => {
  for (const url of Object.keys(RILIS)) assert.equal(findNavItem(url)?.url, url, url);
});
