// Tes Sales Command Center (#1979): siapa boleh melihat region apa, dan
// penggabungan sinyal per AM. Murni — tanpa DB.
//
// Jalankan: pnpm --filter @wrg/api exec node --import tsx --test src/repo/sales-command.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { gabungPerAm, kualitasDataPipeline, SalesCommandError, tentukanRegion } from "./sales-command.js";

const peta = { "SURABAYA": "East", "MALANG": "East", "JAKARTA": "West", "PUSAT": "OFFICE" };
const sc = (o: Record<string, unknown>) => ({ superuser: false, role: null, cabangScope: null, amOnly: false, ...o });

test("HoD terkunci ke region timnya — ?region= lain diabaikan", () => {
  const r = tentukanRegion(sc({ cabangScope: ["SURABAYA", "malang"] }), "West", peta);
  assert.deepEqual(r, { region: "East", bolehPilih: false });
});

test("HoD yang cabangnya bukan East/West ditolak", () => {
  assert.throws(() => tentukanRegion(sc({ cabangScope: ["PUSAT"] }), null, peta), SalesCommandError);
});

test("Direktur/admin/superuser memilih region; default East; region asing 400", () => {
  assert.deepEqual(tentukanRegion(sc({ role: "direktur" }), "West", peta), { region: "West", bolehPilih: true });
  assert.equal(tentukanRegion(sc({ role: "admin" }), null, peta).region, "East");
  assert.equal(tentukanRegion(sc({ superuser: true }), "West", peta).region, "West");
  assert.throws(() => tentukanRegion(sc({ role: "direktur" }), "OFFICE", peta), (e: SalesCommandError) => e.status === 400);
});

test("AM dan pengguna ber-scope penuh tanpa peran pimpinan ditolak 403", () => {
  assert.throws(() => tentukanRegion(sc({ amOnly: true }), null, peta), (e: SalesCommandError) => e.status === 403);
  assert.throws(() => tentukanRegion(sc({ role: "user" }), "East", peta), (e: SalesCommandError) => e.status === 403);
});

test("gabungPerAm: sinyal per AM digabung, nama→am_id, urut skor", () => {
  const rows = gabungPerAm({
    radar: [
      { am_id: "A1", nama: "Andi", cabang: "SURABAYA", light: "red", achievement_pct: 40 },
      { am_id: "A2", nama: "Budi", cabang: "MALANG", light: "green", achievement_pct: 95 },
    ],
    pacing: [{ am_id: "A1", nama: "Andi", cabang: "SURABAYA", status: "behind", projected_pct: 60 }],
    compliance: [{ am_id: "A2", nama: "Budi", cabang: "MALANG", expected: 10, miss: 2 }],
    deals: [{ am_id: "A1", dormant: true, stale: true }, { am_id: "A1", dormant: false, stale: true }, { am_id: "LUAR", dormant: true, stale: false }],
    meragukanPerNama: new Map([["Andi", 3]]),
    ar90PerNama: new Map([["andi", 5_000_000], ["Orang Lain", 1]]),
    namaKeAm: new Map([["ANDI", "A1"], ["BUDI", "A2"]]),
  });
  assert.equal(rows[0].am_id, "A1");
  assert.deepEqual(
    { d: rows[0].deal_dormant, m: rows[0].deal_macet, q: rows[0].pipeline_meragukan, ar: rows[0].ar_90, skor: rows[0].skor },
    { d: 1, m: 1, q: 3, ar: 5_000_000, skor: 4 },
  );
  assert.equal(rows[1].plan_report_miss, 2);
  assert.equal(rows.length, 2, "AM di luar region (LUAR) tidak ditambahkan dari deal");
});

test("gabungPerAm: lampu YTD merah TIDAK menambah skor — kinerja diwakili pacing (diprorata)", () => {
  const [b] = gabungPerAm({
    radar: [{ am_id: "A1", nama: "Andi", cabang: "SURABAYA", light: "red", achievement_pct: 10 }],
    pacing: [{ am_id: "A1", nama: "Andi", cabang: "SURABAYA", status: "on-track", projected_pct: 102 }],
    compliance: [], deals: [], meragukanPerNama: new Map(), ar90PerNama: new Map(), namaKeAm: new Map(),
  });
  assert.equal(b.lampu, "red");
  assert.equal(b.skor, 0);
});

test("kualitasDataPipeline: bulan lewat / kosong / tanpa nilai, per AM, deal bermasalah saja", () => {
  const d = (id: string, am: string, m: number | null, y: number | null, nilai: number | null) =>
    ({ deal_id: id, am_id: am, am: am, faskes: id, stage: "Quotation", purchase_month: m, purchase_year: y, nilai });
  const k = kualitasDataPipeline([
    d("a", "A1", 10, 2026, 100),   // lewat (bulan ini 2026-11)
    d("b", "A1", 11, 2026, 100),   // bulan ini — beres
    d("c", "A1", null, null, 0),   // kosong + tanpa nilai
    d("e", "A2", 1, 2027, 50),     // depan — beres
    d("f", "A2", 12, 2025, null),  // lewat (tahun lalu) + tanpa nilai
  ], "2026-11");
  assert.deepEqual([k.terbuka, k.bulan_lewat, k.tanpa_bulan, k.tanpa_nilai], [5, 2, 1, 2]);
  assert.deepEqual(k.deals.map((x) => x.deal_id).sort(), ["a", "c", "f"]);
  assert.deepEqual(k.per_am.map((a) => [a.am_id, a.bulan_lewat, a.tanpa_bulan, a.tanpa_nilai]), [["A1", 1, 1, 1], ["A2", 1, 0, 1]]);
});

test("buildRekapKualitas: ringkasan region, AM terurut, batas baris, tanpa <...>", async () => {
  const { buildRekapKualitas, kualitasDataPipeline } = await import("./sales-command.js");
  const d = (am: string, m: number | null, y: number | null, nilai: number | null) =>
    ({ deal_id: `${am}${m}${nilai}`, am_id: am, am, faskes: "RS", stage: "Prospecting", purchase_month: m, purchase_year: y, nilai });
  const k = kualitasDataPipeline([
    d("Ani", 9, 2026, 0), d("Ani", 10, 2026, 5), d("Budi", null, null, 5), d("Cici", 12, 2026, 5), d("Dedi", 8, 2026, 5),
  ], "2026-11");
  const t = buildRekapKualitas("East", k, 2);
  assert.match(t, /^📋 \*Kualitas data pipeline — Sales East\*/);
  assert.match(t, /5 deal terbuka: 3 bulan beli sudah lewat \(60%\), 1 bulan beli kosong, 1 tanpa nilai\./);
  const baris = t.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.equal(baris.length, 2);
  assert.equal(baris[0], "1. Ani — 2 bulan beli lewat · 1 tanpa nilai (dari 2 deal)");
  assert.match(t, /… dan 1 AM lainnya\./); // Budi & Dedi sisa satu (Cici bersih tak dihitung)
  assert.doesNotMatch(t, /<[^>]+>/);
});
