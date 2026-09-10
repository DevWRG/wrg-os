// Penjaga kelas-bug: backslash TUNGGAL di dalam template literal sql`...`.
//
// Di dalam template literal JavaScript, `\s` luruh jadi `s`, `\D` jadi `D`,
// `\w` jadi `w`. Postgres lalu menerima pola yang berbeda dari yang ditulis —
// TANPA error apa pun. Yang benar `\\s`, atau lebih baik bentuk kelas karakter
// `[^0-9]` yang tak butuh backslash sama sekali.
//
// Sudah terjadi dua kali: `repo/cashin.ts` membuang huruf D dari nomor rekening
// alih-alih karakter non-digit (gagal senyap, rekening lolos ke pencocokan nama
// file), dan sebuah perubahan pencocokan faskes nyaris mengirimkan cacat yang
// sama sebelum ketahuan. Tak ada linter yang menangkapnya, jadi ditangkap di
// sini — `pnpm test` menjaring apps/*/src, sehingga berkas ini ikut CI.
//
// Murni (tanpa DB):  node --test apps/api/dist/repo/sql-backslash.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DI_SINI = dirname(fileURLToPath(import.meta.url));
// src/repo → src → api → apps → akar repo
const AKAR = join(DI_SINI, "..", "..", "..", "..");
const DIPINDAI = ["apps/api/src", "apps/web/src", "packages"];
const DILEWATI = new Set(["node_modules", "dist", ".next", ".turbo"]);

function berkasTs(dir: string): string[] {
  let hasil: string[] = [];
  let isi: string[];
  try {
    isi = readdirSync(dir);
  } catch {
    return hasil;
  }
  for (const nama of isi) {
    if (DILEWATI.has(nama)) continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) hasil = hasil.concat(berkasTs(p));
    else if (nama.endsWith(".ts") || nama.endsWith(".tsx")) hasil.push(p);
  }
  return hasil;
}

/**
 * Isi tiap template literal yang diawali `sql` (termasuk bentuk bergenerik
 * `sql<Baris[]>`). Sarang `${...}` dilacak supaya backtick di dalam ekspresi
 * tak disangka penutup, dan backslash ditelan berpasangan.
 */
function isiTemplateSql(teks: string): { mulai: number; isi: string }[] {
  const hasil: { mulai: number; isi: string }[] = [];
  const pembuka = /\bsql(?:<[^`]*?>)?`/g;
  let m: RegExpExecArray | null;
  while ((m = pembuka.exec(teks)) !== null) {
    const mulai = m.index + m[0].length;
    let j = mulai;
    let sarang = 0;
    while (j < teks.length) {
      const c = teks[j];
      if (c === "\\") { j += 2; continue; }
      if (c === "$" && teks[j + 1] === "{") { sarang += 1; j += 2; continue; }
      if (c === "}" && sarang > 0) sarang -= 1;
      else if (c === "`" && sarang === 0) break;
      j += 1;
    }
    hasil.push({ mulai, isi: teks.slice(mulai, j) });
    pembuka.lastIndex = j + 1;
  }
  return hasil;
}

// Backslash yang TIDAK berpasangan. Pasangan `\\` ditelan utuh lebih dulu,
// kalau tidak backslash keduanya akan tertuduh sebagai pelanggaran.
function offsetBackslashTunggal(isi: string): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < isi.length) {
    if (isi[k] === "\\") {
      if (isi[k + 1] === "\\") { k += 2; continue; }
      out.push(k);
      k += 2;
      continue;
    }
    k += 1;
  }
  return out;
}

test("tak ada backslash tunggal di dalam template literal sql`...`", () => {
  const pelanggaran: string[] = [];
  for (const sub of DIPINDAI) {
    for (const berkas of berkasTs(join(AKAR, sub))) {
      if (berkas.endsWith("sql-backslash.test.ts")) continue;
      const teks = readFileSync(berkas, "utf8");
      for (const { mulai, isi } of isiTemplateSql(teks)) {
        for (const off of offsetBackslashTunggal(isi)) {
          const baris = teks.slice(0, mulai + off).split("\n").length;
          pelanggaran.push(`${relative(AKAR, berkas)}:${baris}`);
        }
      }
    }
  }
  assert.deepEqual(
    pelanggaran,
    [],
    `Backslash tunggal di dalam sql\`...\` luruh secara diam-diam (\\s → s).\n` +
      `Pakai \\\\s, atau bentuk kelas karakter seperti [^0-9]. Lokasi:\n  ` +
      pelanggaran.join("\n  "),
  );
});

test("pemindainya sendiri memang mengenali pelanggaran", () => {
  // Tanpa uji ini, sebuah pemindai yang rusak akan selalu lulus dan penjaganya
  // jadi hiasan belaka.
  const contoh = String.raw`const q = sql\`SELECT regexp_replace(a, '\D', '', 'g')\`;`
    .replace(/\\`/g, "`");
  const [t] = isiTemplateSql(contoh);
  assert.equal(offsetBackslashTunggal(t.isi).length, 1);

  const benar = String.raw`const q = sql\`SELECT regexp_replace(a, '\\s+', ' ', 'g')\`;`
    .replace(/\\`/g, "`");
  const [b] = isiTemplateSql(benar);
  assert.equal(offsetBackslashTunggal(b.isi).length, 0);
});
