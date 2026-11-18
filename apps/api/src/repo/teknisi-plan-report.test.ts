import assert from "node:assert/strict";
import { test } from "node:test";

import { pesanFotoKurang } from "./teknisi-plan-report.js";

test("pesan pengingat foto kurang per alat (336)", () => {
  const t = pesanFotoKurang("Budi", "RSUD Trenggalek", [{ nomor: 1, tes: true, kondisi: false }, { nomor: 2, tes: true, kondisi: true }]);
  assert.equal(t, "📷 Foto #REPORT RSUD Trenggalek belum lengkap, Budi:\n• No. 1: jumlah tes\n• No. 2: jumlah tes & kondisi alat\nKirim dengan caption nomor + jenis, mis. 1 tes · 2 tes · 2 kondisi");
});
