import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cekBasi, cekDataTerkini, cekKpi, cekPipeline, cekTindakLanjut, formatWa, nilaiHod,
  overallHealth, statusHod, type HodBrief,
} from "./senin-brief.js";
import type { WeeklyHod, WeeklyMetric } from "./watchpoint-weekly.js";

const metric = (key: string, source: WeeklyMetric["source"], status: WeeklyMetric["status"]): WeeklyMetric => ({
  key, label: key, target: 100, actual: status === "NA" ? null : 80, prevActual: null,
  unit: "rp", direction: "higher", source, pct: null, status, trend: "stable",
});
const hod = (key: string, metrics: WeeklyMetric[]): WeeklyHod => ({ key, name: key, role: "x", status: "YELLOW", metrics });

const SEGAR = { ok: true, terburukHari: 1 };
const OTO = new Set(["revenue", "noorder", "ar90"]);

test("status HoD ikut aturan dokumen: semua hijau = SIAP, ≥3 merah = TIDAK SIAP", () => {
  assert.equal(statusHod([{ hasil: "OK" }, { hasil: "OK" }, { hasil: "NA" }]), "SIAP");
  assert.equal(statusHod([{ hasil: "OK" }, { hasil: "WARN" }]), "PERLU KLARIFIKASI");
  assert.equal(statusHod([{ hasil: "FAIL" }, { hasil: "FAIL" }, { hasil: "OK" }]), "PERLU KLARIFIKASI");
  assert.equal(statusHod([{ hasil: "FAIL" }, { hasil: "FAIL" }, { hasil: "FAIL" }, { hasil: "OK" }]), "TIDAK SIAP");
});

test("cek NA tidak dihitung — HoD tanpa cek berlaku tak bisa diaudit = TIDAK SIAP", () => {
  assert.equal(statusHod([{ hasil: "NA" }, { hasil: "OK" }]), "SIAP");
  assert.equal(statusHod([{ hasil: "NA" }, { hasil: "NA" }]), "TIDAK SIAP");
});

test("overall health: RED hanya bila >2 HoD tidak siap", () => {
  assert.equal(overallHealth(["SIAP", "SIAP"]), "ON-TRACK");
  assert.equal(overallHealth(["SIAP", "PERLU KLARIFIKASI"]), "RISK");
  assert.equal(overallHealth(["TIDAK SIAP", "TIDAK SIAP", "SIAP"]), "RISK");
  assert.equal(overallHealth(["TIDAK SIAP", "TIDAK SIAP", "TIDAK SIAP"]), "RED");
});

test("cek 1: mirror Accurate basi menggagalkan HoD bermetric DB, bukan HoD manual-saja", () => {
  const basi = { ok: false, terburukHari: 9 };
  assert.equal(cekDataTerkini(hod("rocky", [metric("revenue", "db", "GREEN")]), basi, OTO).hasil, "FAIL");
  assert.match(cekDataTerkini(hod("rocky", [metric("revenue", "db", "GREEN")]), basi, OTO).detail, /9 hari/);
  assert.equal(cekDataTerkini(hod("fafa", [metric("close", "manual", "GREEN")]), basi, OTO).hasil, "OK");
});

test("cek 1: metric manual kosong = FAIL, sebagian = WARN", () => {
  assert.equal(cekDataTerkini(hod("arman", [metric("a", "manual", "NA"), metric("b", "manual", "NA")]), SEGAR, OTO).hasil, "FAIL");
  assert.equal(cekDataTerkini(hod("arman", [metric("a", "manual", "GREEN"), metric("b", "manual", "NA")]), SEGAR, OTO).hasil, "WARN");
});

test("cek 1: metric OTOMATIS yang kosong tak disebut 'belum diisi HoD'", () => {
  // Di papan minggu lewat, metric otomatis tanpa snapshot bersumber "manual" + N/A.
  const c = cekDataTerkini(hod("rocky", [metric("revenue", "manual", "NA")]), SEGAR, OTO);
  assert.equal(c.hasil, "WARN");
  assert.match(c.detail, /metric otomatis kosong/);
  assert.doesNotMatch(c.detail, /diisi HoD/);
});

