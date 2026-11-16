import test from "node:test";
import assert from "node:assert/strict";

import { abaikanTanpaLlm, bersihkanIsi, isStafGa, rencanakan, teksKomentar, type AksiLlm, type PesanAduan } from "./ga-aduan-wa.js";

const at = new Date("2026-11-16T01:55:00Z"); // 08:55 WIB
const pesan = (ref: string, stafGa: boolean, isi = "x"): PesanAduan => ({ mid: `id-${ref}`, ref, pengirim: stafGa ? "Staf GA" : "Pelapor", stafGa, isi, at });
const aksi = (ref: string, jenis: string, extra: Partial<AksiLlm> = {}): AksiLlm => ({
  ref, jenis, tiket: null, judul: null, kategori: null, lokasi: null, prioritas: null, yakin: 0.9, ...extra,
});

test("bersihkanIsi buang lampiran mentah, nomor mention & spasi ganda", () => {
  assert.equal(bersihkanIsi("Sudah dicuci  [whatsapp attachment unavailable]"), "Sudah dicuci (lampiran)");
  assert.equal(bersihkanIsi("tolong @100000000000001\nke bank"), "tolong @… ke bank");
});

test("isStafGa cocok nama tanpa peduli huruf & spasi", () => {
  assert.equal(isStafGa(" staf ga ", ["Staf GA"]), true);
  assert.equal(isStafGa("Pelapor", ["Staf GA"]), false);
  assert.equal(isStafGa("", [""]), false);
});

test("pesan kosong & hashtag tak dikirim ke LLM", () => {
  assert.equal(abaikanTanpaLlm("  "), "kosong");
  assert.equal(abaikanTanpaLlm("#HELPDESK lampu mati"), "hashtag");
  assert.equal(abaikanTanpaLlm("lampu mati"), null);
});

test("aduan baru lalu balasan GA di kelompok yang sama tertaut lewat ref", () => {
  const r = rencanakan(
    [pesan("M1", false), pesan("M2", true), pesan("M3", true)],
    [aksi("M1", "aduan_baru"), aksi("M2", "progres", { tiket: "M1" }), aksi("M3", "selesai", { tiket: "M1" })],
    new Set(),
  );
  assert.equal(r.get("M1")?.op, "buat");
  assert.deepEqual(r.get("M2"), { op: "progres", target: { ref: "M1" } });
  assert.deepEqual(r.get("M3"), { op: "selesai", target: { ref: "M1" } });
});

test("balasan ke tiket terbuka hari sebelumnya", () => {
  const r = rencanakan([pesan("M1", true)], [aksi("M1", "selesai", { tiket: "TKT-2026-00007" })], new Set(["TKT-2026-00007"]));
  assert.deepEqual(r.get("M1"), { op: "selesai", target: { ticketNo: "TKT-2026-00007" } });
});

test("target tak dikenal → tak tertaut, bukan menebak tiket lain", () => {
  const r = rencanakan([pesan("M1", true), pesan("M2", false)], [aksi("M1", "progres", { tiket: "TKT-2026-09999" }), aksi("M2", "komentar", { tiket: null })], new Set(["TKT-2026-00001"]));
  assert.equal(r.get("M1")?.op, "tak-tertaut");
  assert.equal(r.get("M2")?.op, "abaikan");
});

test("ref ke pesan yang bukan aduan baru tak sah", () => {
  const r = rencanakan([pesan("M1", false), pesan("M2", true)], [aksi("M1", "abaikan"), aksi("M2", "progres", { tiket: "M1" })], new Set());
  assert.equal(r.get("M2")?.op, "tak-tertaut");
});

test("progres dari pelapor jadi komentar; selesai dari pelapor tetap sah", () => {
  const r = rencanakan(
    [pesan("M1", false), pesan("M2", false)],
    [aksi("M1", "progres", { tiket: "TKT-1" }), aksi("M2", "selesai", { tiket: "TKT-1" })],
    new Set(["TKT-1"]),
  );
  assert.equal(r.get("M1")?.op, "komentar");
  assert.equal(r.get("M2")?.op, "selesai");
});

test("putusan ragu: status tak diubah (komentar), aduan ragu diabaikan", () => {
  const r = rencanakan(
    [pesan("M1", true), pesan("M2", false)],
    [aksi("M1", "selesai", { tiket: "TKT-1", yakin: 0.4 }), aksi("M2", "aduan_baru", { yakin: 0.3 })],
    new Set(["TKT-1"]),
  );
  assert.equal(r.get("M1")?.op, "komentar");
  assert.equal(r.get("M2")?.op, "abaikan");
});

test("pelapor membatalkan permintaan; batal ragu cukup komentar", () => {
  const r = rencanakan(
    [pesan("M1", false), pesan("M2", false), pesan("M3", false)],
    [aksi("M1", "aduan_baru"), aksi("M2", "batal", { tiket: "M1" }), aksi("M3", "batal", { tiket: "TKT-1", yakin: 0.3 })],
    new Set(["TKT-1"]),
  );
  assert.deepEqual(r.get("M2"), { op: "batal", target: { ref: "M1" } });
  assert.equal(r.get("M3")?.op, "komentar");
});

test("pesan staf GA tidak pernah membuka tiket baru", () => {
  const r = rencanakan([pesan("M1", true)], [aksi("M1", "aduan_baru")], new Set());
  assert.equal(r.get("M1")?.op, "abaikan");
});

test("pesan yang tak diputus LLM ditandai tanpa-putusan", () => {
  const r = rencanakan([pesan("M1", false)], [], new Set());
  assert.equal(r.get("M1")?.op, "tanpa-putusan");
});

test("teks komentar memuat waktu WIB & pengirim", () => {
  assert.equal(teksKomentar({ pengirim: "Staf GA", isi: "ya mbak", at }), "💬 WA 16/11 08:55 — Staf GA: ya mbak");
});
