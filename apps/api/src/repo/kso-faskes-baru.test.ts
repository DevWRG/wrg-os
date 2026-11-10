// 303 — #KSO untuk faskes BARU (calon customer): pengurai label, keputusan faskes, urutan pertanyaan tertunda,
// penanda di balasan, saran akun master. Data fiktif.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bacaIsianFormat, bacaKlausul, bacaPilihanFaskes, isianLengkapiDariFormat, putuskanFaskes, skorFaskes, SKOR_FASKES_MIRIP, type FaskesKatalog } from "./kso-format.js";
import { balasanSaranFaskes, catatanFaskesBaru, faskesTerbuka, formatBalasanGerbang, parseKsoPerintah, pertanyaanTertunda, type DraftTampil } from "./kso-intake.js";
import { saranAkunMaster } from "./kso-komite.js";
import { polaTerlarang } from "./kso-saring.js";

const PESAN = `#KSO HUSNI
1. Faskes : RS UJI COBA
2. ALAT : HEMATOLOGY ZYBIO Z3
3. TES/Test : 700 TEST/BULAN
4. MASA KSO : 36 BULAN
5. PERMINTAAN HARGA : 11.800/ TEST
6. FEE : 5%
7. KOMPETITOR : SYSMEX-XN450-11.500
8. KLAUSUL : YA
9. LAMPIRAN : TIDAK`;

const KATALOG: FaskesKatalog[] = [
  { id: "9001", nama: "SEJAHTERA, RS UMUM KOTA CONTOH", cabang: "MALANG" },
  { id: "9002", nama: "MITRA KELUARGA CONTOH, RS", cabang: "SBY 1" },
  { id: "9003", nama: "MITRA KELUARGA SENTOSA, RS", cabang: "SBY 1" },
  { id: "9004", nama: "HARAPAN BUNDA, KLINIK", cabang: "MALANG" },
  { id: "BARU-7", nama: "RS ANGGREK FIKTIF", cabang: "MALANG", baru: true },
];

test("pesan product owner terurai lengkap: KLAUSUL YA = ADA, LAMPIRAN TIDAK", () => {
  const p = parseKsoPerintah(PESAN);
  assert.equal(p.aksi, "baru");
  assert.equal(p.nama, "HUSNI");
  const x = bacaIsianFormat(p.isi);
  assert.equal(x.faskes, "RS UJI COBA");
  assert.equal(x.alat, "HEMATOLOGY ZYBIO Z3");
  assert.equal(x.volume, 700);
  assert.equal(x.tenor, 36);
  assert.equal(x.harga, 11800);
  assert.equal(x.fee, 5);
  assert.deepEqual(x.klausul, { ada: true, detail: null });
  assert.equal(x.lampiran, false);
  assert.deepEqual(x.tidakTerbaca, []);
  assert.equal(isianLengkapiDariFormat(x).klausul_ada, true);
});

test("KLAUSUL: YA/ADA = ada; TIDAK/NGGAK/- = tidak; LAMPIRAN: YA = ada", () => {
  for (const v of ["YA", "ya", "ADA", "Iya", "YES"]) assert.equal(bacaKlausul(v)?.ada, true, v);
  assert.deepEqual(bacaKlausul("YA - minimal volume 500"), { ada: true, detail: "minimal volume 500" });
  for (const v of ["TIDAK", "tidak ada", "NGGAK", "gak", "-", "--", "tanpa klausul"]) assert.deepEqual(bacaKlausul(v), { ada: false, detail: null }, v);
  assert.equal(bacaIsianFormat("LAMPIRAN : YA").lampiran, true);
  assert.equal(bacaIsianFormat("LAMPIRAN : ADA").lampiran, true);
  assert.equal(bacaIsianFormat("LAMPIRAN : TIDAK").lampiran, false);
  assert.equal(bacaIsianFormat("LAMPIRAN : -").lampiran, false);
});

