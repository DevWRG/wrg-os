#!/usr/bin/env node
// Tes routing pesan masuk per grup (lapis 2 pemisahan environment).
//   node scripts/qa/uji-routing-wa.mjs     (exit 0 = lulus)
//
// Logikanya sengaja tinggal di infra/wa-bridge/routing.mjs — modul terpisah —
// supaya bisa diuji tanpa menyalakan bridge, yang memasang setInterval dan
// server HTTP begitu di-import.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDevGroups, pilihTujuan, ringkasRouting } from "../../infra/wa-bridge/routing.mjs";

const RESEARCH = "120363000000000001@g.us";
const SALES = "120363405485256544@g.us";

const cfg = (over = {}) => ({
  devGroups: parseDevGroups(RESEARCH),
  devUrl: "http://127.0.0.1:4200/webhooks/wa",
  devSecret: "rahasia-dev",
  prodUrl: "http://127.0.0.1:4100/webhooks/wa",
  prodSecret: "rahasia-prod",
  ...over,
});

test("grup terdaftar → API dev, dengan secret dev", () => {
  const t = pilihTujuan({ group_jid: RESEARCH }, cfg());
  assert.equal(t.keDev, true);
  assert.match(t.url, /4200/);
  assert.equal(t.secret, "rahasia-dev");
});

test("grup lain → API prod, dengan secret prod", () => {
  const t = pilihTujuan({ group_jid: SALES }, cfg());
  assert.equal(t.keDev, false);
  assert.match(t.url, /4100/);
  assert.equal(t.secret, "rahasia-prod");
});

test("DM (tanpa group_jid) → prod", () => {
  // group_jid null = pesan langsung. Tak boleh nyasar ke dev cuma karena
  // string kosong kebetulan cocok dengan entri kosong di daftar.
  for (const rec of [{ group_jid: null }, { group_jid: "" }, {}]) {
    assert.equal(pilihTujuan(rec, cfg()).keDev, false);
  }
});

test("WA_DEV_GROUPS kosong → semuanya ke prod", () => {
  const c = cfg({ devGroups: parseDevGroups("") });
  assert.equal(pilihTujuan({ group_jid: RESEARCH }, c).keDev, false);
});

test("grup dev terdaftar TAPI tujuan kosong → MELEMPAR, bukan jatuh ke prod", () => {
  // Inti keamanannya. Fallback yang "membantu" ke prod akan menghapus seluruh
  // guna pemisahan: satu salah konfigurasi dan lalu lintas uji masuk prod
  // tanpa ada yang tahu.
  const c = cfg({ devUrl: "" });
  assert.throws(() => pilihTujuan({ group_jid: RESEARCH }, c), /DITAHAN/);
});

test("pesan tertahan itu MENYEBUT grupnya, supaya bisa ditindaklanjuti", () => {
  const c = cfg({ devUrl: "" });
  assert.throws(() => pilihTujuan({ group_jid: RESEARCH }, c), new RegExp(RESEARCH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("parseDevGroups: koma-pisah, spasi & entri kosong diabaikan", () => {
  const s = parseDevGroups(` ${RESEARCH} , , ${SALES} `);
  assert.equal(s.size, 2);
  assert.ok(s.has(RESEARCH) && s.has(SALES));
  assert.equal(parseDevGroups("").size, 0);
  assert.equal(parseDevGroups(undefined).size, 0);
});

test("ringkasan menyala menyebut keadaan yang benar", () => {
  assert.match(ringkasRouting(cfg({ devGroups: parseDevGroups("") })), /MATI/);
  assert.match(ringkasRouting(cfg()), /1 grup →.*4200/);
  // Keadaan paling berbahaya harus paling keras bunyinya.
  assert.match(ringkasRouting(cfg({ devUrl: "" })), /TERTAHAN/);
});
