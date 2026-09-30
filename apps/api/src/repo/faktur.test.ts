// F91 #FAKTUR — logika murni (tanpa DB): status turunan, tahap & jadwal ulang
// reminder, format balasan & digest.
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { deriveInvoiceStatus } from "./ar.js";
import {
  buildReminderDigest,
  formatFakturReply,
  parseFakturArg,
  reminderDue,
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

test("reminderDue: D-7/D-day sekali, overdue mingguan", () => {
  const now = Date.parse("2026-09-28T01:00:00Z");
  const day = 86400000;
  assert.equal(reminderDue("d7", null, now, 7), true);
  assert.equal(reminderDue("d7", new Date(now - 30 * day), now, 7), false);
  assert.equal(reminderDue("d0", new Date(now - 30 * day), now, 7), false);
  assert.equal(reminderDue("od", null, now, 7), true);
  assert.equal(reminderDue("od", new Date(now - 6 * day), now, 7), false);
  assert.equal(reminderDue("od", new Date(now - 7 * day), now, 7), true);
  // cron jalan sedikit lebih awal dari minggu lalu tetap dihitung 7 hari
  assert.equal(reminderDue("od", new Date(now - 7 * day + 10 * 60000), now, 7), true);
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

test("buildReminderDigest: dikelompokkan per tahap, overdue dulu", () => {
  const txt = buildReminderDigest(
    [
      row({ id: 1, number: "SI-D7", stage: "d7", days_to_due: 5, due_date: "2026-10-03" }),
      row({ id: 2, number: "SI-OD", stage: "od", days_to_due: -3, due_date: "2026-09-25" }),
      row({ id: 3, number: "SI-D0" }),
    ],
    "fin",
    TODAY,
  );
  const iOd = txt.indexOf("SI-OD");
  const iD0 = txt.indexOf("SI-D0");
  const iD7 = txt.indexOf("SI-D7");
  assert.ok(iOd > 0 && iOd < iD0 && iD0 < iD7, txt);
  assert.match(txt, /lewat 3 hari/);
  assert.match(txt, /5 hari lagi/);
  assert.match(txt, /AM Dewi/);
});

test("buildReminderDigest AM: sapa nama, tanpa kolom AM", () => {
  const txt = buildReminderDigest([row({})], "am", TODAY, "Dewi");
  assert.match(txt, /Halo Dewi/);
  assert.doesNotMatch(txt, /· AM /);
});
