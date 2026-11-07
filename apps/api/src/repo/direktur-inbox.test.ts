import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatWaDigest, hitungPerJenis, tandaInbox, umurHari, urutkanInbox, type InboxItem,
} from "./direktur-inbox.js";

const NOW = new Date("2026-10-16T03:00:00Z");

const it = (over: Partial<InboxItem> = {}): InboxItem => ({
  jenis: "approval", id: "1", kode: "APR-0001", judul: "Beli reagen", pengaju: "Budi", nominal: 12_500_000,
  menunggu_sejak: "2026-10-14T03:00:00Z", umur_hari: 2, link: "/approval-requests/1", aksi_wa: "#APPROVE APR-0001", ...over,
});

test("umurHari: hari penuh, tak pernah negatif, tanggal rusak = 0", () => {
  assert.equal(umurHari("2026-10-14T03:00:00Z", NOW), 2);
  assert.equal(umurHari("2026-10-15T20:00:00Z", NOW), 0);
  assert.equal(umurHari("2026-10-20T00:00:00Z", NOW), 0);
  assert.equal(umurHari("bukan tanggal", NOW), 0);
});

test("urutkanInbox: tertua dulu, seri stabil per jenis lalu kode, input tak dimutasi", () => {
  const a = it({ jenis: "po", kode: "PO-2", umur_hari: 5 });
  const b = it({ jenis: "approval", kode: "APR-9", umur_hari: 9 });
  const c = it({ jenis: "approval", kode: "APR-1", umur_hari: 5 });
  const input = [a, b, c];
  assert.deepEqual(urutkanInbox(input).map((x) => x.kode), ["APR-9", "APR-1", "PO-2"]);
  assert.deepEqual(input.map((x) => x.kode), ["PO-2", "APR-9", "APR-1"]);
});

test("hitungPerJenis mengisi nol untuk jenis tanpa item", () => {
  assert.deepEqual(hitungPerJenis([it(), it({ jenis: "po" }), it({ jenis: "po" })]),
    { approval: 1, po: 2, fund: 0, insentif: 0, lembur: 0 });
});

test("formatWaDigest: header, hitungan, nominal ringkas, petunjuk #APPROVE, link", () => {
  const t = formatWaDigest([it(), it({ jenis: "po", kode: "PO-7", judul: "PT Maju", nominal: 2_300_000_000, aksi_wa: null, umur_hari: 1 })],
    "https://x.test/direktur-inbox");
  assert.match(t, /Direktur Inbox\* · 2 menunggu keputusan/);
  assert.match(t, /Approval F11 1 · Purchase Order 1/);
  assert.match(t, /APR-0001 · Beli reagen · Rp 12,5 jt · 2 hari/);
  assert.match(t, /PO-7 · PT Maju · Rp 2,3 M · 1 hari/);
  assert.match(t, /#APPROVE APR-0001 atau #REJECT APR-0001 alasan/);
  assert.match(t, /https:\/\/x\.test\/direktur-inbox/);
});

test("formatWaDigest: tanpa petunjuk bila tak ada item ber-aksi WA; kurung sudut dibuang", () => {
  const t = formatWaDigest([it({ jenis: "fund", aksi_wa: null, judul: "Beli <script> ATK" })], null);
  assert.doesNotMatch(t, /#APPROVE/);
  assert.doesNotMatch(t, /[<>]/);
  assert.doesNotMatch(t, /Detail & tautan/);
});

test("formatWaDigest: maks 10 baris + 'dan N lainnya'; item tertua yang tampil", () => {
  const banyak = Array.from({ length: 14 }, (_, i) => it({ kode: `APR-${String(i).padStart(4, "0")}`, umur_hari: i }));
  const t = formatWaDigest(banyak, null);
  assert.match(t, /…dan 4 lainnya/);
  assert.equal(t.split("\n").filter((l) => l.startsWith("•")).length, 10);
  assert.match(t, /APR-0013/);
  assert.doesNotMatch(t, /APR-0000/);
});

test("formatWaDigest: panjang dibatasi", () => {
  const panjang = Array.from({ length: 10 }, (_, i) => it({ kode: `APR-${i}`, judul: "x".repeat(900) }));
  assert.ok(formatWaDigest(panjang, "https://x.test").length <= 3500);
});

test("tandaInbox tak peduli urutan, peka terhadap isi", () => {
  const a = it({ kode: "A" }), b = it({ jenis: "po", kode: "B" });
  assert.equal(tandaInbox([a, b]), tandaInbox([b, a]));
  assert.notEqual(tandaInbox([a, b]), tandaInbox([a]));
});

test("formatWaDigest: nominal ringkas — satu desimal di bawah 100 jt, bulat di atasnya, tanpa desimal .0", () => {
  const t = formatWaDigest([
    it({ kode: "A", nominal: 2_500_000 }), it({ kode: "B", nominal: 3_000_000 }),
    it({ kode: "C", nominal: 250_000_000 }), it({ kode: "D", nominal: 750_000 }), it({ kode: "E", nominal: null }),
  ], null);
  assert.match(t, /A · Beli reagen · Rp 2,5 jt/);
  assert.match(t, /B · Beli reagen · Rp 3 jt/);
  assert.match(t, /C · Beli reagen · Rp 250 jt/);
  assert.match(t, /D · Beli reagen · Rp 750\.000/);
  assert.match(t, /E · Beli reagen · \d+ hari/);
});
