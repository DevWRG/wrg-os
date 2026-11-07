import { test } from "node:test";
import assert from "node:assert/strict";

import { MAKS_DOK, formatWaLink, jendelaBriefing, labelBriefing, potongDok } from "./weekly-briefing.js";

// Senin 26 Okt 2026 07:00 WIB = Minggu ISO 44; dasar = minggu 43 (19–25 Okt).
const SENIN = new Date("2026-10-26T00:00:00Z"); // 07:00 WIB

test("jendelaBriefing: target = minggu berjalan, dasar = minggu lalu", () => {
  const j = jendelaBriefing(SENIN);
  assert.deepEqual(j.target, { isoYear: 2026, isoWeek: 44, from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(j.dasar, { isoYear: 2026, isoWeek: 43, from: "2026-10-19", to: "2026-10-25" });
});

test("jendelaBriefing: menyeberangi pergantian tahun ISO", () => {
  // Senin 4 Jan 2027 = minggu ISO 1 tahun 2027; dasar = minggu 53 tahun 2026.
  const j = jendelaBriefing(new Date("2027-01-03T23:00:00Z")); // 04 Jan 06:00 WIB
  assert.equal(j.target.isoYear, 2027);
  assert.equal(j.target.isoWeek, 1);
  assert.equal(j.dasar.isoYear, 2026);
  assert.equal(j.dasar.isoWeek, 53);
  assert.equal(j.dasar.from, "2026-12-28");
});

test("jendelaBriefing: override minggu target", () => {
  const j = jendelaBriefing(SENIN, { isoYear: 2026, isoWeek: 40 });
  assert.equal(j.target.from, "2026-09-28");
  assert.equal(j.dasar.isoWeek, 39);
});

test("labelBriefing menyebut minggu target dan dasar", () => {
  const l = labelBriefing(jendelaBriefing(SENIN));
  assert.match(l, /Briefing Minggu Depan: 26 Oktober – 1 November 2026/);
  assert.match(l, /dasar: rekap & resume 19–25 Oktober 2026/);
});

test("formatWaLink: hanya pengantar + link; tanpa link → null", () => {
  const j = jendelaBriefing(SENIN);
  const t = formatWaLink(j, "https://os.example/briefings?tab=mingguan");
  assert.ok(t);
  assert.match(t!, /Minggu 44/);
  assert.match(t!, /https:\/\/os\.example\/briefings\?tab=mingguan$/);
  assert.equal(formatWaLink(j, null), null);
});

test("potongDok: pendek utuh, panjang dipotong dengan penanda", () => {
  assert.equal(potongDok("abc"), "abc");
  const panjang = "x".repeat(MAKS_DOK + 50);
  const p = potongDok(panjang);
  assert.ok(p.startsWith("x".repeat(MAKS_DOK)));
  assert.match(p, /dipotong, 50 karakter lagi/);
});
