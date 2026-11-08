import { test } from "node:test";
import assert from "node:assert/strict";

import { DOKUMEN_WAJIB, hitungState, selisihHari, tanggalWib, type Snapshot } from "./doc-tracker-state.js";

const dokLengkap = { po_customer: true, sj_ttd_gudang: true, sj_ttd_sales: true, sj_ttd_kepala_sales: true };

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  soTanggal: "2026-11-01",
  reviewAt: null,
  approvedAt: null,
  sj: [],
  faktur: [],
  dokumen: {},
  stempelWajib: true,
  today: "2026-11-20",
  ...o,
});
const sj = (o: Partial<{ nomor: string; tanggal: string | null; kirimAt: string | null; terimaAt: string | null; bastAt: string | null }> = {}) => ({
  nomor: "SJ1", tanggal: null, kirimAt: null, terimaAt: null, bastAt: null, ...o,
});

test("SO baru tanpa apa-apa → Draft, tanpa anomali, umur dari tanggal SO", () => {
  const r = hitungState(snap());
  assert.equal(r.state, "draft");
  assert.deepEqual(r.anomali, []);
  assert.deepEqual(r.belumTercatat, []);
  assert.equal(r.umurHari, 19);
  assert.equal(r.billingRisiko, false);
});

test("urutan state: review → approved → sent → received → executed → billed → paid → closed", () => {
  const s = snap({ reviewAt: "2026-11-02T03:00:00Z" });
  assert.equal(hitungState(s).state, "review");
  s.approvedAt = "2026-11-03T03:00:00Z";
  assert.equal(hitungState(s).state, "approved");
  s.sj = [sj({ kirimAt: "2026-11-04T03:00:00Z" })];
  assert.equal(hitungState(s).state, "sent");
  s.sj = [sj({ kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z" })];
  assert.equal(hitungState(s).state, "received");
  s.sj = [sj({ kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z", bastAt: "2026-11-06T03:00:00Z" })];
  assert.equal(hitungState(s).state, "executed");
  s.faktur = [{ nomor: "F1", tanggal: "2026-11-07", lunas: false }];
  assert.equal(hitungState(s).state, "billed");
  s.faktur = [{ nomor: "F1", tanggal: "2026-11-07", lunas: true, lunasAt: "2026-11-15" }];
  assert.equal(hitungState(s).state, "paid"); // dokumen wajib belum lengkap
  assert.deepEqual(hitungState(s).dokumenKurang, [...DOKUMEN_WAJIB]);
  s.dokumen = dokLengkap;
  const r = hitungState(s);
  assert.equal(r.state, "closed");
  assert.deepEqual(r.anomali, []);
  assert.deepEqual(r.belumTercatat, []);
});

test("Closed butuh SEMUA dokumen wajib; teknisi hanya informasi; lunas tanpa dokumen = anomali", () => {
  const base = snap({
    reviewAt: "2026-11-02T03:00:00Z", approvedAt: "2026-11-03T03:00:00Z",
    sj: [sj({ kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z", bastAt: "2026-11-06T03:00:00Z" })],
    faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: true, lunasAt: "2026-11-15" }],
  });
  const kurang = hitungState({ ...base, dokumen: { ...dokLengkap, sj_ttd_kepala_sales: false } });
  assert.equal(kurang.state, "paid");
  assert.deepEqual(kurang.anomali, ["Lunas tetapi dokumen wajib belum lengkap: SJ ttd Kepala Sales"]);
  assert.equal(hitungState({ ...base, dokumen: dokLengkap }).state, "closed"); // tanpa ttd teknisi tetap closed
});

test("dokumen kurang sebelum lunas bukan anomali (belum waktunya Closed)", () => {
  const r = hitungState(snap({ faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: false }] }));
  assert.equal(r.state, "billed");
  assert.deepEqual(r.anomali, []);
  assert.equal(r.dokumenKurang.length, DOKUMEN_WAJIB.length);
});

test("faktur saja (tanpa stempel/SJ) → Billed; tahap kosong di bawahnya jadi belumTercatat, bukan penahan", () => {
  const r = hitungState(snap({ faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: false }] }));
  assert.equal(r.state, "billed");
  assert.deepEqual(r.belumTercatat, ["review", "approved", "sent", "received", "executed"]);
  assert.equal(r.umurHari, 13); // dari tanggal faktur
});

test("SJ (DO) terbit + semua faktur lunas → Paid; DO saja sudah bukti Sent", () => {
  const r = hitungState(snap({
    sj: [sj({ tanggal: "2026-11-03" })],
    faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: true, lunasAt: "2026-11-12" }],
  }));
  assert.equal(r.state, "paid");
  assert.equal(r.tahap.sent.selesai, true);
  assert.equal(r.tahap.sent.at, "2026-11-03");
  assert.deepEqual(r.belumTercatat, ["review", "approved", "received", "executed"]);
});

test("Sent dari DO: waktu = kirim_at bila ada, kalau tidak tanggal DO; terakhir di antara SJ", () => {
  const r = hitungState(snap({ sj: [sj({ nomor: "SJ1", tanggal: "2026-11-03", kirimAt: "2026-11-04T03:00:00Z" }), sj({ nomor: "SJ2", tanggal: "2026-11-06" })] }));
  assert.equal(r.state, "sent");
  assert.equal(r.tahap.sent.at, "2026-11-06");
  assert.equal(r.umurHari, 14);
});

test("Received/Executed tetap butuh terima/BAST SEMUA SJ", () => {
  const s = snap({
    sj: [
      sj({ nomor: "SJ1", kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z", bastAt: "2026-11-06T03:00:00Z" }),
      sj({ nomor: "SJ2", kirimAt: "2026-11-08T03:00:00Z" }),
    ],
  });
  const r = hitungState(s);
  assert.equal(r.state, "sent");
  assert.deepEqual(r.hitungan, { sj: 2, kirim: 2, terima: 1, bast: 1, faktur: 0, lunas: 0 });
  s.sj[1] = sj({ nomor: "SJ2", kirimAt: "2026-11-08T03:00:00Z", terimaAt: "2026-11-09T03:00:00Z", bastAt: "2026-11-10T03:00:00Z" });
  assert.equal(hitungState(s).state, "executed");
  assert.equal(hitungState(s).tahap.executed.at, "2026-11-10T03:00:00Z");
});

test("Billed tanpa BAST → tetap Billed, Received/Executed masuk belumTercatat", () => {
  const r = hitungState(snap({
    reviewAt: "2026-11-02T03:00:00Z", approvedAt: "2026-11-03T03:00:00Z",
    sj: [sj({ kirimAt: "2026-11-04T03:00:00Z" })],
    faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: false }],
  }));
  assert.equal(r.state, "billed");
  assert.deepEqual(r.belumTercatat, ["received", "executed"]);
  assert.deepEqual(r.anomali, []);
});

test("SO lama (stempelWajib=false): Review/Approved tersirat bila hilir ada → tidak masuk belumTercatat", () => {
  const r = hitungState(snap({ stempelWajib: false, sj: [sj({ kirimAt: "2026-11-04T03:00:00Z" })] }));
  assert.equal(r.state, "sent");
  assert.equal(r.tahap.review.tersirat, true);
  assert.equal(r.tahap.approved.tersirat, true);
  assert.deepEqual(r.belumTercatat, []);
  // SO lama tanpa hilir tetap Draft (tak ada yang tersirat)
  const kosong = hitungState(snap({ stempelWajib: false }));
  assert.equal(kosong.state, "draft");
  assert.equal(kosong.tahap.review.selesai, false);
});

test("Approved distempel tanpa Review: SO lama → Review tersirat; SO baru → state Approved, Review belumTercatat", () => {
  const lama = hitungState(snap({ stempelWajib: false, approvedAt: "2026-11-03T03:00:00Z" }));
  assert.equal(lama.state, "approved");
  assert.equal(lama.tahap.review.tersirat, true);
  assert.deepEqual(lama.belumTercatat, []);
  const baru = hitungState(snap({ approvedAt: "2026-11-03T03:00:00Z" }));
  assert.equal(baru.state, "approved");
  assert.deepEqual(baru.belumTercatat, ["review"]);
  assert.deepEqual(baru.anomali, []);
});

test("SO baru tanpa stempel tapi DO terbit → Sent, Review/Approved belumTercatat", () => {
  const r = hitungState(snap({ sj: [sj({ tanggal: "2026-11-04" })] }));
  assert.equal(r.state, "sent");
  assert.deepEqual(r.belumTercatat, ["review", "approved"]);
  assert.deepEqual(r.anomali, []);
});

test("Paid hanya bila SEMUA faktur lunas", () => {
  const s = snap({
    reviewAt: "2026-11-02T03:00:00Z", approvedAt: "2026-11-03T03:00:00Z",
    sj: [sj({ kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z", bastAt: "2026-11-06T03:00:00Z" })],
    faktur: [
      { nomor: "F1", tanggal: "2026-11-07", lunas: true, lunasAt: "2026-11-10" },
      { nomor: "F2", tanggal: "2026-11-08", lunas: false },
    ],
  });
  assert.equal(hitungState(s).state, "billed");
  assert.equal(hitungState(s).hitungan.lunas, 1);
});

test("billing-at-risk: BAST tanpa faktur lebih dari N hari (default 3), tepat di batas belum", () => {
  const dasar = {
    reviewAt: "2026-11-02T03:00:00Z", approvedAt: "2026-11-03T03:00:00Z",
    sj: [sj({ kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z", bastAt: "2026-11-10T03:00:00Z" })], // WIB 10 Nov
  };
  assert.equal(hitungState(snap({ ...dasar, today: "2026-11-13" })).billingRisiko, false); // tepat 3 hari
  assert.equal(hitungState(snap({ ...dasar, today: "2026-11-14" })).billingRisiko, true);
  // sudah ditagih → tidak berisiko
  assert.equal(hitungState(snap({ ...dasar, today: "2026-11-30", faktur: [{ nomor: "F1", tanggal: "2026-11-12", lunas: false }] })).billingRisiko, false);
  // belum BAST → tidak berisiko (cuma belum diserahterimakan)
  assert.equal(hitungState(snap({ ...dasar, sj: [sj({ kirimAt: "2026-11-04T03:00:00Z" })], today: "2026-12-30" })).billingRisiko, false);
});

test("billing-at-risk: ambang bisa diatur lewat env", () => {
  const prev = process.env.DOC_TRACKER_BILLING_HARI;
  process.env.DOC_TRACKER_BILLING_HARI = "10";
  try {
    const s = snap({
      reviewAt: "2026-11-02T03:00:00Z", approvedAt: "2026-11-03T03:00:00Z",
      sj: [sj({ kirimAt: "2026-11-04T03:00:00Z", terimaAt: "2026-11-05T03:00:00Z", bastAt: "2026-11-10T03:00:00Z" })],
      today: "2026-11-14",
    });
    assert.equal(hitungState(s).billingRisiko, false);
  } finally {
    if (prev === undefined) delete process.env.DOC_TRACKER_BILLING_HARI;
    else process.env.DOC_TRACKER_BILLING_HARI = prev;
  }
});

test("tanggalWib & selisihHari: UTC malam lewat ke hari WIB berikutnya", () => {
  assert.equal(tanggalWib("2026-11-10T20:00:00Z"), "2026-11-11");
  assert.equal(tanggalWib("2026-11-10"), "2026-11-10");
  assert.equal(tanggalWib(null), null);
  assert.equal(selisihHari("2026-02-27", "2026-03-02"), 3);
});
