import assert from "node:assert/strict";
import { test } from "node:test";

import { lebarKolom, namaFileTabelPdf, tabelPdf } from "./tabel-pdf.js";

test("lebarKolom berjumlah total & kolom panjang lebih lebar", () => {
  const w = lebarKolom(["No", "Nama"], [["1", "x".repeat(40)]], 100);
  assert.ok(Math.abs(w[0] + w[1] - 100) < 1e-9);
  assert.ok(w[1] > w[0]);
});

test("namaFileTabelPdf membuat slug aman", () => {
  assert.equal(namaFileTabelPdf("Revenue / Customer!", new Date("2026-10-19T00:00:00Z")), "revenue-customer-2026-10-19.pdf");
});

test("tabelPdf menghasilkan PDF multi-halaman", async () => {
  const baris = Array.from({ length: 150 }, (_, i) => [String(i), `Customer ${i} → ✅`, "Rp 1.000"]);
  const buf = await tabelPdf({ judul: "Uji", ringkasan: [{ label: "Total", nilai: "Rp 1" }, { label: "Baris", nilai: "150" }, { label: "Ke-3", nilai: "x" }], header: ["No", "Nama", "Nilai"], baris }, { oleh: "QA" });
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length >= 2);
});
