#!/usr/bin/env node
// Tes bahwa template PR TIDAK membuat cek "PR punya kartu" lolos otomatis.
//   node scripts/qa/uji-template-pr.mjs     (exit 0 = lulus)
//
// Kenapa tes ini ada: template memuat CONTOH baris kartu supaya penulis PR tahu
// bentuknya. Kalau contoh itu ditaruh sebagai teks biasa, gate akan menganggap
// SETIAP PR sudah menautkan kartu — dan cek itu berhenti bermakna tanpa ada yang
// sadar. Contohnya karena itu ditaruh di dalam komentar HTML, yang dibuang gate.
//
// Ini gampang dirusak dengan niat baik: seseorang merapikan template, memindahkan
// contohnya keluar dari komentar supaya "lebih kelihatan", dan gate mati diam-diam.
// Tes ini menangkapnya.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const TPL = new URL("../../.github/pull_request_template.md", import.meta.url).pathname;
const WF = new URL("../../.github/workflows/pr-card-link.yml", import.meta.url).pathname;

// Disalin dari pr-card-link.yml. Tes di bawah memverifikasi salinan ini masih
// sama dengan aslinya, supaya tak menyimpang diam-diam.
const bersih = (raw) =>
  (raw || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/`[^`\n]*`/g, " ");

function lolosGate(raw) {
  const b = bersih(raw);
  return (
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i.test(b) ||
    /\brefs?\s+#(\d+)\b/i.test(b) ||
    /^[ \t]*no-card:[ \t]*(\S.*)$/im.test(b)
  );
}

const tpl = readFileSync(TPL, "utf8");

test("template APA ADANYA ditolak gate — tak ada lolos otomatis", () => {
  assert.equal(
    lolosGate(tpl),
    false,
    "Template membuat gate lolos sendiri. Kemungkinan contoh baris kartu " +
      "dipindahkan keluar dari komentar HTML — kembalikan ke dalam komentar.",
  );
});

test("template LOLOS begitu penulis mengisi baris kartunya", () => {
  const diisi = tpl.replace("## Ringkasan", "No-Card: bug-fix fitur yang sudah live.\n\n## Ringkasan");
  assert.equal(lolosGate(diisi), true);
});

test("Closes/Refs juga diterima", () => {
  for (const baris of ["Closes #123", "Refs #456", "Fixes #789"]) {
    const diisi = tpl.replace("## Ringkasan", `${baris}\n\n## Ringkasan`);
    assert.equal(lolosGate(diisi), true, `bentuk "${baris}" seharusnya diterima`);
  }
});

test("No-Card tanpa alasan tetap ditolak", () => {
  const kosong = tpl.replace("## Ringkasan", "No-Card:\n\n## Ringkasan");
  assert.equal(lolosGate(kosong), false);
});

test("template tetap MENYEBUT ketiga bentuk — panduannya jangan hilang", () => {
  // Kalau contohnya dihapus demi lolos tes pertama, orang kembali menebak.
  for (const kata of ["Closes", "Refs", "No-Card"]) {
    assert.match(tpl, new RegExp(kata), `template tak lagi menyebut "${kata}"`);
  }
});

test("logika pembersihan di tes ini masih sama dengan workflow", () => {
  // Kalau workflow mengubah cara membersihkan badan PR, tes ini bisa lulus
  // atas aturan yang sudah tidak berlaku.
  const wf = readFileSync(WF, "utf8");
  for (const pola of ["```[\\s\\S]*?```", "<!--[\\s\\S]*?-->", "`[^`\\n]*`"]) {
    assert.ok(wf.includes(pola), `workflow tak lagi memakai pola ${pola} — samakan tes ini`);
  }
});
