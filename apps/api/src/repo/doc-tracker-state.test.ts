import { test } from "node:test";
import assert from "node:assert/strict";

import { DOKUMEN_WAJIB, STATES, bastSj, dokumenDariArsip, gabungDokumen, hitungState, selisihHari, tanggalWib, type ArsipRujukan, type Snapshot } from "./doc-tracker-state.js";

const dokLengkap = { po_customer: true, sj_ttd_gudang: true, sj_ttd_sales: true, sj_ttd_kepala_sales: true };

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  soTanggal: "2026-11-01",
  sj: [],
  faktur: [],
  dokumen: {},
  today: "2026-11-20",
  ...o,
});
const sj = (o: Partial<{ nomor: string; tanggal: string | null; kirimAt: string | null; terimaAt: string | null; bastAt: string | null; bastInstalasiAt: string | null }> = {}) => ({
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

test("7 state, tanpa Review/Approved", () => {
  assert.deepEqual([...STATES], ["draft", "sent", "received", "executed", "billed", "paid", "closed"]);
});

test("urutan state: draft → sent → received → executed → billed → paid → closed", () => {
  const s = snap();
  assert.equal(hitungState(s).state, "draft");
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

test("faktur saja (tanpa SJ) → Billed; tahap kosong di bawahnya jadi belumTercatat, bukan penahan", () => {
  const r = hitungState(snap({ faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: false }] }));
  assert.equal(r.state, "billed");
  assert.deepEqual(r.belumTercatat, ["sent", "received", "executed"]);
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
  assert.deepEqual(r.belumTercatat, ["received", "executed"]);
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
    sj: [sj({ kirimAt: "2026-11-04T03:00:00Z" })],
    faktur: [{ nomor: "F1", tanggal: "2026-11-07", lunas: false }],
  }));
  assert.equal(r.state, "billed");
  assert.deepEqual(r.belumTercatat, ["received", "executed"]);
  assert.deepEqual(r.anomali, []);
});

test("SO tanpa stempel tapi DO terbit → Sent, tanpa belumTercatat (tak ada lagi tahap stempel)", () => {
  const r = hitungState(snap({ sj: [sj({ tanggal: "2026-11-04" })] }));
  assert.equal(r.state, "sent");
  assert.deepEqual(r.belumTercatat, []);
  assert.deepEqual(r.anomali, []);
});

