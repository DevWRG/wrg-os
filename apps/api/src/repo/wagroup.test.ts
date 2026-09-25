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

// --- rakitDaftarGrup: perakitan daftar kartu galeri Pola ---------------------
//
// Sejak JID dari state openclaw ikut jadi sumber daftar (bukan cuma monitor_pola
// + wa_message), grup yang bot-nya sudah join langsung punya kartu bernama penuh
// walau belum pernah kirim pesan. Yang dijaga di sini: baris itu tidak menggeser
// data grup yang sudah aktif, dan tidak memunculkan kartu kembar.

import { rakitDaftarGrup, type BarisGrupDb } from "./wagroup.js";

const baris = (over: Partial<BarisGrupDb> & { group_jid: string }): BarisGrupDb => ({
  group_name: over.group_jid,
  category: null,
  note: null,
  has_pola: false,
  message_count: 0,
  last_message_at: null,
  ...over,
});

test("grup dari openclaw tanpa pesan → kartu bernama penuh", () => {
  const rows = [baris({ group_jid: "120363405660957801@g.us" })];
  const out = rakitDaftarGrup(rows, { "120363405660957801@g.us": "Wahana - Snibe" }, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].group_name, "Wahana - Snibe");
  assert.equal(out[0].message_count, 0);
  assert.equal(out[0].has_pola, false);
  assert.equal(out[0].pending, false, "JID-nya diketahui → bukan pra-daftar");
});

test("subject openclaw menang atas nama basi di monitor_pola", () => {
  const jid = "6281335118687-1527497998@g.us";
  const rows = [baris({ group_jid: jid, group_name: "GROUP TRAINING KRM-TAGIH", has_pola: true })];
  const out = rakitDaftarGrup(rows, { [jid]: "PENJUALAN SOLO-JOGJA-PWT" }, []);
  assert.equal(out[0].group_name, "PENJUALAN SOLO-JOGJA-PWT");
});

test("awalan yang sudah cocok ke grup nyata tak jadi kartu pra-daftar (anti kembar)", () => {
  const jid = "120363422805054875@g.us";
  const rows = [baris({ group_jid: jid, group_name: "KSO alat laboratorium Rsu Ganesha X Wahana" })];
  const out = rakitDaftarGrup(rows, {}, [
    { name_prefix: "KSO alat laboratorium", category: "customer", note: null },
  ]);
  assert.equal(out.length, 1, "satu grup = satu kartu");
  assert.equal(out[0].pending, false);
  assert.equal(out[0].category, "customer", "kategori diwarisi dari awalan");
  assert.equal(out[0].category_source, "prefix");
});

test("kategori manual per-JID menang atas kategori awalan", () => {
  const jid = "120363422805054875@g.us";
  const rows = [baris({ group_jid: jid, group_name: "KSO alat laboratorium X", category: "principal" })];
  const out = rakitDaftarGrup(rows, {}, [
    { name_prefix: "KSO alat laboratorium", category: "customer", note: null },
  ]);
  assert.equal(out[0].category, "principal");
  assert.equal(out[0].category_source, "manual");
});

test("awalan tanpa grup apa pun tetap jadi baris pra-daftar", () => {
  const out = rakitDaftarGrup([], {}, [
    { name_prefix: "Group PT Wahana X", category: "customer", note: null },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].pending, true);
  assert.equal(out[0].group_jid, "");
  assert.equal(out[0].group_name, "Group PT Wahana X");
});

test("awalan terpanjang menang saat dua awalan sama-sama cocok", () => {
  const rows = [baris({ group_jid: "1@g.us", group_name: "Wahana - Snibe Surabaya" })];
  const out = rakitDaftarGrup(rows, {}, [
    { name_prefix: "Wahana ", category: "customer", note: null },
    { name_prefix: "Wahana - Snibe", category: "principal", note: null },
  ]);
  const kartu = out.find((g) => g.group_jid === "1@g.us");
  assert.equal(kartu?.category, "principal");
  assert.equal(kartu?.name_prefix, "Wahana - Snibe");
  // Awalan pendek yang ternaungi tak boleh jadi kartu pra-daftar hantu: grupnya
  // sudah ada di daftar, cuma diklaim awalan yang lebih spesifik.
  assert.equal(out.length, 1, "tak ada kartu pra-daftar tambahan");
});