test("cek 2: hanya HoD pipeline; 0 deal = FAIL; ambang 90/60", () => {
  assert.equal(cekPipeline("fafa", undefined).hasil, "NA");
  assert.equal(cekPipeline("mufid", undefined).hasil, "FAIL");
  const agg = (lengkap: number) => ({ n: 100, lengkap, basi: 0, nilai: 5e9, weighted: 1e9 });
  assert.equal(cekPipeline("rocky", agg(95)).hasil, "OK");
  assert.equal(cekPipeline("rocky", agg(70)).hasil, "WARN");
  assert.equal(cekPipeline("rocky", agg(44)).hasil, "FAIL");
  assert.match(cekPipeline("rocky", agg(44)).detail, /Rp 5,0 M/);
});

test("cek 3: proxy plan/report; HoD tanpa AM = NA (bukan merah)", () => {
  assert.equal(cekTindakLanjut(undefined).hasil, "NA");
  const k = (plan: number, report: number) => ({
    jumlah_am: 6, am_submit: 6, plan_count: plan, report_count: report,
    completion: plan ? Math.round((report / plan) * 100) : null,
  });
  assert.equal(cekTindakLanjut(k(0, 0)).hasil, "FAIL");
  assert.equal(cekTindakLanjut(k(100, 85)).hasil, "OK");
  assert.equal(cekTindakLanjut(k(100, 60)).hasil, "WARN");
});

test("cek 4: menyebut metric yang N/A", () => {
  const c = cekKpi(hod("muhid", [metric("noorder", "db", "RED"), metric("uptime", "manual", "NA")]));
  assert.equal(c.hasil, "WARN");
  assert.match(c.detail, /N\/A: uptime/);
});

test("cek 5: deal macet untuk HoD pipeline; umur input manual untuk sisanya", () => {
  const h = hod("rocky", [metric("revenue", "db", "GREEN")]);
  assert.equal(cekBasi("rocky", h, { n: 100, lengkap: 0, basi: 84, nilai: 0, weighted: 0 }, null, OTO).hasil, "FAIL");
  assert.equal(cekBasi("rocky", h, { n: 100, lengkap: 0, basi: 20, nilai: 0, weighted: 0 }, null, OTO).hasil, "OK");
  const m = hod("fafa", [metric("close", "manual", "NA")]);
  assert.equal(cekBasi("fafa", m, undefined, null, OTO).hasil, "FAIL");
  assert.equal(cekBasi("fafa", m, undefined, 3, OTO).hasil, "OK");
  assert.equal(cekBasi("fafa", m, undefined, 20, OTO).hasil, "WARN");
  assert.equal(cekBasi("ika", hod("ika", [metric("ar90", "db", "GREEN")]), undefined, null, OTO).hasil, "OK");
  // HoD pipeline tanpa deal & tanpa metric manual: bukan "OK", tapi tak berlaku.
  assert.equal(cekBasi("rocky", h, undefined, null, OTO).hasil, "NA");
});

test("HoD manual-saja yang tak pernah mengisi = TIDAK SIAP", () => {
  const b = nilaiHod(hod("fafa", [metric("close", "manual", "NA"), metric("revstream", "manual", "NA")]),
    { nama: "Fafa", peran: "Accounting & Tax" }, { mirror: SEGAR, manualTerakhirHari: null, otomatis: OTO });
  assert.equal(b.status, "TIDAK SIAP");
  assert.deepEqual(b.checks.map((c) => c.hasil), ["FAIL", "NA", "NA", "FAIL", "FAIL"]);
});

test("pesan WA: tanpa kurung sudut, yang tidak siap disebut alasannya", () => {
  const hods: HodBrief[] = [
    { hod_key: "fafa", nama: "Fafa", peran: "Acc", status: "TIDAK SIAP", watch_status: "NA",
      checks: [{ no: 1, label: "Data terkini", hasil: "FAIL", detail: "" }, { no: 4, label: "KPI terlacak", hasil: "FAIL", detail: "" }] },
    { hod_key: "ika", nama: "Ika", peran: "Fin", status: "SIAP", watch_status: "GREEN", checks: [] },
  ];
  const wa = formatWa("W41", "6–12 Oktober 2026", "RISK", hods, "https://os.example/briefings?tab=senin");
  assert.doesNotMatch(wa, /[<>]/);
  assert.match(wa, /🔴 TIDAK SIAP \(1\): Fafa/);
  assert.match(wa, /• Fafa: Data terkini, KPI terlacak/);
  assert.match(wa, /briefings\?tab=senin/);
  // Urutan: yang paling butuh perhatian di atas.
  assert.ok(wa.indexOf("TIDAK SIAP") < wa.indexOf("✅ SIAP"));
});
