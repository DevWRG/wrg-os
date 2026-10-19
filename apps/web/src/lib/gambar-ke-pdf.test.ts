import { test } from "node:test";
import assert from "node:assert/strict";
import { jpegKePdf } from "./gambar-ke-pdf";

const teks = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

test("jpegKePdf: struktur PDF + offset xref menunjuk ke objek yang benar", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x02, 0xff, 0xd9]);
  const pdf = teks(jpegKePdf(jpeg, 300, 200, 75, 50));

  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.match(pdf, /\/MediaBox \[0 0 75\.00 50\.00\]/);
  assert.match(pdf, /\/Width 300 \/Height 200 /);
  assert.match(pdf, /\/Length 7 >>/);

  const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
  assert.ok(pdf.slice(startxref).startsWith("xref\n0 6\n"));
  const baris = pdf.slice(startxref).split("\n").slice(3, 8);
  baris.forEach((b, i) => {
    const off = Number(b.slice(0, 10));
    assert.ok(pdf.slice(off).startsWith(`${i + 1} 0 obj\n`), `objek ${i + 1}`);
  });
});
