// F91 #FAKTUR — logika murni (tanpa DB): status turunan, tahap & jadwal ulang
// reminder, format balasan & digest.
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { deriveInvoiceStatus } from "./ar.js";
import {
  buildOverdueRecap,
  buildReminderDigest,
  byUrgency,
  formatFakturReply,
  isoWeek,
  overdueRecapKey,
  parseFakturArg,
  reminderKey,
  reminderStage,
  statusLine,
  type ReminderRow,
} from "./faktur.js";

const TODAY = "2026-09-28";

test("deriveInvoiceStatus: OPEN / OVERDUE / PAID", () => {
  assert.deepEqual(deriveInvoiceStatus({ status: "OPEN", outstanding: 100 }, "2026-10-05", TODAY), {
    state: "OPEN",
    due_date: "2026-10-05",
    days_to_due: 7,
  });
  assert.equal(deriveInvoiceStatus({ status: "OPEN", outstanding: 100 }, "2026-09-28", TODAY).state, "OPEN");
  const od = deriveInvoiceStatus({ status: "OPEN", outstanding: 100 }, "2026-09-16", TODAY);
  assert.equal(od.state, "OVERDUE");
  assert.equal(od.days_to_due, -12);
  assert.equal(deriveInvoiceStatus({ status: "PAID", outstanding: 0 }, "2026-09-01", TODAY).state, "PAID");
});

test("deriveInvoiceStatus: sisa 0 dianggap lunas walau status masih OPEN", () => {
  assert.equal(deriveInvoiceStatus({ status: "OPEN", outstanding: 0 }, "2026-09-01", TODAY).state, "PAID");
});

test("deriveInvoiceStatus: due date tak diketahui → OPEN, bukan overdue", () => {
  assert.deepEqual(deriveInvoiceStatus({ status: "OPEN", outstanding: 5 }, null, TODAY), {
    state: "OPEN",
    due_date: null,
    days_to_due: null,
  });
  assert.equal(deriveInvoiceStatus({ status: "OPEN", outstanding: 5 }, "bukan-tanggal", TODAY).days_to_due, null);
});

test("parseFakturArg ambil token pertama", () => {
  assert.equal(parseFakturArg("  SI.2026.09.00123 tolong dicek "), "SI.2026.09.00123");
  assert.equal(parseFakturArg(""), "");
});

test("reminderStage: rentang D-7, D-day, overdue", () => {
  assert.equal(reminderStage(null), null);
  assert.equal(reminderStage(8), null);
  assert.equal(reminderStage(7), "d7");
  assert.equal(reminderStage(1), "d7");
  assert.equal(reminderStage(0), "d0");
  assert.equal(reminderStage(-1), "od");
  assert.equal(reminderStage(-90), "od");
});

test("reminderKey unik per tahap × invoice × penerima", () => {
  assert.equal(reminderKey("od", 42, "fin"), "f91:od:42:fin");
  assert.notEqual(reminderKey("od", 42, "fin"), reminderKey("od", 42, "am"));
  assert.notEqual(reminderKey("d7", 42, "am"), reminderKey("d0", 42, "am"));
});

test("statusLine", () => {
  assert.match(statusLine({ state: "OVERDUE", due_date: "2026-09-16", days_to_due: -12 }), /OVERDUE 12 hari/);
  assert.match(statusLine({ state: "OPEN", due_date: TODAY, days_to_due: 0 }), /HARI INI/);
  assert.match(statusLine({ state: "OPEN", due_date: null, days_to_due: null }), /tidak tercatat/);
  assert.match(statusLine({ state: "PAID", due_date: null, days_to_due: null }), /LUNAS/);
});

test("formatFakturReply memuat status, jatuh tempo, nominal, customer", () => {
  const txt = formatFakturReply({
    number: "SI.2026.09.00123",
    customer_name: "RS Uji",
    tanggal: "2026-08-17",
    total: 1_500_000,
    paid: 500_000,
    outstanding: 1_000_000,
    lunas_at: null,
    am: "Dewi Fixture",
    cabang: "SURABAYA",
    state: "OVERDUE",
    due_date: "2026-09-16",
    days_to_due: -12,
  });
  assert.match(txt, /Faktur SI\.2026\.09\.00123/);
  assert.match(txt, /RS Uji/);
  assert.match(txt, /OVERDUE 12 hari/);
  assert.match(txt, /Sisa: Rp1\.000\.000/);
  assert.match(txt, /Dewi Fixture \(SURABAYA\)/);
  assert.match(txt, /mirror Accurate/);
});

const row = (p: Partial<ReminderRow>): ReminderRow => ({
  id: 1,
  number: "SI-1",
  customer_name: "RS A",
  outstanding: 1000,
  due_date: TODAY,
  days_to_due: 0,
  stage: "d0",
  am_id: "AM1",
  am_nama: "Dewi",
  am_wa: "628111000001",
  ...p,
});

test("buildReminderDigest: D-day dulu, lalu D-7 terdekat", () => {
  const { text } = buildReminderDigest(
    [
      row({ id: 1, number: "SI-D7-JAUH", stage: "d7", days_to_due: 6, due_date: "2026-10-04" }),
      row({ id: 2, number: "SI-D7-DEKAT", stage: "d7", days_to_due: 2, due_date: "2026-09-30" }),
      row({ id: 3, number: "SI-D0" }),
    ],
    "fin",
    TODAY,
  );
  const i0 = text.indexOf("SI-D0");
  const i2 = text.indexOf("SI-D7-DEKAT");
  const i6 = text.indexOf("SI-D7-JAUH");
  assert.ok(i0 > 0 && i0 < i2 && i2 < i6, text);
  assert.match(text, /hari ini/);
  assert.match(text, /2 hari lagi/);
  assert.match(text, /AM Dewi/);
});

