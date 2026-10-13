// F65 Leads — logika murni (tanpa DB): normalisasi kota, pemilihan AM dari peta
// wilayah, parser #LEADS, balasan WA, pesan aging.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { normKota, pilihAmWilayah, parseLeads, balasanLeadTercatat, pesanAging, BANT_LOLOS } from "./lead.js";
import { detectKind } from "./inbound.js";

test("normKota menyamakan prefiks & tanda baca", () => {
  assert.equal(normKota("Kab. Ngawi"), "ngawi");
  assert.equal(normKota("KABUPATEN  NGAWI"), "ngawi");
  assert.equal(normKota("Kota Malang"), "malang");
  assert.equal(normKota("Kotamadya Surabaya"), "surabaya");
  assert.equal(normKota("  "), "");
  assert.equal(normKota(null), "");
  // "kota" sebagai NAMA (bukan prefiks) tak dibuang kalau berdiri sendiri
  assert.equal(normKota("Kotabaru"), "kotabaru");
});

const TERR = [
  { am_panggilan: "Angga", hod_panggilan: "ROCKY", kota: "KAB. BANGKALAN" },
  { am_panggilan: "ARI", hod_panggilan: "ROCKY", kota: "KAB. BADUNG" },
  { am_panggilan: "BUDI", hod_panggilan: "YOGI", kota: "KOTA MALANG" },
  { am_panggilan: "CITRA", hod_panggilan: "ROCKY", kota: "KAB. MALANG" },
];

test("pilihAmWilayah: kota unik → AM; tak ada → null", () => {
  assert.deepEqual(pilihAmWilayah("Bangkalan", TERR), { am_panggilan: "ANGGA", hod_panggilan: "ROCKY" });
  assert.deepEqual(pilihAmWilayah("kab badung", TERR), { am_panggilan: "ARI", hod_panggilan: "ROCKY" });
  assert.equal(pilihAmWilayah("Ngawi", TERR), null);
  assert.equal(pilihAmWilayah("", TERR), null);
});

test("pilihAmWilayah: kota dipegang >1 AM (Kota vs Kab. Malang) → ambigu, tak ditebak", () => {
  assert.equal(pilihAmWilayah("Malang", TERR), "ambigu");
});

test("parseLeads: faskes, kota, kebutuhan", () => {
  assert.deepEqual(parseLeads("#LEADS RSUD dr Soedono, Madiun: butuh analyzer hematologi, pagu 2027"), {
    ok: true, facility_name: "RSUD dr Soedono", city: "Madiun", kebutuhan: "butuh analyzer hematologi, pagu 2027",
  });
});

test("parseLeads: kota & kebutuhan opsional; kebutuhan di baris berikutnya", () => {
  assert.deepEqual(parseLeads("#leads Klinik Sehat Jaya, Kediri"), { ok: true, facility_name: "Klinik Sehat Jaya", city: "Kediri", kebutuhan: null });
  assert.deepEqual(parseLeads("#LEADS RS Islam Jemursari"), { ok: true, facility_name: "RS Islam Jemursari", city: null, kebutuhan: null });
  assert.deepEqual(parseLeads("info dari pameran\n#LEADS Puskesmas Jabon, Sidoarjo\nminta demo kimia klinik"), {
    ok: true, facility_name: "Puskesmas Jabon", city: "Sidoarjo", kebutuhan: "minta demo kimia klinik",
  });
});

test("parseLeads: kosong / tanpa nama / terlalu panjang", () => {
  assert.deepEqual(parseLeads("#LEADS"), { ok: false, alasan: "kosong" });
  assert.deepEqual(parseLeads("#LEADS , Madiun: x"), { ok: false, alasan: "kosong" });
  assert.deepEqual(parseLeads(null), { ok: false, alasan: "kosong" });
  assert.equal((parseLeads(`#LEADS RS A: ${"x".repeat(2001)}`) as { alasan: string }).alasan, "terlalu-panjang");
});

test("detectKind: #LEADS tetap dikenali, #LEADSX tidak", () => {
  assert.equal(detectKind("#LEADS RS A, Madiun: x"), "leads");
  assert.equal(detectKind("#LEADSX rapat"), "none");
});

test("balasan #LEADS: ber-AM, belum ber-AM, duplikat", () => {
  const ber = balasanLeadTercatat({
    lead: { kode: "LD-0001", facility_name: "RS A", city: "Madiun", am_nama: "Budi", am_id: "budi", pic_hod: "yogi", routing_via: "wilayah", account_id: null },
    pengirim: "Sari", duplikat: [],
  });
  assert.match(ber, /Lead \*LD-0001\* tercatat/);
  assert.match(ber, /diteruskan ke AM \*Budi\*/);
  assert.match(ber, /minimal 3 dari 4/);

  const sendiri = balasanLeadTercatat({
    lead: { kode: "LD-0002", facility_name: "RS B", city: null, am_nama: "Budi", am_id: "budi", pic_hod: null, routing_via: "pengirim", account_id: "5" },
    pengirim: "Budi", duplikat: [{ jenis: "deal", ref: "u", nama: "RS B Kota", status: "Quotation", am_id: "budi" }],
  });
  assert.match(sendiri, /\(Anda sendiri\)/);
  assert.match(sendiri, /sudah pelanggan/);
  assert.match(sendiri, /Mirip yang masih terbuka/);

  const tanpa = balasanLeadTercatat({
    lead: { kode: "LD-0003", facility_name: "RS C", city: "Malang", am_nama: null, am_id: null, pic_hod: null, routing_via: "tak-terpetakan", account_id: null },
    pengirim: "Sari", duplikat: [], catatanWilayah: "kota Malang dipegang lebih dari satu AM",
  });
  assert.match(tanpa, /BELUM ber-AM — admin/);
  assert.match(tanpa, /dipegang lebih dari satu AM/);
});

test("pesan aging: AM vs HoD, dipotong 15 baris", () => {
  const ls = Array.from({ length: 17 }, (_, i) => ({ kode: `LD-${i}`, facility_name: `RS ${i}`, city: null, hari: 4, am_nama: i % 2 ? "Budi" : null }));
  const am = pesanAging("am", "Budi", ls.slice(0, 2));
  assert.match(am, /Budi, 2 lead sudah 3\+ hari kerja/);
  assert.match(am, /Dihubungi/);
  const hod = pesanAging("hod", "Yogi", ls);
  assert.match(hod, /BELUM ADA AM/);
  assert.match(hod, /dan 2 lead lain/);
});

test("ambang BANT = 3 (keputusan user 13 Okt)", () => {
  assert.equal(BANT_LOLOS, 3);
});
