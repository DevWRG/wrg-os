import assert from "node:assert/strict";
import { test } from "node:test";

import { cekTabelPdf, lebarKolom, MAKS_BARIS, namaFileTabelPdf, tabelPdf } from "./tabel-pdf.js";

test("cekTabelPdf menolak body rusak, kosong, dan kebanyakan baris", () => {
  assert.equal(cekTabelPdf(null).ok, false);
  assert.equal(cekTabelPdf({ judul: "x", header: ["a"], baris: [] }).ok, false);
  assert.equal(cekTabelPdf({ judul: "x", header: [], baris: [["a"]] }).ok, false);
  const banyak = Array.from({ length: MAKS_BARIS + 1 }, () => ["a"]);
  assert.equal(cekTabelPdf({ judul: "x", header: ["a"], baris: banyak }).ok, false);
});

test("cekTabelPdf menyamakan panjang baris dengan header", () => {
  const r = cekTabelPdf({ judul: "T", header: ["a", "b"], baris: [["1"], ["1", "2", "3"], [null, 5]] });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.data.baris, [["1", ""], ["1", "2"], ["", "5"]]);
});

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
  const buf = await tabelPdf({ judul: "Uji", header: ["No", "Nama", "Nilai"], baris }, { oleh: "QA" });
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length >= 2);
});
