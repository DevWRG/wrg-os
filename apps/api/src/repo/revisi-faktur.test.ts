import { test } from "node:test";
import assert from "node:assert/strict";
import { menitKerjaAntara, parseRevisi, tambahMenitKerja } from "./revisi-faktur.js";

const jk = { mulai: 8, selesai: 17 };
const wib = (s: string) => new Date(`${s}+07:00`);

test("parseRevisi: pemisah | : dan tanpa pemisah", () => {
  assert.deepEqual(parseRevisi("PJK/1459-2606-JBR | harga item ke-2 salah"), { ok: true, nomor: "PJK/1459-2606-JBR", alasan: "harga item ke-2 salah" });
  assert.deepEqual(parseRevisi("pjk/1459-2606-jbr|alamat salah"), { ok: true, nomor: "PJK/1459-2606-JBR", alasan: "alamat salah" });
  assert.deepEqual(parseRevisi("PJK/1459-2606-JBR: NPWP salah"), { ok: true, nomor: "PJK/1459-2606-JBR", alasan: "NPWP salah" });
  assert.deepEqual(parseRevisi("PJK/1459-2606-JBR - qty kurang"), { ok: true, nomor: "PJK/1459-2606-JBR", alasan: "qty kurang" });
  assert.deepEqual(parseRevisi("PJK/1459-2606-JBR harga salah"), { ok: true, nomor: "PJK/1459-2606-JBR", alasan: "harga salah" });
  assert.deepEqual(parseRevisi("PJK/1459-2606-JBR,"), { ok: false, alasan: "tanpa-alasan" });
  assert.deepEqual(parseRevisi("  "), { ok: false, alasan: "kosong" });
});

test("tambahMenitKerja: 8 jam kerja = hari kerja berikutnya jam sama", () => {
  assert.equal(tambahMenitKerja(wib("2026-11-09T10:00:00"), 480, jk, new Set()).toISOString(), wib("2026-11-10T09:00:00").toISOString());
  // Jumat 15:00 + 8 jam → Senin 14:00
  assert.equal(tambahMenitKerja(wib("2026-11-06T15:00:00"), 480, jk, new Set()).toISOString(), wib("2026-11-09T14:00:00").toISOString());
  // diminta malam → dihitung dari 08:00 besok
  assert.equal(tambahMenitKerja(wib("2026-11-09T20:00:00"), 120, jk, new Set()).toISOString(), wib("2026-11-10T10:00:00").toISOString());
  // Selasa libur → lompat ke Rabu
  assert.equal(tambahMenitKerja(wib("2026-11-09T16:00:00"), 120, jk, new Set(["2026-11-10"])).toISOString(), wib("2026-11-11T09:00:00").toISOString());
});

test("menitKerjaAntara: lewat akhir pekan dan libur", () => {
  assert.equal(menitKerjaAntara(wib("2026-11-06T15:00:00"), wib("2026-11-09T09:00:00"), jk, new Set()), 180);
  assert.equal(menitKerjaAntara(wib("2026-11-09T16:00:00"), wib("2026-11-11T09:00:00"), jk, new Set(["2026-11-10"])), 120);
});

test("detectKind: #REVISI terdeteksi, #REVISIAN tidak", async () => {
  const { detectKind } = await import("./inbound.js");
  assert.equal(detectKind("#REVISI PJK/1459-2606-JBR | harga salah"), "revisi");
  assert.equal(detectKind("tolong\n# revisi PJK/1 | x"), "revisi");
  assert.equal(detectKind("#revisian laporan"), "none");
});