test("label KOTA (opsional) terbaca, tidak masuk isian draft", () => {
  const x = bacaIsianFormat("FASKES : RS UJI COBA\nKOTA : Kota Fiktif\nKab/Kota: Lain");
  assert.equal(x.faskes, "RS UJI COBA");
  assert.equal(x.kota, "Lain");
  assert.ok(x.label.includes("kota"));
  assert.equal("kota" in isianLengkapiDariFormat(x), false);
  // "RS KOTA X" di baris FASKES tetap nama faskes
  assert.equal(bacaIsianFormat("FASKES: RSUD KOTA FIKTIF").faskes, "RSUD KOTA FIKTIF");
});

test("putuskanFaskes: tak ada yang mirip → faskes baru", () => {
  assert.deepEqual(putuskanFaskes("RS UJI COBA", KATALOG), { kind: "baru" });
});

test("putuskanFaskes: pasti dari cariAkun → dipakai; nama persis faskes baru lama → dipakai ulang", () => {
  assert.deepEqual(putuskanFaskes("rs sejahtera", KATALOG, { yakin: { id: "9001", nama: "x" } }),
    { kind: "one", id: "9001", nama: "SEJAHTERA, RS UMUM KOTA CONTOH", baru: false });
  assert.deepEqual(putuskanFaskes("rs anggrek  fiktif.", KATALOG), { kind: "one", id: "BARU-7", nama: "RS ANGGREK FIKTIF", baru: true });
});

test("putuskanFaskes: salah ketik / ambigu → pilihan (maks 3), tidak membuat faskes kembar", () => {
  const h = putuskanFaskes("RS MITRA KELURGA", KATALOG);
  assert.equal(h.kind, "saran");
  if (h.kind !== "saran") return;
  assert.deepEqual(h.saran.map((s) => s.id).sort(), ["9002", "9003"]);
  assert.ok(h.saran.every((s) => s.skor >= SKOR_FASKES_MIRIP));
  // nama yang disebut cariAkun ambigu selalu ikut ditawarkan
  const a = putuskanFaskes("RS XYZ", KATALOG, { ambigu: ["HARAPAN BUNDA, KLINIK"] });
  assert.equal(a.kind, "saran");
  if (a.kind === "saran") assert.equal(a.saran[0].id, "9004");
});

test("skorFaskes: kata generik & kota tak membuat mirip; satu huruf salah ketik tetap mirip", () => {
  assert.ok(skorFaskes("RS UJI COBA", "SEJAHTERA, RS UMUM KOTA CONTOH") < SKOR_FASKES_MIRIP);
  assert.ok(skorFaskes("RSUD Harapan Bunda", "HARAPAN BUNDA, KLINIK") >= 0.9);
  assert.ok(skorFaskes("RS MITRA KELURGA CONTOH", "MITRA KELUARGA CONTOH, RS") >= 0.9);
  assert.equal(skorFaskes("RS", "RS UMUM"), 0);
});

test("bacaPilihanFaskes: nomor, BARU, nama ditulis ulang", () => {
  assert.deepEqual(bacaPilihanFaskes("2"), { kind: "nomor", n: 2 });
  assert.deepEqual(bacaPilihanFaskes("BARU"), { kind: "baru" });
  assert.deepEqual(bacaPilihanFaskes("faskes baru"), { kind: "baru" });
  assert.deepEqual(bacaPilihanFaskes("RS Uji Coba Sehat"), { kind: "nama", nama: "RS Uji Coba Sehat" });
  // "#KSO FASKES 1" / "#KSO FASKES BARU" = jawaban (bukan nama di kepala)
  const p = parseKsoPerintah("#KSO FASKES 1");
  assert.equal(p.nama, undefined);
  assert.equal(bacaIsianFormat(p.isi).faskes, "1");
  assert.equal(bacaIsianFormat(parseKsoPerintah("#KSO FASKES BARU").isi).faskes, "BARU");
});

