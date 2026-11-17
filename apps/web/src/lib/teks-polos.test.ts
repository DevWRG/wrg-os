import { test } from "node:test";
import assert from "node:assert/strict";

import { teksPolos } from "./teks-polos";

test("teksPolos: teks polos lama apa adanya", () => {
  assert.equal(teksPolos("Volume belum terbukti"), "Volume belum terbukti");
  assert.equal(teksPolos(null), "");
});

test("teksPolos: format, judul, daftar, kutipan, tautan diratakan", () => {
  assert.equal(teksPolos("## Catatan\n\n**Penting**: lihat *rekap* ~~lama~~\n\n- satu\n- dua\n\n> kutip\n\n[LIS](https://contoh.id)"),
    "Catatan · Penting: lihat rekap lama · satu · dua · kutip · LIS");
  assert.equal(teksPolos("1. pertama\n2. kedua"), "pertama · kedua");
});

test("teksPolos: tabel jadi baris berkoma, pemisah dibuang", () => {
  assert.equal(teksPolos("| Data | Oleh |\n| --- | --- |\n| Rekap LIS | AM |"), "Data, Oleh · Rekap LIS, AM");
});
