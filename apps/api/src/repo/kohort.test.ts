import { test } from "node:test";
import assert from "node:assert/strict";

import { petaSumber, susunLeadSource, susunRetensi } from "./kohort.js";

test("susunRetensi: persen, kuartal belum terjadi = null, kohort pertama data = tak lengkap", () => {
  const r = susunRetensi(
    [
      { kohort: "2026-01-01", offset: 0, n: 10 },
      { kohort: "2026-01-01", offset: 1, n: 6 },
      { kohort: "2026-01-01", offset: 2, n: 3 },
      { kohort: "2026-04-01", offset: 0, n: 4 },
      { kohort: "2026-04-01", offset: 1, n: 3 },
    ],
    2026,
    "2026-08-15", // kuartal berjalan = Q3 2026
    "2026-02-10", // data mirror mulai Q1 2026
  );
  const [q1, q2, q3, q4] = r.kohort;
  assert.equal(q1.label, "Q1 2026");
  assert.equal(q1.ukuran, 10);
  assert.deepEqual(q1.persen, [100, 60, 30, null, null]); // +3 = Q4 2026 belum terjadi
  assert.equal(q1.lengkap, false); // kuartal pertama data
  assert.equal(q2.lengkap, true);
  assert.deepEqual(q2.aktif, [4, 3, null, null, null]); // +2 = Q4 belum terjadi
  assert.equal(q3.ukuran, 0);
  assert.deepEqual(q3.persen, [null, null, null, null, null]); // kohort kosong; offset ≤ sekarang tapi ukuran 0
  assert.deepEqual(q4.aktif, [null, null, null, null, null]); // Q4 belum terjadi
  assert.deepEqual([q1.berjalan, q2.berjalan, q3.berjalan, q4.berjalan], [2, 1, 0, null]); // kuartal berjalan = Q3
});

test("susunRetensi: tanpa data → semua kosong, tak NaN", () => {
  const r = susunRetensi([], 2026, "2026-10-21", null);
  assert.equal(r.kohort.length, 4);
  assert.ok(r.kohort.every((k) => k.ukuran === 0 && !k.lengkap));
  assert.deepEqual(r.kohort[0].persen, [null, null, null, null, null]);
});

test("petaSumber: lima sumber Direktur + Lainnya", () => {
  assert.equal(petaSumber("lpse"), "tender");
  assert.equal(petaSumber("referral"), "referensi");
  assert.equal(petaSumber("pameran"), "trade_show");
  assert.equal(petaSumber("telepon"), "cold_call");
  // nilai deal.sumber_lead (migrasi 252)
  assert.equal(petaSumber("vendor"), "vendor");
  assert.equal(petaSumber("tender"), "tender");
  assert.equal(petaSumber("referensi"), "referensi");
  assert.equal(petaSumber("cold_call"), "cold_call");
  for (const s of ["wa", "web", "lainnya", "apa-saja"]) assert.equal(petaSumber(s), "lainnya");
});

test("susunLeadSource: pivot sumber × kuartal × status, vendor tetap ada (0), per HoD per semester", () => {
  const r = susunLeadSource(
    [
      { q: "2026-04-01", source: "lpse", status: "baru", hod: "rocky", n: 2, nilai: 100 },
      { q: "2026-04-01", source: "lpse", status: "dikonversi", hod: "rocky", n: 1, nilai: 50 },
      { q: "2026-07-01", source: "pameran", status: "ditolak", hod: "yogi", n: 3, nilai: 0 },
      { q: "2026-10-01", source: "wa", status: "dihubungi", hod: null, n: 4, nilai: 10 },
      { q: "2025-10-01", source: "lpse", status: "baru", hod: "rocky", n: 99, nilai: 1 }, // tahun lain → diabaikan
    ],
    2026,
    "2026-10-13",
  );
  assert.deepEqual(r.sumber.map((s) => s.key), ["tender", "referensi", "vendor", "trade_show", "cold_call", "lainnya"]);
  const tender = r.sumber[0];
  assert.equal(tender.kuartal[1].total, 3);
  assert.equal(tender.kuartal[1].baru, 2);
  assert.equal(tender.kuartal[1].dikonversi, 1);
  assert.equal(tender.total.nilai, 150);
  assert.equal(r.sumber[2].total.total, 0); // vendor
  assert.equal(r.sumber[3].kuartal[2].ditolak, 3);
  assert.equal(r.sumber[5].kuartal[3].dihubungi, 4); // wa → Lainnya
  const rocky = r.per_hod.find((h) => h.hod_key === "rocky")!;
  assert.equal(rocky.semester[0].total, 3); // Q2 → S1
  assert.equal(r.per_hod.find((h) => h.hod_key === "yogi")!.semester[1].total, 3); // Q3 → S2
  assert.ok(r.per_hod.some((h) => h.hod_key === "(tanpa HoD)"));
});
