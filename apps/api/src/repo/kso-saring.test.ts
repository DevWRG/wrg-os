import { test } from "node:test";
import assert from "node:assert/strict";
import { alasanGerbang, nilaiGerbangAman, polaTerlarang, saringDaftarFilter, saringDaftarTab, saringDetail } from "./kso-saring.js";
import { bolehLihatAngka, bottomLineTerbatas, modeSaringTab, type KonteksAngka, type PenggunaKso } from "./kso-komite.js";
import { izinBottomLine } from "./kso-komite-bottomline.js";
import type { Effective } from "./rbac.js";

// Semua angka & nama fiktif (repo publik).

// ---------------------------------------------------------------- siapa disaring

const k = (o: Partial<KonteksAngka> = {}): KonteksAngka => ({ superuser: false, role: "user", am_id: null, jenisHod: [], tabLihat: [], ...o });

test("tab AM (saya) selalu disaring — juga untuk akun yang berhak di tab lain", () => {
  assert.equal(modeSaringTab("saya", k({ am_id: "AM-1", tabLihat: ["saya"] })), "semua");
  assert.equal(modeSaringTab("saya", k({ role: "admin", am_id: "AM-1" })), "semua");
});

test("HOD Sales disaring; HOD Business tetap; akun yang memegang KEDUA kursi = Business (tetap)", () => {
  assert.equal(modeSaringTab("hod", k({ jenisHod: ["area"], tabLihat: ["hod"] })), "semua");
  assert.equal(modeSaringTab("hod", k({ jenisHod: ["bisnis"], tabLihat: ["hod"] })), null);
  assert.equal(modeSaringTab("hod", k({ jenisHod: ["area", "bisnis"], tabLihat: ["hod"] })), null);
  // kursi tak dikenal (galat baca) = tertutup
  assert.equal(modeSaringTab("hod", k({ jenisHod: [], tabLihat: ["hod"] })), "semua");
  // HOD Sales yang juga Komite (tab Agenda) melihat angka yang sama di Agenda → tidak disaring
  assert.equal(modeSaringTab("hod", k({ jenisHod: ["area"], tabLihat: ["hod", "agenda"] })), null);
});

test("Admin Sales disaring tapi harga pembuka tetap; Teknik disaring; Komite/Sekretariat/Direksi tidak pernah", () => {
  assert.equal(modeSaringTab("penawaran", k({ tabLihat: ["penawaran"] })), "pembuka");
  assert.equal(modeSaringTab("penawaran", k({ tabLihat: ["penawaran", "sekretariat"] })), null);
  assert.equal(modeSaringTab("teknik", k({ tabLihat: ["teknik"] })), "semua");
  for (const t of ["agenda", "sekretariat", "direksi", "kpi"] as const) assert.equal(modeSaringTab(t, k()), null, t);
  assert.equal(modeSaringTab("penawaran", k({ superuser: true })), null);
  assert.equal(modeSaringTab("hod", k({ role: "direktur" })), null);
});

test("bolehLihatAngka: Business HOD, Komite, Sekretariat, Direksi, admin/superuser, pengisi angka Finance", () => {
  assert.equal(bolehLihatAngka(k({ jenisHod: ["bisnis"] })), true);
  assert.equal(bolehLihatAngka(k({ tabLihat: ["agenda"] })), true);
  assert.equal(bolehLihatAngka(k({ tabLihat: ["sekretariat"] })), true);
  assert.equal(bolehLihatAngka(k({ tabLihat: ["direksi"] })), true);
  assert.equal(bolehLihatAngka(k({ pengisiAngka: true })), true);
  assert.equal(bolehLihatAngka(k({ am_id: "AM-1", tabLihat: ["saya"] })), false);
  assert.equal(bolehLihatAngka(k({ jenisHod: ["area"], tabLihat: ["hod"] })), false);
  assert.equal(bolehLihatAngka(k({ tabLihat: ["penawaran"] })), false);
});

// ---------------------------------------------------------------- Bottom Line: ditegakkan di kode

const user = (o: Partial<PenggunaKso> = {}): PenggunaKso => ({ id: "u1", name: "U", role: "user", am_id: null, hod_key: null, ...o });
const izin = (view: boolean, edit: boolean) => ({ active: true, view, create: false, edit, delete: false });
const effLihat = (extra: Effective["permissions"] = {}): Effective => ({
  superuser: false, groups: [{ id: 1, key: "g", name: "G" }], permissions: { "kso-komite-bottomline": izin(true, false), ...extra },
});

