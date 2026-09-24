// Tes `namaPraDaftar` — nama yang tampil di kartu pra-daftar galeri Pola.
//
// Awalan (wa_group_category_prefix) sengaja cuma penggalan nama: admin memakainya
// untuk menjaring grup yang BELUM pernah kirim pesan, jadi JID-nya belum diketahui.
// Sejak subject openclaw terbaca lagi (#1418), awalan yang cocok ke tepat satu grup
// yang bot-nya sudah join bisa ditampilkan bernama penuh seperti di WhatsApp.
//
// Awalan nyata dari prod 2026-09-24 dipakai sebagai fixture.

import test from "node:test";
import assert from "node:assert/strict";

import { namaPraDaftar } from "./wagroup.js";

const SUBJECTS: Record<string, string> = {
  "120363405660957801@g.us": "Wahana - Snibe",
  "120363427279299767@g.us": "Wahana | HVA Toeloengredjo Pare",
  "120363422805054875@g.us": "KSO alat laboratorium Rsu Ganesha X Wahana",
  "120363402560360858@g.us": "TIM WAHANA & INNOVATION",
};

test("awalan cocok ke satu grup → nama penuh dari subject openclaw", () => {
  assert.equal(
    namaPraDaftar("KSO alat laboratorium", SUBJECTS),
    "KSO alat laboratorium Rsu Ganesha X Wahana",
  );
});

test("awalan menjaring lebih dari satu grup → tetap awalan (ambigu)", () => {
  // "Wahana " menjaring "Wahana - Snibe" dan "Wahana | HVA …". Memilih salah satu
  // berarti melabeli kartu dengan nama grup yang keliru.
  assert.equal(namaPraDaftar("Wahana ", SUBJECTS), "Wahana ");
});

test("bot belum join grupnya → tetap awalan", () => {
  // Kasus nyata prod: 5 dari 11 awalan tak punya padanan subject sama sekali.
  assert.equal(namaPraDaftar("Group PT Wahana X", SUBJECTS), "Group PT Wahana X");
  assert.equal(namaPraDaftar("Aftersales Wahana X", {}), "Aftersales Wahana X");
});

test("pencocokan abai huruf besar/kecil", () => {
  assert.equal(namaPraDaftar("tim wahana &", SUBJECTS), "TIM WAHANA & INNOVATION");
});

test("nama persis sama dengan awalan → tak berubah", () => {
  assert.equal(namaPraDaftar("Wahana - Snibe", SUBJECTS), "Wahana - Snibe");
});
