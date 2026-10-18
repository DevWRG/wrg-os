import { test } from "node:test";
import assert from "node:assert/strict";

import { hariKerjaBulan, intervalDefault, jatuhTempo, pesanJadwal, selisihBulan, susunHari, type FaskesRencana } from "./jadwal-teknisi.js";

// F154 Jadwal Kunjungan Rutin Teknisi — penyusun (18 Okt 2026).

test("intervalDefault: ada PER_TEST → 2, selain itu 3", () => {
  assert.equal(intervalDefault(["PER_TEST", "BELI_REAGEN"]), 2);
  assert.equal(intervalDefault(["BELI_REAGEN"]), 3);
  assert.equal(intervalDefault([]), 3);
});

test("jatuhTempo: dari riwayat; tanpa riwayat disebar merata", () => {
  assert.equal(selisihBulan("2026-09-01", "2026-11-01"), 2);
  assert.equal(selisihBulan("2026-11-01", "2027-01-01"), 2);
  assert.equal(jatuhTempo(1, 2, "2026-09-01", "2026-11-01"), true);
  assert.equal(jatuhTempo(1, 2, "2026-10-01", "2026-11-01"), false);
  assert.equal(jatuhTempo(1, 3, "2026-08-01", "2026-11-01"), true);
  // tanpa riwayat: tiap faskes jatuh tepat sekali per siklus interval
  for (const id of [7, 101, 2049, 5555]) {
    const kena = ["2026-11-01", "2026-12-01", "2027-01-01"].filter((b) => jatuhTempo(id, 3, null, b));
    assert.equal(kena.length, 1, `akun ${id}`);
  }
  // dan sebaran 300 faskes interval 3 kira-kira sepertiga per bulan
  const n = Array.from({ length: 300 }, (_, i) => i + 1).filter((id) => jatuhTempo(id, 3, null, "2026-11-01")).length;
  assert.ok(n > 70 && n < 130, `sebaran ${n}`);
});

test("hariKerjaBulan: Sen–Jum tanpa libur", () => {
  const h = hariKerjaBulan("2026-11-01", new Set(["2026-11-02"]));
  assert.equal(h[0], "2026-11-03"); // 1 Nov Minggu, 2 Nov libur
  assert.equal(h.length, 20);
  assert.ok(h.every((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; }));
});

test("susunHari: wilayah per hari, maks per hari, urut wilayah terbanyak, melebihi bila hari habis", () => {
  const f = (id: number, wilayah: string, teknisi: string | null = "T1"): FaskesRencana => ({ account_id: id, nama: `F${id}`, wilayah, kota: null, teknisi_id: teknisi });
  const hari = ["2026-11-03", "2026-11-04", "2026-11-05"];
  const r = susunHari([f(1, "MALANG"), f(2, "JEMBER"), f(3, "JEMBER"), f(4, "JEMBER"), f(5, "JEMBER")], hari, 3);
  // JEMBER (4) dulu: 3 di hari-1, 1 di hari-2; MALANG pindah ke hari-3 (wilayah baru = hari baru)
  assert.deepEqual(r.map((x) => [x.account_id, x.tanggal, x.urutan]), [
    [2, "2026-11-03", 1], [3, "2026-11-03", 2], [4, "2026-11-03", 3], [5, "2026-11-04", 1], [1, "2026-11-05", 1]]);
  assert.ok(r.every((x) => !x.melebihi));
  const habis = susunHari([f(1, "A"), f(2, "B"), f(3, "C"), f(4, "D")], hari, 3);
  assert.deepEqual(habis.map((x) => x.melebihi), [false, false, false, true]);
  assert.equal(habis[3].tanggal, "2026-11-05");
  // teknisi berbeda dijadwalkan independen; tanpa teknisi tetap dijadwalkan (teknisi_id null)
  const dua = susunHari([f(1, "A", "T1"), f(2, "A", "T2"), f(3, "B", null)], hari, 3);
  assert.deepEqual(dua.map((x) => [x.teknisi_id, x.tanggal]), [["T1", "2026-11-03"], ["T2", "2026-11-03"], [null, "2026-11-03"]]);
});

test("pesanJadwal: dikelompokkan per tanggal, tanpa kurung sudut", () => {
  const p = pesanJadwal("Martin", "2026-11-01", [
    { tanggal: "2026-11-03", faskes: "RSUD A", wilayah: "JEMBER", alat: 2, status: "rencana" },
    { tanggal: "2026-11-03", faskes: "PKM B", wilayah: "JEMBER", alat: 1, status: "selesai" },
  ]);
  assert.match(p, /Jadwal kunjungan rutin Nov 2026 — Martin/);
  assert.match(p, /\*Sel 3 Nov\* · JEMBER/);
  assert.match(p, /✅ PKM B \(1 alat\)/);
  assert.doesNotMatch(p, /[<>]/);
  assert.match(pesanJadwal("Galih", "2026-11-01", []), /Tidak ada kunjungan rutin/);
});