test("Paid hanya bila SEMUA faktur lunas", () => {
  const s = snap({
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

test("Executed dari BAST Instalasi Aftersales (tanpa #BAST WA)", () => {
  const r = hitungState(snap({ sj: [sj({ tanggal: "2026-11-03", bastInstalasiAt: "2026-11-06T03:00:00Z" })] }));
  assert.equal(r.state, "executed");
  assert.equal(r.tahap.executed.at, "2026-11-06T03:00:00Z");
  assert.equal(r.hitungan.bast, 1);
  assert.deepEqual(r.belumTercatat, ["received"]);
});

test("Executed campuran: SJ-1 BAST WA, SJ-2 BAST Instalasi → semua SJ ber-BAST; SJ tanpa keduanya menahan", () => {
  const s = snap({
    sj: [
      sj({ nomor: "SJ1", bastAt: "2026-11-05T03:00:00Z" }),
      sj({ nomor: "SJ2", bastInstalasiAt: "2026-11-07T03:00:00Z" }),
      sj({ nomor: "SJ3" }),
    ],
  });
  assert.equal(hitungState(s).state, "sent");
  assert.equal(hitungState(s).hitungan.bast, 2);
  s.sj.pop();
  const r = hitungState(s);
  assert.equal(r.state, "executed");
  assert.equal(r.tahap.executed.at, "2026-11-07T03:00:00Z");
});

test("bastSj: sumber WA vs Instalasi, yang lebih dulu menang", () => {
  assert.deepEqual(bastSj(sj()), { at: null, sumber: null });
  assert.deepEqual(bastSj(sj({ bastAt: "2026-11-05T03:00:00Z" })), { at: "2026-11-05T03:00:00Z", sumber: "wa" });
  assert.deepEqual(bastSj(sj({ bastInstalasiAt: "2026-11-05T03:00:00Z" })), { at: "2026-11-05T03:00:00Z", sumber: "instalasi" });
  assert.deepEqual(bastSj(sj({ bastAt: "2026-11-06T03:00:00Z", bastInstalasiAt: "2026-11-05T03:00:00Z" })).sumber, "instalasi");
  assert.deepEqual(bastSj(sj({ bastAt: "2026-11-04T03:00:00Z", bastInstalasiAt: "2026-11-05T03:00:00Z" })).sumber, "wa");
});

test("billing-at-risk juga dari BAST Instalasi", () => {
  const s = snap({ sj: [sj({ bastInstalasiAt: "2026-11-10T03:00:00Z" })], today: "2026-11-14" });
  assert.equal(hitungState(s).billingRisiko, true);
});

const arsip = (o: Partial<ArsipRujukan>): ArsipRujukan => ({ nomor: "A1", buku_kode: "SJ", ref_sj: null, ref_po: null, ref_faktur: null, ...o });

test("arsip SJ ber-ttd → tiga ttd SJ tercentang sekaligus; cocok dipangkas & tak peka huruf", () => {
  const r = dokumenDariArsip(["UJI-SJ-01"], [], [arsip({ nomor: "SJ/2026/11/0001", ref_sj: " uji-sj-01 " })]);
  assert.deepEqual(r.sj_ttd_gudang, ["SJ/2026/11/0001"]);
  assert.deepEqual(r.sj_ttd_sales, ["SJ/2026/11/0001"]);
  assert.deepEqual(r.sj_ttd_kepala_sales, ["SJ/2026/11/0001"]);
  assert.equal(r.po_customer, undefined);
  assert.equal(r.sj_ttd_teknisi, undefined);
});

test("arsip SJ: SO dengan beberapa SJ butuh arsip untuk SEMUA SJ; buku selain SJ tak dihitung", () => {
  const dua = ["UJI-SJ-01", "UJI-SJ-02"];
  assert.deepEqual(dokumenDariArsip(dua, [], [arsip({ ref_sj: "UJI-SJ-01" })]), {});
  const lengkap = dokumenDariArsip(dua, [], [arsip({ nomor: "A1", ref_sj: "UJI-SJ-01" }), arsip({ nomor: "A2", ref_sj: "UJI-SJ-02" })]);
  assert.deepEqual(lengkap.sj_ttd_gudang, ["A1", "A2"]);
  assert.deepEqual(dokumenDariArsip(["UJI-SJ-01"], [], [arsip({ buku_kode: "BA", ref_sj: "UJI-SJ-01" })]), {});
  assert.deepEqual(dokumenDariArsip([], [], [arsip({ ref_sj: "UJI-SJ-01" })]), {}); // SO tanpa SJ tak pernah tercentang
});

test("arsip PO customer: ref_po terisi DAN merujuk SJ atau faktur SO", () => {
  assert.deepEqual(dokumenDariArsip(["UJI-SJ-01"], [], [arsip({ nomor: "A9", buku_kode: "LN", ref_sj: "uji-sj-01", ref_po: "PO-UJI-1" })]).po_customer, ["A9"]);
  assert.deepEqual(dokumenDariArsip([], ["UJI-F-01"], [arsip({ nomor: "A8", buku_kode: "LN", ref_faktur: "UJI-F-01", ref_po: "PO-UJI-1" })]).po_customer, ["A8"]);
  // ref_po kosong → bukan bukti PO
  assert.equal(dokumenDariArsip([], ["UJI-F-01"], [arsip({ ref_faktur: "UJI-F-01", ref_po: "  " })]).po_customer, undefined);
  // ref_po ada tetapi rujukan milik SO lain
  assert.equal(dokumenDariArsip(["UJI-SJ-01"], ["UJI-F-01"], [arsip({ ref_sj: "UJI-SJ-99", ref_po: "PO-UJI-1" })]).po_customer, undefined);
});

test("gabungDokumen: manual ATAU arsip; manual 'tidak' tak membatalkan arsip", () => {
  const g = gabungDokumen({ po_customer: false, sj_ttd_teknisi: true }, { po_customer: ["A1"], sj_ttd_gudang: ["A2"] });
  assert.deepEqual(g, { po_customer: true, sj_ttd_gudang: true, sj_ttd_teknisi: true });
  assert.deepEqual(gabungDokumen({ sj_ttd_sales: false }, {}), { sj_ttd_sales: false });
});

test("Closed dari arsip: lunas + arsip SJ & PO lengkap tanpa centang manual", () => {
  const nomorSj = ["UJI-SJ-01"];
  const dariArsip = dokumenDariArsip(nomorSj, ["UJI-F-01"], [arsip({ nomor: "A1", ref_sj: "UJI-SJ-01", ref_po: "PO-UJI-1" })]);
  const r = hitungState(snap({
    sj: [sj({ nomor: "UJI-SJ-01", tanggal: "2026-11-03" })],
    faktur: [{ nomor: "UJI-F-01", tanggal: "2026-11-07", lunas: true, lunasAt: "2026-11-15" }],
    dokumen: gabungDokumen({}, dariArsip),
  }));
  assert.equal(r.state, "closed");
  assert.deepEqual(r.anomali, []);
});
