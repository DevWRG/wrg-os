import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FORMAT_KSO, hargaBersih, kelengkapan, nadaBerlaku, pilihTabDaftar, relatif, saringBelumLengkap, saringLolos, sisaHari, statusLampiran,
} from "./kso-komite-daftar";

test("pilihTabDaftar: cakupan terluas dulu, teknik tak pernah, admin sales hanya untuk Lolos", () => {
  const t = (...x: string[]) => x.map((tab) => ({ tab, bolehAksi: false })) as { tab: never; bolehAksi: boolean }[];
  assert.equal(pilihTabDaftar(t("saya", "hod", "sekretariat"), "belum-lengkap")?.tab.tab, "sekretariat");
  assert.equal(pilihTabDaftar(t("saya"), "belum-lengkap")?.cakupan, "rencana Anda");
  assert.equal(pilihTabDaftar(t("hod", "saya"), "lolos-tanpa-forum")?.tab.tab, "hod");
  assert.equal(pilihTabDaftar(t("teknik"), "belum-lengkap"), null);
  assert.equal(pilihTabDaftar(t("penawaran"), "belum-lengkap"), null);
  assert.equal(pilihTabDaftar(t("penawaran", "teknik"), "lolos-tanpa-forum")?.tab.tab, "penawaran");
});

test("statusLampiran: belum / cocok / beda / galat", () => {
  assert.equal(statusLampiran(null), "belum");
  assert.equal(statusLampiran({ lolos: true }), "cocok");
  assert.equal(statusLampiran({ lolos: false }), "beda");
  assert.equal(statusLampiran({ lolos: false, ok: false, galat: "pdf-rusak" }), "galat");
  assert.equal(statusLampiran({ lolos: false, ok: true, galat: null }), "beda");
});

test("kelengkapan: 11 isian dasar, SUMBER/ALASAN menambah total bila muncul", () => {
  assert.deepEqual(kelengkapan([]), { kurang: 0, total: 11, terisi: 11, persen: 100 });
  const tiga = kelengkapan([{ kunci: "fee" }, { kunci: "lampiran" }, { kunci: "pendukung" }]);
  assert.equal(tiga.kurang, 3);
  assert.equal(tiga.terisi, 8);
  assert.equal(tiga.persen, 73);
  const k = kelengkapan([{ kunci: "alasan" }]);
  assert.equal(k.total, 12);
  assert.equal(k.kurang, 1);
  // kunci ganda dihitung sekali
  assert.equal(kelengkapan([{ kunci: "fee" }, { kunci: "fee" }]).kurang, 1);
});

test("hargaBersih: harga × (1 − fee%)", () => {
  assert.equal(hargaBersih(11800, 5), 11210);
  assert.equal(hargaBersih(11800, null), 11800);
  assert.equal(hargaBersih(null, 5), null);
});

test("relatif & sisaHari", () => {
  const kini = new Date("2026-11-10T10:00:00Z");
  assert.equal(relatif("2026-11-10T09:59:40Z", kini), "baru saja");
  assert.equal(relatif("2026-11-10T09:15:00Z", kini), "45 menit lalu");
  assert.equal(relatif("2026-11-10T05:00:00Z", kini), "5 jam lalu");
  assert.equal(relatif("2026-11-09T08:00:00Z", kini), "kemarin");
  assert.equal(relatif("2026-11-01T08:00:00Z", kini), "9 hari lalu");
  assert.equal(relatif(null, kini), "—");
  assert.equal(sisaHari("2026-11-15", "2026-11-10"), 5);
  assert.equal(sisaHari("2026-11-09", "2026-11-10"), -1);
  assert.equal(nadaBerlaku(5), "segera");
  assert.equal(nadaBerlaku(-1), "lewat");
  assert.equal(nadaBerlaku(30), "aman");
  assert.equal(nadaBerlaku(null), "kosong");
});

test("penyaring Belum lengkap: chip gabungan (OR)", () => {
  const b = [{ id: 1, lampiran: null }, { id: 2, lampiran: { lolos: false } }, { id: 3, lampiran: { lolos: true } }];
  assert.deepEqual(saringBelumLengkap(b, { tanpaLampiran: false, lampiranBeda: false }).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(saringBelumLengkap(b, { tanpaLampiran: true, lampiranBeda: false }).map((x) => x.id), [1]);
  assert.deepEqual(saringBelumLengkap(b, { tanpaLampiran: true, lampiranBeda: true }).map((x) => x.id), [1, 2]);
});

test("penyaring Lolos: zona + segera berakhir", () => {
  const b = [
    { id: 1, zona: "am", mandat: { berlaku_sampai: "2026-11-12" } },
    { id: 2, zona: "hod", mandat: { berlaku_sampai: "2026-12-30" } },
    { id: 3, zona: "am", mandat: null },
  ];
  assert.deepEqual(saringLolos(b, { zona: "am", segera: false }, "2026-11-10").map((x) => x.id), [1, 3]);
  assert.deepEqual(saringLolos(b, { zona: "", segera: true }, "2026-11-10").map((x) => x.id), [1]);
});

test("FORMAT_KSO memuat dua belas isian bernomor, tanpa KOTA, tambahan opsional ringkas", () => {
  for (let i = 1; i <= 12; i++) assert.match(FORMAT_KSO, new RegExp(`^${i}\\. `, "m"));
  assert.match(FORMAT_KSO, /^#KSO /);
  assert.match(FORMAT_KSO, /^10\. STATUS UNIT : BARU \/ RELOKASI IDLE \/ EKS KSO \/ EKS DEMO \/ REFURBISH \/ PINJAMAN PRINCIPAL$/m);
  assert.match(FORMAT_KSO, /^11\. BUKTI VOLUME : REKAP LIS 6 BULAN \/ PEMBELIAN REAGEN \/ SURAT RS$/m);
  assert.match(FORMAT_KSO, /^12\. PENDUKUNG : dr\. NAMA, JABATAN \(mis\. kepala instalasi lab\)$/m);
  for (const l of ["ALASAN : …", "JUMLAH : 2", "HARI KERJA : 26"]) assert.ok(FORMAT_KSO.includes(l), l);
  assert.doesNotMatch(FORMAT_KSO, /KOTA/);
  assert.doesNotMatch(FORMAT_KSO, /[<>]/);
});

test("FORMAT_KSO sama persis dengan KSO_FORMAT_ISIAN di API (salinan, belum ada endpoint)", () => {
  const api = readFileSync(fileURLToPath(new URL("../../../api/src/repo/kso-intake.ts", import.meta.url)), "utf8");
  const m = /export const KSO_FORMAT_ISIAN =([\s\S]*?);\n/.exec(api);
  assert.ok(m, "KSO_FORMAT_ISIAN tidak ditemukan di kso-intake.ts");
  const teks = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`) as string).join("");
  assert.equal(FORMAT_KSO, teks);
});
