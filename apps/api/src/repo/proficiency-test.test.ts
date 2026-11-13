import { test } from "node:test";
import assert from "node:assert/strict";

import { rapikanProficiencyTest, tanggalSah, type ProficiencyTestUpdate } from "./proficiency-test.js";

// F25 — validasi tanggal & field wajib sebelum ke SQL (dulu 500 / tersimpan kosong).

test("tanggalSah: hanya YYYY-MM-DD yang ada di kalender", () => {
  assert.equal(tanggalSah("2026-01-31"), true);
  assert.equal(tanggalSah("2028-02-29"), true);
  assert.equal(tanggalSah("2026-02-30"), false);
  assert.equal(tanggalSah("2026-13-01"), false);
  assert.equal(tanggalSah("31-01-2026"), false);
  assert.equal(tanggalSah("2026-1-5"), false);
  assert.equal(tanggalSah(""), false);
});

test("rapikanProficiencyTest POST: lengkap → dirapikan, issued_date kosong → null", () => {
  const r = rapikanProficiencyTest({ rs_name: "  RS Contoh ", test_name: "Uji A", expired_date: "2027-01-01", issued_date: "" }, true);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.data.rs_name, "RS Contoh");
    assert.equal(r.data.issued_date, null);
    assert.equal(r.data.expired_date, "2027-01-01");
  }
});

test("rapikanProficiencyTest POST: field wajib hilang / tanggal salah → error", () => {
  assert.deepEqual(rapikanProficiencyTest({ test_name: "Uji A", expired_date: "2027-01-01" }, true), { ok: false, error: "rs_name wajib diisi" });
  assert.deepEqual(rapikanProficiencyTest({ rs_name: "RS", test_name: "Uji A" }, true), { ok: false, error: "expired_date wajib diisi" });
  assert.equal(rapikanProficiencyTest({ rs_name: "RS", test_name: "Uji A", expired_date: "besok" }, true).ok, false);
  assert.equal(rapikanProficiencyTest({ rs_name: "RS", test_name: "Uji A", expired_date: "2027-01-01", issued_date: "2026-02-30" }, true).ok, false);
});

test("rapikanProficiencyTest PATCH: field tak dikirim dibiarkan, field wajib tak boleh dikosongkan", () => {
  assert.deepEqual(rapikanProficiencyTest({ notes: "catatan" }, false), { ok: true, data: { notes: "catatan" } });
  assert.deepEqual(rapikanProficiencyTest({ rs_name: "" }, false), { ok: false, error: "rs_name wajib diisi" });
  assert.deepEqual(rapikanProficiencyTest({ test_name: "   " }, false), { ok: false, error: "test_name wajib diisi" });
  assert.deepEqual(rapikanProficiencyTest({ expired_date: null } as unknown as ProficiencyTestUpdate, false), { ok: false, error: "expired_date wajib diisi" });
  assert.deepEqual(rapikanProficiencyTest({ issued_date: null }, false), { ok: true, data: { issued_date: null } });
  assert.equal(rapikanProficiencyTest({ issued_date: "xx" }, false).ok, false);
  assert.equal(rapikanProficiencyTest({ rs_name: 5 } as unknown as ProficiencyTestUpdate, false).ok, false);
});
