// Penaut nama faskes tulisan AM → accurate_customer. Kasus diambil dari data prod
// 13 Okt 2026 (activity_log tanpa account_id), termasuk yang dulu salah tempel.
import test from "node:test";
import assert from "node:assert/strict";
import { uraiNamaAccurate, uraiTulisanAm, tautkanFaskes } from "./akun-faskes.js";

const KATALOG = [
  "DR. SOEDOMO, RSUD KAB. TRENGGALEK",
  "DR. SOEDONO, RSUD KOTA MADIUN",
  "DR. SOEKARDJO, RSUD KAB. TASIKMALAYA",
  "POGALAN, PKM KAB. TRENGGALEK",
  "GONDANGLEGI, PKM KAB. MALANG",
  "GONDANG LEGI, RSI KAB. MALANG",
  "WIDI HARYAWAN, BPK / RSI GONDANGLEGI KAB. MALANG",
  "KALIWATES, PKM KAB. JEMBER",
  "KALIWATES, RSU KAB. JEMBER",
  "KAUMAN, PKM KAB. PONOROGO",
  "KAUMAN, PKM KAB. NGAWI",
  "DAHA HUSADA, RS KOTA KEDIRI",
  "GRAHA HUSADA, RS KAB. TUBAN",
  "DINAS KESEHATAN KOTA KEDIRI",
  "DINAS KESEHATAN KAB. KEDIRI",
  "PALANG MERAH INDONESIA KAB. KEDIRI",
  "KRAS, PKM KAB. KEDIRI",
  "LABKESDA KAB. LOMBOK BARAT",
  "LABKESDA KAB. LOMBOK TENGAH",
  "MUHAMMADIYAH KALIKAPAS, RS KAB. LAMONGAN",
  "MITRA SEHAT MEDIKA, RS KAB. PASURUAN",
  "ELIZABETH, BU / RS PARU KOTA SURABAYA",
  "NATA MEDIKA, KLINIK KAB. SAMPANG",
  "KI AGENG BRONDONG, RSUD KAB. LAMONGAN",
  "DESY, BU / RS PTP KAB. JEMBER",
  "RAUF, BPK / RS PTP KAB. JEMBER",
].map((n, i) => uraiNamaAccurate(i + 1, n));

const nama = (teks: string) => {
  const h = tautkanFaskes(teks, KATALOG);
  return h.kind === "one" ? h.nama : h.kind;
};

test("urai nama Accurate: inti, jenis, kota; instansi tanpa koma", () => {
  const f = uraiNamaAccurate(1, "DR. SOEDOMO, RSUD KAB. TRENGGALEK");
  assert.deepEqual([...f.jenis], ["RS"]);
  assert.deepEqual(f.nama_kata, ["sudomo"]); // ejaan lama dinormalkan: oe → u
  assert.deepEqual(f.kota_kata, ["trenggalek"]);
  assert.equal(f.kualifikasi, "KAB");
  const d = uraiNamaAccurate(2, "DINAS KESEHATAN KOTA KEDIRI");
  assert.deepEqual([...d.jenis], ["DINKES"]);
  assert.deepEqual(d.nama_kata, []);
  assert.equal(d.kualifikasi, "KOTA");
  const p = uraiNamaAccurate(3, "WIDI HARYAWAN, BPK / RSI GONDANGLEGI KAB. MALANG");
  assert.ok(p.jenis.has("PRIBADI") && p.jenis.has("RS"));
  const dok = uraiNamaAccurate(4, "WAHYU, DR. / DINKES KAB. JOMBANG");
  assert.ok(dok.jenis.has("PRIBADI") && dok.jenis.has("DINKES"));
});

test("tulisan AM: awalan Cust dibuang, jenis pertama, gelar & kualifikasi", () => {
  assert.deepEqual(uraiTulisanAm("Cust : Puskesmas Pogalan"), { jenis: "PKM", kualifikasi: null, kata: ["pogalan"] });
  assert.deepEqual(uraiTulisanAm("RSUD dr Soedono"), { jenis: "RS", kualifikasi: null, kata: ["sudono"] });
  assert.deepEqual(uraiTulisanAm("Dinkes Kota Kediri"), { jenis: "DINKES", kualifikasi: "KOTA", kata: ["kediri"] });
  assert.equal(uraiTulisanAm("‎#Report Irul 6/7/2026"), null);
  assert.equal(uraiTulisanAm(""), null);
});

test("tertaut: nama terbalik Accurate, kota ikut ditulis, ejaan rapat", () => {
  assert.equal(nama("Cust : RSUD Soedomo Trenggalek"), "DR. SOEDOMO, RSUD KAB. TRENGGALEK");
  assert.equal(nama("Cust : Puskesmas Pogalan"), "POGALAN, PKM KAB. TRENGGALEK");
  assert.equal(nama("Cust : RS Daha Husada"), "DAHA HUSADA, RS KOTA KEDIRI");
  assert.equal(nama("Cust: Rsi Gondanglegi"), "GONDANG LEGI, RSI KAB. MALANG");
  assert.equal(nama("rsud brodong"), "KI AGENG BRONDONG, RSUD KAB. LAMONGAN");
});

test("jenis faskes adalah pembeda", () => {
  assert.equal(nama("Puskesmas Kaliwates"), "KALIWATES, PKM KAB. JEMBER");
  assert.equal(nama("Puskesmas Gondanglegi"), "GONDANGLEGI, PKM KAB. MALANG");
  assert.equal(nama("Cust : PMI Kab Kediri"), "PALANG MERAH INDONESIA KAB. KEDIRI");
});

test("kota vs kabupaten ditaati bila ditulis", () => {
  assert.equal(nama("Dinkes Kota Kediri"), "DINAS KESEHATAN KOTA KEDIRI");
  assert.equal(nama("Dinkes Kab Kediri"), "DINAS KESEHATAN KAB. KEDIRI");
  assert.equal(nama("Cust : Labkesda Lombok Barat"), "LABKESDA KAB. LOMBOK BARAT");
});

test("huruf tertukar BUKAN salah ketik — faskes berbeda", () => {
  assert.equal(nama("RSUD Ir. Soekarno"), "none");
  assert.equal(nama("Rsud Soedono"), "DR. SOEDONO, RSUD KOTA MADIUN");
  assert.equal(nama("Laboratorium Klinik Samudra Medika"), "none");
});

test("nama sebagian (tier 2): hanya bila khas, separuh nama, bukan akun pribadi", () => {
  const h = tautkanFaskes("rs kalikapas", KATALOG);
  assert.equal(h.kind === "one" && h.tier, 2);
  assert.equal(nama("RS Mitra Medika"), "none");
  assert.equal(nama("RS Elizabeth"), "none");
});

test("ambigu & akun pribadi tidak ditautkan", () => {
  assert.equal(nama("Puskesmas Kauman"), "ambiguous");
  // hanya ada akun pribadi orang di RS PTP — bukan akun faskesnya
  assert.equal(nama("RS PTP Jember"), "none");
  assert.equal(nama("Puskesmas Trenggalek"), "none");
});
