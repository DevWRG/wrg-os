import { test } from "node:test";
import assert from "node:assert/strict";
import { forumBerikutnya, hariForum, pesanAgenda, pesanHod, pesanPendapatForum, tanggalManusia, tanggalWib } from "./kso-jadwal.js";

const wib = (s: string) => new Date(`${s}+07:00`);

test("tanggal WIB tidak bergeser walau server UTC", () => {
  assert.equal(tanggalWib(wib("2026-10-20T23:30:00")), "2026-10-20");
  assert.equal(tanggalWib(wib("2026-10-21T00:30:00")), "2026-10-21");
});

test("hari forum = Selasa & Kamis saja", () => {
  assert.equal(hariForum("2026-10-20"), true); // Selasa
  assert.equal(hariForum("2026-10-22"), true); // Kamis
  assert.equal(hariForum("2026-10-21"), false);
  assert.equal(tanggalManusia("2026-10-20"), "Selasa 20 Okt");
});

test("forum berikutnya: batas data 14.00 hari forum", () => {
  assert.equal(forumBerikutnya(wib("2026-10-22T13:59:00")), "2026-10-22"); // Kamis sebelum 14.00 → Kamis ini
  assert.equal(forumBerikutnya(wib("2026-10-22T14:00:00")), "2026-10-27"); // Kamis sesudah 14.00 → Selasa depan
  assert.equal(forumBerikutnya(wib("2026-10-23T09:00:00")), "2026-10-27"); // Jumat → Selasa
  assert.equal(forumBerikutnya(wib("2026-10-19T09:00:00")), "2026-10-20"); // Senin → Selasa
  assert.equal(forumBerikutnya(wib("2026-10-20T15:00:00")), "2026-10-22"); // Selasa sore → Kamis
});

const it = (jenis: string, nomor: string) => ({ jenis, nomor, faskes_nama: "RS X", alat_nama: "Z3", capex: 53_400_000, gerbang_merah: jenis === "A" ? "1" : null, am_nama: "Budi" });

test("agenda tanpa usulan baru = tinjauan portofolio (forum tidak pernah batal)", () => {
  const t = pesanAgenda("2026-10-20", []);
  assert.match(t, /Selasa 20 Okt, 16\.00 WIB/);
  assert.match(t, /tinjauan portofolio/);
});

test("agenda memuat Agenda A (diuji) dan B (laporan jalur cepat) terpisah", () => {
  const t = pesanAgenda("2026-10-22", [it("A", "KSO-2026-0001"), it("B", "KSO-2026-0002")]);
  assert.match(t, /Agenda A \(1\)[\s\S]*KSO-2026-0001[\s\S]*gerbang tak hijau: 1/);
  assert.match(t, /Agenda B \(1\)[\s\S]*KSO-2026-0002/);
  assert.match(t, /sesudah 14\.00 = forum berikutnya/);
});

test("pesan HOD menyebut tab, kata kerja, dan batas", () => {
  const r = { nomor: "KSO-2026-0003", faskes_nama: "RS X", alat_nama: "Z3", capex: 53_400_000 };
  const p = pesanHod("putusan", "Yogi", r, "Jumat 23 Okt 15.00");
  assert.match(p, /perlu PUTUSAN/);
  assert.match(p, /"Putuskan"/);
  assert.match(p, /Lewat batas = dianggap setuju/);
  const q = pesanHod("pendapat", "Yogi", r, "Selasa 27 Okt 16.00 WIB");
  assert.match(q, /perlu PENDAPAT/);
  assert.match(q, /bukan putusan/);
  assert.doesNotMatch(q, /dianggap setuju/);
});

test("HOD forum: satu pesan berisi semua usulan yang menunggu pendapatnya", () => {
  const r = (n: string) => ({ nomor: n, faskes_nama: "RS X", alat_nama: "Z52", capex: 83_500_000 });
  const t = pesanPendapatForum("Yogi", "2026-10-20", [r("KSO-2026-0036"), r("KSO-2026-0037")]);
  assert.match(t, /\(2 usulan\)/);
  assert.match(t, /1\. KSO-2026-0036[\s\S]*2\. KSO-2026-0037/);
  assert.match(t, /bukan putusan/);
});

test("agenda menampilkan Ketua & Sekretaris dari Susunan Komite; jabatan kosong tidak ditulis", () => {
  const isi = pesanAgenda("2026-10-20", [], { ketua: "Ketua Uji", sekretaris: "Sekretaris Uji" });
  assert.match(isi, /^\*Agenda Forum Komite KSO — .*\*\nKetua: Ketua Uji · Sekretaris: Sekretaris Uji\n/);
  assert.doesNotMatch(pesanAgenda("2026-10-20", [], { ketua: null }), /Ketua:|Sekretaris:/);
});
