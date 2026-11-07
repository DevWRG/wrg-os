import { test } from "node:test";
import assert from "node:assert/strict";
import { awalDiam, buildAlarmWa, buildPulihWa, buildRekapFakturisWa, durasiTeks, menitJamKerja, parseCreateDate } from "./fakturis-diam.js";

const jk = { mulai: 8, selesai: 17 };
const wib = (s: string) => new Date(`${s}+07:00`);

test("parseCreateDate: format Accurate WIB", () => {
  assert.equal(parseCreateDate("06/11/2026 15:13:00")?.toISOString(), wib("2026-11-06T15:13:00").toISOString());
  assert.equal(parseCreateDate("06/11/2026 15:13")?.toISOString(), wib("2026-11-06T15:13:00").toISOString());
  assert.equal(parseCreateDate("2026-11-06 15:13:00"), null);
  assert.equal(parseCreateDate(null), null);
});

test("awalDiam: faktur kemarin → mulai jam kerja hari ini", () => {
  const sekarang = wib("2026-11-09T12:00:00");
  assert.equal(awalDiam(wib("2026-11-06T17:48:25"), sekarang, jk).toISOString(), wib("2026-11-09T08:00:00").toISOString());
  assert.equal(awalDiam(wib("2026-11-09T09:30:00"), sekarang, jk).toISOString(), wib("2026-11-09T09:30:00").toISOString());
  assert.equal(awalDiam(null, sekarang, jk).toISOString(), wib("2026-11-09T08:00:00").toISOString());
});

test("menitJamKerja: dipotong ke jendela kerja", () => {
  assert.equal(menitJamKerja(wib("2026-11-09T09:30:00"), wib("2026-11-09T12:00:00"), jk), 150);
  assert.equal(menitJamKerja(wib("2026-11-09T14:00:00"), wib("2026-11-09T20:00:00"), jk), 180); // berhenti 17:00
  assert.equal(menitJamKerja(wib("2026-11-09T06:00:00"), wib("2026-11-09T07:30:00"), jk), 0);
});

test("menitJamKerja: lintas akhir pekan melewati Sabtu/Minggu", () => {
  // Jumat 15:00 → Senin 09:00 = 2 jam Jumat + 1 jam Senin
  assert.equal(menitJamKerja(wib("2026-11-06T15:00:00"), wib("2026-11-09T09:00:00"), jk), 180);
});

test("durasiTeks", () => {
  assert.equal(durasiTeks(185), "3 jam 5 mnt");
  assert.equal(durasiTeks(180), "3 jam");
  assert.equal(durasiTeks(45), "45 mnt");
});

test("buildAlarmWa / buildPulihWa: nama dari label, cadangan id akun", () => {
  const sekarang = wib("2026-11-09T12:00:00");
  const t = { nomor: "PJK/2577-2610-SBY", akun: "829215", label: null, at: wib("2026-11-09T08:50:00") };
  const a = buildAlarmWa(t, t.at, 190, sekarang);
  assert.match(a, /3 jam 10 mnt jam kerja/);
  assert.match(a, /PJK\/2577-2610-SBY · 08:50 WIB · akun Accurate 829215/);
  const kemarin = { ...t, at: wib("2026-11-06T17:48:00") };
  assert.match(buildAlarmWa(kemarin, wib("2026-11-09T08:00:00"), 240, sekarang), /Jum, 6 Nov 17:48 WIB/);
  const p = buildPulihWa({ ...t, label: "Fakturis Pusat" }, wib("2026-11-09T08:50:00"), 200);
  assert.match(p, /Fakturis Pusat/);
  assert.match(p, /sejak 08:50 WIB/);
});

test("buildRekapFakturisWa: porsi akun + peringatan konsentrasi", () => {
  const t = buildRekapFakturisWa("2026-W45", [
    { akun: "829215", label: null, faktur: 80 },
    { akun: "836342", label: "Fakturis B", faktur: 20 },
  ], { kejadian: 1, menit: 200 });
  assert.match(t, /100 faktur oleh 2 akun/);
  assert.match(t, /akun Accurate 829215: 80 \(80%\)/);
  assert.match(t, /Fakturis B: 20 \(20%\)/);
  assert.match(t, /1 kali, total 3 jam 20 mnt/);
  assert.match(t, /memegang 80% faktur/);
  assert.doesNotMatch(buildRekapFakturisWa("2026-W45", [{ akun: "a", label: null, faktur: 5 }, { akun: "b", label: null, faktur: 5 }], { kejadian: 0, menit: 0 }), /memegang/);
});