test("Bottom Line: Admin Sales / HOD Sales / AM ditolak walau grupnya dicentang lihat; Business HOD & Komite tetap", () => {
  const nol = { lihat: false, putus: false, angka: false, realLihat: false, realCatat: false };
  assert.deepEqual(izinBottomLine(user(), effLihat(), k({ tabLihat: ["penawaran"] })), nol);
  assert.deepEqual(izinBottomLine(user({ hod_key: "hod-x" }), effLihat(), k({ jenisHod: ["area"], tabLihat: ["hod"] })), nol);
  assert.deepEqual(izinBottomLine(user({ am_id: "AM-1" }), effLihat(), k({ am_id: "AM-1", tabLihat: ["saya"] })), nol);
  assert.equal(izinBottomLine(user({ hod_key: "hod-y" }), effLihat(), k({ jenisHod: ["bisnis"], tabLihat: ["hod"] })).lihat, true);
  assert.equal(izinBottomLine(user(), effLihat(), k({ tabLihat: ["agenda", "penawaran"] })).lihat, true);
  // Finance (tanpa tab peran) tetap — bukan pihak yang dibatasi
  assert.equal(izinBottomLine(user(), effLihat(), k()).lihat, true);
  // Admin Sales yang juga pengisi angka (centang ubah angka) = Finance → boleh
  assert.equal(izinBottomLine(user(), effLihat({ "kso-komite-bottomline-angka": izin(false, true) }), k({ tabLihat: ["penawaran"] })).angka, true);
  assert.equal(bottomLineTerbatas(k({ tabLihat: ["penawaran"] })), true);
  assert.equal(bottomLineTerbatas(k()), false);
});

// ---------------------------------------------------------------- penyaring respons

const DETAIL = {
  rencana: { id: 7, status: "DIPUTUS_AM", capex: 250_000_000, payback_bulan: 14, biaya_instalasi: 3_000_000, gpm_deal: 0.58, zona: "am",
             zona_dasar: "am", harga_per_test: 12_000, fee_persen: 5, harga_bersih: 11_400, harga_deal: null, volume_estimasi: 900 },
  angka_gpm: { gpm: 0.58, hd: false, catatan: "GPM 58,0% → zona AM", biaya_per_tes: 5000, harga_am: 11_100, harga_hod: 10_000, harga_forum: 9_100, volume_min_forum: 400 },
  gerbang: [{ no: 1, nama: "GPM deal (bottom standar)", status: "hijau", nilai: "GPM 58,0% → zona AM" },
            { no: 6, nama: "Tenor ≤ 60 bulan", status: "hijau", nilai: "36 bulan sejak serah terima" }],
  mandat: { harga_lantai: 9_100, harga_target: 10_000, harga_pembuka: 12_000, capex_maks: 260_000_000, tenor_maks_bulan: 36, volume_minimum: 720,
            klausul_dilarang: [], klausul_wajib: [], berlaku_sampai: "2026-12-31", sumber: "otomatis" },
  usulan: [{ usulan: "DIREKOMENDASIKAN", mandat_usulan: { lantai: 9_000 }, alasan: null }],
  lampiran: [{ id: 1, lolos: true, isian: { analyzer: "Z3", test_per_bulan: 900, masa_bulan: 36, capex_total: 250_000_000, capex_per_test: 7_716,
               reagen_per_test: 3_100, qc_per_test: 400, base_cost_per_test: 11_216, cprr_per_test: 12_900, markup_persen: 15 },
               peringatan: ["capex_per_test tak sama dengan capex_total / total_target_test", "total_target_test tak sama dengan test_per_bulan × masa_bulan"] }],
  lampiran_terakhir: { id: 1, lolos: true, isian: { cprr_per_test: 12_900, test_per_bulan: 900 }, peringatan: [] },
  kurang: [],
};

test("saringDetail (AM/HOD Sales): angka GPM, capex, harga mandat, CPRR & pecahannya hilang; isian AM & gerbang tetap", () => {
  const d = saringDetail(structuredClone(DETAIL), "semua") as typeof DETAIL & { tanpa_angka: boolean };
  assert.equal(d.tanpa_angka, true);
  assert.equal(d.angka_gpm, null);
  for (const f of ["capex", "payback_bulan", "biaya_instalasi", "gpm_deal", "zona_dasar", "harga_bersih"]) assert.ok(!(f in d.rencana), f);
  assert.equal(d.rencana.harga_per_test, 12_000, "permintaan harga AM sendiri tetap");
  assert.equal(d.rencana.fee_persen, 5);
  assert.equal(d.rencana.zona, "am", "kata zona (hasil jalur) tetap");
  for (const f of ["harga_lantai", "harga_target", "harga_pembuka", "capex_maks"]) assert.ok(!(f in d.mandat), f);
  assert.equal(d.mandat.berlaku_sampai, "2026-12-31");
  assert.equal(d.gerbang[0].nilai, "Memenuhi");
  assert.equal(d.gerbang[1].nilai, "36 bulan sejak serah terima");
  assert.ok(!("mandat_usulan" in d.usulan[0]));
  const i = d.lampiran[0].isian as Record<string, unknown>;
  for (const f of ["capex_total", "capex_per_test", "reagen_per_test", "qc_per_test", "base_cost_per_test", "cprr_per_test", "markup_persen"]) assert.ok(!(f in i), f);
  assert.equal(i.test_per_bulan, 900);
  assert.deepEqual(d.lampiran[0].peringatan, ["total_target_test tak sama dengan test_per_bulan × masa_bulan"]);
  assert.ok(!("cprr_per_test" in (d.lampiran_terakhir.isian as Record<string, unknown>)));
  // tak ada angka biaya yang tersisa di JSON
  const json = JSON.stringify(d);
  for (const v of ["250000000", "7716", "11216", "12900", "9100", "10000", "0.58", "58,0"]) assert.ok(!json.includes(v), v);
});