const T = { id: 5, faskes_id: null as string | null, alat_teks: "Z5X", saran: [{ kode: "Z3", nama: "Zybio Z3", kategori: "HEMATO", skor: 50 }],
  alat_kode: null as string | null, faskes_teks: "RS MITRA KELURGA",
  faskes_saran: [{ id: "9002", nama: "MITRA KELUARGA CONTOH, RS", cabang: "SBY 1", baru: false, skor: 0.9 },
                 { id: "BARU-7", nama: "RS ANGGREK FIKTIF", cabang: null, baru: true, skor: 0.5 }] };

test("tertunda: faskes ditanya dulu (alat ikut disebut), lalu alat, lalu selesai", () => {
  const q1 = pertanyaanTertunda("HUSNI", T, ["Z3", "Z50"])!;
  assert.equal(q1.hasil.error, "faskes-belum-pasti");
  assert.match(q1.balasan, /1\. MITRA KELUARGA CONTOH, RS — SBY 1\n2\. RS ANGGREK FIKTIF \(faskes baru\)/);
  assert.match(q1.balasan, /#KSO FASKES 1 \(atau 1\/2\) — atau #KSO FASKES BARU untuk tetap pakai nama "[^"]+" \(customer baru\)/);
  assert.match(q1.balasan, /Alat "Z5X" juga belum pasti/);
  // faskes dijawab nomor → alat ditanya
  const q2 = pertanyaanTertunda("HUSNI", { ...T, faskes_id: "9002", faskes_saran: [] }, ["Z3", "Z50"])!;
  assert.equal(q2.hasil.error, "alat-belum-pasti");
  assert.match(q2.balasan, /#KSO ALAT 1/);
  assert.doesNotMatch(q2.balasan, /faskes baru/);
  // FASKES BARU (faskes_id kosong, pilihan dikosongkan) → alat ditanya + pemberitahuan faskes baru
  const q3 = pertanyaanTertunda("HUSNI", { ...T, faskes_saran: [] }, ["Z3"])!;
  assert.ok(!faskesTerbuka({ ...T, faskes_saran: [] }));
  assert.match(q3.balasan, /Faskes "RS MITRA KELURGA" belum ada di master — akan dicatat sebagai faskes baru\./);
  // alat dulu dijawab, faskes masih terbuka → tetap faskes yang ditanya, tanpa baris alat
  const q4 = pertanyaanTertunda("HUSNI", { ...T, alat_kode: "Z3" }, ["Z3"])!;
  assert.equal(q4.hasil.error, "faskes-belum-pasti");
  assert.doesNotMatch(q4.balasan, /Alat/);
  // keduanya terjawab → draft dibuat (null)
  assert.equal(pertanyaanTertunda("HUSNI", { ...T, alat_kode: "Z3", faskes_saran: [] }, ["Z3"]), null);
  for (const q of [q1, q2, q3, q4]) assert.deepEqual(polaTerlarang(q.balasan), []);
});

function draft(o: Partial<DraftTampil> = {}): DraftTampil {
  return {
    id: 64, nomor: null, status: "DRAFT", faskes: "RS UJI COBA", cabang: "MALANG", faskes_baru: true, faskes_kota: null,
    alat: "Zybio Z3", alat_kode: "Z3", jumlah: 1, volume_estimasi: 700, volume_sumber: null, harga_per_test: 11800, harga_standar: 18500,
    kategori: "HEMATO", tenor_bulan: 36, unit_status: null, klausul: [], kolom_dinyatakan: ["klausul", "kompetitor_alat", "fee_persen"],
    pendukung: [], gerbang: [1, 2, 3, 4, 5, 6, 7].map((no) => ({ no, nama: `G${no}`, status: no === 2 || no === 7 ? "merah" : "hijau", nilai: null })),
    kursi_hod: 2, zona_dasar: "forum", gpm_deal: 0.5, fee_persen: 5, kompetitor_alat: "SYSMEX-XN450", harga_pesaing: 11500,
    klausul_ada: true, klausul_detail: null, lampiran: null, angka: { gpm: 0.512, hd: false, catatan: "GPM 51,2%", biaya_per_tes: 5000,
      harga_am: 12000, harga_hod: 11000, harga_forum: 10000, volume_min_forum: 600 }, ...o,
  };
}

test("balasan gerbang: penanda (faskes baru) di kepala, catatan faskes baru tanpa angka margin", () => {
  const catatan = catatanFaskesBaru(draft());
  const t = formatBalasanGerbang(draft(), { catatan });
  assert.equal(t.split("\n")[0], "D64 · RS UJI COBA (faskes baru) · Z3 · 5/7 HIJAU");
  assert.match(t, /dicatat sebagai FASKES BARU \(calon customer\), cabang MALANG/);
  assert.deepEqual(polaTerlarang(t), [], t);
  assert.equal(formatBalasanGerbang(draft({ faskes_baru: false })).split("\n")[0], "D64 · RS UJI COBA · Z3 · 5/7 HIJAU");
  // 304: kota TIDAK pernah ditanyakan ke AM (default area AM) — dengan atau tanpa kota/PDF
  for (const d of [draft(), draft({ faskes_kota: null }), draft({ faskes_kota: "MALANG", faskes_kota_area: true })]) {
    const c = catatanFaskesBaru(d);
    assert.equal(c.length, 1);
    assert.doesNotMatch(c.join("\n"), /KOTA|[Kk]ota faskes belum/);
  }
});

test("balasanSaranFaskes tanpa alat tertunda: tanpa baris alat", () => {
  const t = balasanSaranFaskes("HUSNI", "RS X", [{ id: "1", nama: "RS X SATU", cabang: null, baru: false, skor: 0.9 }], null);
  assert.match(t, /Balas: #KSO FASKES 1 — atau #KSO FASKES BARU/);
  assert.doesNotMatch(t, /Alat/);
});

test("saranAkunMaster: urut kemiripan, maks 5, yang tak mirip sama sekali dibuang", () => {
  const s = saranAkunMaster("RS MITRA KELUARGA CONTOH", KATALOG.filter((k) => !k.baru).map((k) => ({ id: k.id, nama: k.nama, cabang: k.cabang ?? null })));
  assert.equal(s[0].id, "9002");
  assert.ok(s.length <= 5);
  assert.ok(s.every((x) => x.skor > 0));
});

test("KLAUSUL: YA tanpa isi → gerbang 7 MERAH 'isi klausul belum ditulis' (bukan 'belum dijawab')", () => {
  const ya = formatBalasanGerbang(draft({ kolom_dinyatakan: ["fee_persen", "kompetitor_alat", "klausul_ada"], klausul_ada: true }));
  assert.match(ya, /7\. Klausul standar {7}❌ MERAH \(isi klausul belum ditulis\)/);
  const belum = formatBalasanGerbang(draft({ kolom_dinyatakan: [], klausul_ada: null }));
  assert.match(belum, /7\. Klausul standar {7}❌ MERAH \(belum dijawab\)/);
});

test("skorFaskes: angka pembeda beda = faskes lain (bukan salah ketik)", () => {
  assert.equal(skorFaskes("RS UJI COBA 2", "RS UJI COBA"), 0);
  assert.equal(skorFaskes("Puskesmas Contoh II", "PUSKESMAS CONTOH I"), 0);
  assert.equal(skorFaskes("RS CONTOH 02", "RS CONTOH 2") > 0, true);
  assert.equal(skorFaskes("RS CONTOH SEJAHTRA", "RS CONTOH SEJAHTERA") >= SKOR_FASKES_MIRIP, true);
  assert.deepEqual(putuskanFaskes("RS UJI COBA 2", [{ id: "BARU-1", nama: "RS UJI COBA", cabang: "KOTA FIKTIF", baru: true }]), { kind: "baru" });
});
