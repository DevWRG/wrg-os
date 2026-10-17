import { test } from "node:test";
import assert from "node:assert/strict";

import { nilaiKeaslian, ringkasPerAm } from "./pipeline-keaslian.js";

// Pipeline Authenticity — aturan status (17 Okt 2026).

const HARI = "2026-10-17";
const buka = { stage: "Negotiation", stage_masuk: "2026-10-01", on_hold: false, tertaut: true };
const kunjBaru = [{ tanggal: "2026-10-10", bukti: true }];

test("deal terbuka sehat → TERVERIFIKASI", () => {
  const r = nilaiKeaslian(buka, kunjBaru, null, HARI);
  assert.equal(r.status, "TERVERIFIKASI");
  assert.deepEqual(r.alasan, []);
  assert.equal(r.lama_tahap, 16);
});

test("tanpa kunjungan 60 hari → PERLU_CEK; + macet → MERAGUKAN", () => {
  const a = nilaiKeaslian(buka, [{ tanggal: "2026-08-01", bukti: true }], null, HARI);
  assert.equal(a.status, "PERLU_CEK");
  assert.match(a.alasan[0].teks, /terakhir 1 Agu 2026/);
  const b = nilaiKeaslian({ ...buka, stage_masuk: "2026-08-01" }, [], null, HARI);
  assert.equal(b.status, "MERAGUKAN");
  assert.ok(b.alasan.some((x) => x.kode === "macet" && /77 hari \(batas 30\)/.test(x.teks)));
});

test("macet: batas per tahap, on_hold dikecualikan", () => {
  assert.equal(nilaiKeaslian({ ...buka, stage: "Closing", stage_masuk: "2026-10-02" }, kunjBaru, null, HARI).status, "PERLU_CEK"); // 15 > 14
  assert.equal(nilaiKeaslian({ ...buka, stage: "Closing", stage_masuk: "2026-10-03" }, kunjBaru, null, HARI).status, "TERVERIFIKASI"); // 14 = batas
  const h = nilaiKeaslian({ ...buka, stage_masuk: "2026-01-01", on_hold: true }, kunjBaru, null, HARI);
  assert.equal(h.status, "TERVERIFIKASI");
  assert.ok(h.alasan.some((x) => x.kode === "ditahan"));
  assert.equal(nilaiKeaslian({ ...buka, stage: "First Contact", stage_masuk: "2026-08-17" }, kunjBaru, null, HARI).status, "PERLU_CEK"); // 61 > 60
  assert.equal(nilaiKeaslian({ ...buka, stage: "First Contact", stage_masuk: "2026-08-18" }, kunjBaru, null, HARI).status, "TERVERIFIKASI"); // 60 = batas
});

test("kunjungan tanpa bukti → PERLU_CEK", () => {
  const r = nilaiKeaslian(buka, [{ tanggal: "2026-10-10", bukti: false }, { tanggal: "2026-09-20", bukti: false }], null, HARI);
  assert.equal(r.status, "PERLU_CEK");
  assert.match(r.alasan[0].teks, /2 kunjungan 60 hari terakhir tanpa foto bergeotag/);
});

test("Won: faktur ada → sah; tanpa faktur >60 hari → MERAGUKAN; ≤60 → menunggu; tak tertaut → info", () => {
  const won = { stage: "Closing-Won", stage_masuk: "2026-07-01", on_hold: false, tertaut: true };
  assert.equal(nilaiKeaslian(won, [], "2026-07-15", HARI).status, "TERVERIFIKASI");
  const m = nilaiKeaslian(won, [], null, HARI);
  assert.equal(m.status, "MERAGUKAN");
  assert.match(m.alasan[0].teks, /Won 108 hari lalu/);
  const t = nilaiKeaslian({ ...won, stage_masuk: "2026-09-01" }, [], null, HARI);
  assert.equal(t.status, "TERVERIFIKASI");
  assert.equal(t.alasan[0].kode, "menunggu_faktur");
  assert.equal(nilaiKeaslian({ ...won, tertaut: false }, [], null, HARI).alasan[0].kode, "won_tak_tertaut");
});

test("ringkasPerAm: urut paling banyak meragukan", () => {
  const r = ringkasPerAm([
    { am: "A", status: "TERVERIFIKASI", nilai: 10 }, { am: "A", status: "MERAGUKAN", nilai: 5 },
    { am: "B", status: "MERAGUKAN", nilai: 7 }, { am: "B", status: "MERAGUKAN", nilai: 3 },
  ]);
  assert.equal(r[0].am, "B");
  assert.equal(r[0].nilai_meragukan, 10);
  assert.equal(r[1].persen_terverifikasi, 0.5);
});

test("kunjunganCocok: semua kata inti nama deal ada di laporan, jenis tak bertentangan", async () => {
  const { kunjunganCocok } = await import("./pipeline-keaslian.js");
  assert.equal(kunjunganCocok("RSUD Trenggalek", "Cust : RSUD Kab. Trenggalek"), true);
  assert.equal(kunjunganCocok("RS Prima Medika", "rs prima medika denpasar"), true);
  assert.equal(kunjunganCocok("PKM Gondang Legi", "RSI Gondang Legi"), false);  // jenis beda
  assert.equal(kunjunganCocok("RS Harapan Sehat Jatibarang", "RS Harapan Sehat"), false); // kata kurang
  assert.equal(kunjunganCocok("Puskesmas", "Puskesmas Kertosono"), false);     // terlalu umum
  assert.equal(kunjunganCocok("Dinas Kesehatan", "Dinkes Kab Kediri"), false);
});