test("buildReminderDigest AM: sapa nama, tanpa kolom AM", () => {
  const { text } = buildReminderDigest([row({})], "am", TODAY, "Dewi");
  assert.match(text, /Halo Dewi/);
  assert.doesNotMatch(text, /· AM /);
});

test("buildReminderDigest: maks N baris, sisanya disebut & TIDAK ikut shownIds", () => {
  const rows = Array.from({ length: 45 }, (_, k) =>
    row({ id: k + 1, number: `SI-${k + 1}`, stage: k < 5 ? "d0" : "d7", days_to_due: k < 5 ? 0 : 1 + (k % 7) }),
  );
  const d = buildReminderDigest(rows, "fin", TODAY, undefined, 30);
  assert.equal(d.shownIds.length, 30);
  for (let k = 1; k <= 5; k++) assert.ok(d.shownIds.includes(k), "semua D-day wajib tampil");
  assert.match(d.text, /dan 15 invoice lainnya/);
  assert.match(d.text, /Jatuh tempo ≤7 hari\* \(40\)/); // header tetap menyebut jumlah sebenarnya
  assert.ok(d.text.length < 6000, `pesan ${d.text.length} karakter`);
});

test("byUrgency: d0 < d7 < od, lalu yang terdekat", () => {
  const sorted = [
    row({ id: 1, stage: "od", days_to_due: -3 }),
    row({ id: 2, stage: "d7", days_to_due: 5 }),
    row({ id: 3, stage: "d0", days_to_due: 0 }),
    row({ id: 4, stage: "d7", days_to_due: 1 }),
  ].sort(byUrgency);
  assert.deepEqual(sorted.map((r) => r.id), [3, 4, 2, 1]);
});

test("isoWeek: batas tahun & Senin–Minggu satu minggu", () => {
  assert.equal(isoWeek("2026-10-12"), "2026-W42"); // Senin
  assert.equal(isoWeek("2026-10-18"), "2026-W42"); // Minggu
  assert.equal(isoWeek("2026-10-19"), "2026-W43");
  assert.equal(isoWeek("2027-01-01"), "2026-W53"); // Jumat → masih minggu terakhir 2026
  assert.equal(isoWeek("2021-01-03"), "2020-W53");
  assert.equal(overdueRecapKey("2026-W42"), "f91:odrecap:2026-W42:fin");
});

test("buildOverdueRecap: total, ember umur, N terbesar", () => {
  const rows = [
    row({ id: 1, number: "OD-10", stage: "od", days_to_due: -10, outstanding: 1_000_000 }),
    row({ id: 2, number: "OD-45", stage: "od", days_to_due: -45, outstanding: 5_000_000 }),
    row({ id: 3, number: "OD-200", stage: "od", days_to_due: -200, outstanding: 2_000_000 }),
  ];
  const txt = buildOverdueRecap(rows, TODAY, 3, 2);
  assert.match(txt, /3 invoice · sisa Rp8\.000\.000/);
  assert.match(txt, /1–30 hari: 1 invoice · Rp1\.000\.000/);
  assert.match(txt, /31–60 hari: 1 invoice · Rp5\.000\.000/);
  assert.match(txt, />90 hari: 1 invoice · Rp2\.000\.000/);
  assert.doesNotMatch(txt, /61–90 hari/); // ember kosong tak ditampilkan
  assert.ok(txt.indexOf("OD-45") < txt.indexOf("OD-200"), "urut sisa terbesar");
  assert.doesNotMatch(txt, /OD-10 —/); // topN=2
  assert.match(txt, /3 invoice terbesar sudah dicek ulang/);
});

// Di main, test filter kind (inbound-kind-filter.test.ts) belum ada — kasus
// #FAKTUR dijaga di sini: `\b` mencegah #FAKTURIS/#FAKTUR123 ikut terpicu.
test("detectKind: #FAKTUR terpicu, #FAKTURIS/#FAKTUR123 tidak", async () => {
  const { detectKind } = await import("./inbound.js");
  assert.equal(detectKind("#FAKTUR SI.2026.09.00123"), "faktur");
  assert.equal(detectKind("#faktur si.2026.09.00123 tolong dicek"), "faktur");
  assert.equal(detectKind("pagi tim\n# FAKTUR SI-1"), "faktur");
  assert.equal(detectKind("#FAKTURIS rapat jam 3"), "none");
  assert.equal(detectKind("#FAKTUR123"), "none");
});

test("nominal berpecahan sen dibulatkan (rekap prod 11 Okt: Rp…,942)", () => {
  const rows = [
    row({ id: 1, number: "OD-A", stage: "od", days_to_due: -5, outstanding: 1000.471 }),
    row({ id: 2, number: "OD-B", stage: "od", days_to_due: -5, outstanding: 2000.471 }),
  ];
  const txt = buildOverdueRecap(rows, TODAY, 0);
  assert.match(txt, /sisa Rp3\.001\n/);
  assert.doesNotMatch(txt, /Rp[\d.]+,\d/);
  const d = buildReminderDigest([row({ outstanding: 1234.5 })], "fin", TODAY);
  assert.match(d.text, /sisa Rp1\.235 /);
});
