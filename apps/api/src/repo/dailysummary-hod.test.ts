// 311 — Daily Summary per HOD + TUA: pengurai item TUA, pemetaan PIC/grup → cabang → HOD, pengelompokan, baris WA.
// Data fiktif (repo publik).
import { test } from "node:test";
import assert from "node:assert/strict";
import { barisTuaWa, hodUntukCabang, kelompokPerHod, petakanCabang, petakanTua, uraiItemTua, type HodPeta, type OrangPeta } from "./dailysummary-hod.js";
import { formatWaRingkas } from "./dailysummary-link.js";
import { extractTua } from "./notiftua.js";

const HOD: HodPeta[] = [
  { hod_key: "timur", nama: "Budi", cabang: ["KEDIRI", "JEMBER", "SBY 2"] },
  { hod_key: "barat", nama: "Sari", cabang: ["MADIUN", "JAKARTA"] },
];
const ORANG: OrangPeta[] = [
  { nama: "Andi Contoh Saputra", panggilan: "Andi", cabang: "Kediri" },
  { nama: "Rina Fiktif", panggilan: "Rina", cabang: "MADIUN" },
  { nama: "Dewi Uji", panggilan: null, cabang: "PUSAT" },
];
// Bentuk resume services/ai (resume.py): section ⏳ OUTSTANDING, baris ber-tag TUA.
const RESUME = `3. ACTION ITEMS OUTSTANDING
⏳ OUTSTANDING — masih menunggu (urutkan dari paling tua):
• Konfirmasi kirim reagen RS Contoh | dari Admin Gudang | ke Andi | sejak jam 08:10 (umur 6 jam 5 menit) TUA | status: belum dijawab
• Revisi faktur PKM Fiktif | dari Finance | ke grup PENJUALAN MADIUN | sejak jam 09:00 (umur 5 jam) TUA | status: menunggu dokumen
• Approval dana ops | dari Dewi Uji | ke Direktur | sejak jam 10:00 (umur 4 jam 30 menit) TUA | status: pending
• Cek stok buffer | dari Gudang | ke tim | sejak jam 13:00 (umur 1 jam) | status: proses
4. KEPUTUSAN`;

test("uraiItemTua: topik, dari, ke, umur (isi kurung), status — tanpa kata TUA", () => {
  const [a] = extractTua(RESUME);
  assert.deepEqual(uraiItemTua(a), {
    topik: "Konfirmasi kirim reagen RS Contoh", dari: "Admin Gudang", ke: "Andi", umur: "umur 6 jam 5 menit", status: "belum dijawab",
  });
  assert.deepEqual(uraiItemTua("• Topik saja TUA"), { topik: "Topik saja", dari: null, ke: null, umur: null, status: null });
});

test("petakanCabang: PIC → cabang karyawan; grup → nama cabang; tak ketemu → null; kata utuh saja", () => {
  const semua = ["KEDIRI", "JEMBER", "SBY 2", "MADIUN", "JAKARTA", "PUSAT"];
  assert.equal(petakanCabang(uraiItemTua("• x | ke Andi | (umur 5 jam) TUA"), ORANG, semua), "KEDIRI");
  assert.equal(petakanCabang(uraiItemTua("• x | ke grup PENJUALAN MADIUN"), ORANG, semua), "MADIUN");
  assert.equal(petakanCabang(uraiItemTua("• kirim ke SBY 2 | ke tim gudang"), ORANG, semua), "SBY 2");
  assert.equal(petakanCabang(uraiItemTua("• x | ke Direktur"), ORANG, semua), null);
  assert.equal(petakanCabang(uraiItemTua("• x | ke Andika"), ORANG, semua), null, "Andi ≠ Andika");
});

test("petakanTua + kelompokPerHod: TUA & area masuk HOD-nya, sisanya tanpa HOD", () => {
  const tua = petakanTua(extractTua(RESUME), ORANG, HOD);
  assert.equal(tua.length, 3, "item tanpa tag TUA tidak ikut");
  assert.deepEqual(tua.map((t) => [t.cabang, t.hod_key]), [["KEDIRI", "timur"], ["MADIUN", "barat"], [null, null]], "PIC = Direktur → belum terpetakan (pemohon tak dipakai)");
  const areas = [{ area: "Kediri", orang: [{ nama: "Andi", isi: "a" }] }, { area: "Madiun", orang: [{ nama: "Rina", isi: "b" }] },
                 { area: "Pusat", orang: [{ nama: "Dewi", isi: "c" }] }];
  const k = kelompokPerHod(areas, tua, HOD);
  assert.deepEqual(k.per_hod.map((h) => [h.nama, h.areas.map((a) => a.area), h.tua.length]), [["Budi", ["Kediri"], 1], ["Sari", ["Madiun"], 1]]);
  assert.deepEqual(k.tanpa_hod.areas.map((a) => a.area), ["Pusat"]);
  assert.equal(k.tanpa_hod.tua.length, 1);
  assert.equal(hodUntukCabang("sby 2", HOD), "timur");
});

test("baris WA TUA: jumlah per HOD + belum terpetakan; tanpa resume → null; ikut di pesan ringkas", () => {
  const tua = petakanTua(extractTua(RESUME), ORANG, HOD);
  const b = barisTuaWa("resume 14:00", tua, HOD);
  assert.equal(b, "⏳ TUA (resume 14:00): Budi 1 · Sari 1 · belum terpetakan 1");
  assert.equal(barisTuaWa("resume 14:00", [], HOD), "⏳ TUA (resume 14:00): Budi 0 · Sari 0");
  assert.equal(barisTuaWa(null, tua, HOD), null);
  const wa = formatWaRingkas({ hari: "Kamis", tanggal: "12 November 2026",
    stats: { anggota_aktif: 3, total_report: 10, matched: 10, unmatched: 0, wajib_total: 5 },
    pendek: { non_reporters: [], no_plan: [], on_leave: [] }, highlight: null, link: "x", tua: b });
  assert.match(wa, /👍 Semua yang wajib sudah plan & report\.\n⏳ TUA \(resume 14:00\): Budi 1 · Sari 1 · belum terpetakan 1/);
});