test("saringDetail (Admin Sales): harga pembuka mandat tetap (harga di penawaran), target & batas bawah hilang", () => {
  const d = saringDetail(structuredClone(DETAIL), "pembuka") as typeof DETAIL;
  assert.equal(d.mandat.harga_pembuka, 12_000);
  assert.ok(!("harga_target" in d.mandat) && !("harga_lantai" in d.mandat) && !("capex_maks" in d.mandat));
  assert.ok(!("capex" in d.rencana) && !("gpm_deal" in d.rencana));
});

test("HOD Business / Komite (tanpa penyaring) = respons utuh; penyaring tidak mengubah objek asal", () => {
  const asal = structuredClone(DETAIL);
  saringDetail(asal, "semua");
  assert.deepEqual(asal, DETAIL);
});

test("saringDaftarTab & saringDaftarFilter: capex/GPM/harga bersih/harga mandat per baris + capex disetujui hilang", () => {
  const t = saringDaftarTab({ tab: "hod", ringkasan: { menunggu_hod: 2, capex_disetujui: 900_000_000 },
    baris: [{ id: 1, capex: 250_000_000, gpm_deal: 0.52, zona: "hod", pola_gerbang: "hhhhhhh" }] }, "semua");
  assert.deepEqual(t.ringkasan, { menunggu_hod: 2 });
  assert.deepEqual(t.baris[0], { id: 1, zona: "hod", pola_gerbang: "hhhhhhh" });
  const f = saringDaftarFilter({ tab: "penawaran", filter: "lolos-tanpa-forum", baris: [{ id: 2, gpm_deal: 0.6, zona_dasar: "am", harga_bersih: 11_000,
    harga_per_test: 12_000, mandat: { harga_pembuka: 12_000, harga_target: 10_000, harga_lantai: 9_000, berlaku_sampai: "2026-12-31" } }] }, "pembuka");
  assert.deepEqual(f.baris[0], { id: 2, harga_per_test: 12_000, mandat: { harga_pembuka: 12_000, berlaku_sampai: "2026-12-31" } });
  const am = saringDaftarFilter({ baris: [{ id: 3, mandat: { harga_pembuka: 12_000, berlaku_sampai: "2026-12-31" } }] }, "semua");
  assert.deepEqual(am.baris[0], { id: 3, mandat: { berlaku_sampai: "2026-12-31" } });
});

// ---------------------------------------------------------------- alasan gerbang tanpa angka

test("alasanGerbang & nilaiGerbangAman: tak pernah memuat angka", () => {
  const kasus: [number, string, string][] = [
    [1, "merah", "GPM 38,6% → zona Direktur"], [1, "belum", "HPP alat belum ada (Finance: HPP standar di Bottom Line Alat)"],
    [2, "merah", "Bukti ditolak Sekretaris: rekap 3 bulan tidak sah"], [3, "merah", "2 unit idle sejenis bisa direlokasi — pakai unit itu dulu"],
    [5, "merah", "120 hari · 3,5× tagihan bulanan"], [6, "merah", "72 bulan sejak serah terima"],
  ];
  for (const [no, st, nilai] of kasus) {
    const a = alasanGerbang(no, st, nilai) ?? "";
    assert.doesNotMatch(a, /\d/, `${no}: ${a}`);
    assert.deepEqual(polaTerlarang(a), []);
  }
  assert.equal(alasanGerbang(1, "merah", "GPM 38,6%"), null);
  assert.equal(alasanGerbang(1, "belum", "HPP alat belum ada"), "belum ada data");
  assert.equal(nilaiGerbangAman(1, "merah", "GPM 38,6% → zona Direktur"), "Belum memenuhi — wajib alasan strategis");
  assert.equal(nilaiGerbangAman(4, "merah", "Di luar coverage cabang"), "Di luar coverage cabang");
});

test("polaTerlarang menangkap GPM berangka, persen, rupiah, biaya, HPP, CPRR, harga mandat", () => {
  assert.deepEqual(polaTerlarang("GPM 48,1%"), ["GPM angka", "persen"]);
  assert.ok(polaTerlarang("biaya Rp 4.667/tes termasuk cicilan alat").includes("rupiah"));
  assert.ok(polaTerlarang("CPRR Simulator").includes("CPRR"));
  assert.ok(polaTerlarang("harga pembuka 18.500").includes("harga mandat"));
  assert.deepEqual(polaTerlarang("D12 · RS A · Z3 · 4/7 HIJAU"), []);
});
