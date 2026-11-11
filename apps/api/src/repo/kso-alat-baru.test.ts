// 307 — #KSO untuk ALAT BARU (belum ada di database): pilihan "#KSO ALAT BARU", penanda merah di balasan,
// gerbang GPM merah beralasan tanpa angka, ALASAN strategis tidak diminta. Data fiktif.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bacaIsianFormat, cariAlat, daftarKurang } from "./kso-format.js";
import {
  balasanSaranAlat, catatanAlatBaru, formatBalasanGerbang, gerbangUntukAm, kurangDraft, parseKsoPerintah, perkiraanZona, pilihAlatBaru,
  ubahKonfirmasiFaskes, type DraftTampil,
} from "./kso-intake.js";
import { alasanGerbang, nilaiGerbangAman, polaTerlarang } from "./kso-saring.js";

function draft(o: Partial<DraftTampil> = {}): DraftTampil {
  return {
    id: 71, nomor: null, status: "DRAFT", faskes: "RS UJI COBA", cabang: "MALANG", faskes_baru: false, faskes_kota: null,
    alat: "MEREKX CM 250", alat_kode: "BARU-3", alat_baru: true, jumlah: 1, volume_estimasi: 700, volume_sumber: "rekap LIS",
    harga_per_test: 11800, harga_standar: null, kategori: "Alat baru", tenor_bulan: 36, unit_status: "baru", klausul: [],
    kolom_dinyatakan: ["klausul", "kompetitor_alat", "fee_persen"], pendukung: [{ nama: "dr. Contoh", tipe: "kepala_instalasi" }],
    gerbang: [1, 2, 3, 4, 5, 6, 7].map((no) => ({
      no, nama: `G${no}`, status: no === 1 ? "merah" : no === 3 || no === 4 ? "belum" : "hijau",
      nilai: no === 1 ? "Alat belum ada di database — dicatat sebagai alat baru, zona Direktur" : null,
    })),
    kursi_hod: 2, zona_dasar: "direktur", gpm_deal: null, fee_persen: 0, kompetitor_alat: "TIDAK ADA", harga_pesaing: null,
    klausul_ada: false, klausul_detail: null, alasan_strategis: null,
    lampiran: { id: 1, lolos: true, cocok: {}, galat: null, tanggal: null, wa_message_id: "WA-1", dibuat_at: null },
    angka: { gpm: null, hd: false, catatan: "Alat belum ada di database", biaya_per_tes: null, harga_am: null, harga_hod: null,
             harga_forum: null, volume_min_forum: null }, ...o,
  };
}

test("pilihAlatBaru: BARU / ALAT BARU (huruf bebas, titik) — bukan nama alat lain", () => {
  for (const v of ["BARU", "baru", " Baru. ", "alat baru", "ALAT BARU"]) assert.equal(pilihAlatBaru(v), true, v);
  for (const v of ["1", "Z50", "BARU Z50", "alat baruan", "", null, undefined]) assert.equal(pilihAlatBaru(v), false, String(v));
  // "#KSO ALAT BARU" → label ALAT bernilai "BARU" (tanpa nama di kepala → jawaban isian tertunda)
  const p = parseKsoPerintah("#KSO ALAT BARU");
  assert.equal(p.nama, undefined);
  assert.equal(pilihAlatBaru(bacaIsianFormat(p.isi).alat), true);
  const d = parseKsoPerintah("#KSO D62 ALAT BARU");
  assert.equal(d.aksi, "lengkapi");
  assert.equal(pilihAlatBaru(bacaIsianFormat(d.isi).alat), true);
});

test("saran alat menawarkan #KSO ALAT BARU (usulan baru & koreksi draft)", () => {
  const h = { kind: "saran" as const, ambigu: false, saran: [{ kode: "Z50", nama: "Z50", kategori: "HEMATO", skor: 10 }] };
  assert.match(balasanSaranAlat("Moch", "WIENERLAB CM250", h, null, ["Z50"]), /Balas \*#KSO ALAT BARU\* — dicatat sebagai alat baru \(ditandai merah\)\.$/);
  assert.match(balasanSaranAlat("Moch", "X", h, "D9", ["Z50"]), /\*#KSO D9 ALAT BARU\*/);
  const r = ubahKonfirmasiFaskes({ faskes_id: "9001", faskes_teks: "RS A", faskes_saran: [], alat_kode: null }, "ya", "Moch");
  assert.ok("balasan" in r && /#KSO ALAT BARU/.test(r.balasan));
});

test("balasan gerbang: nama alat + (alat baru) di kepala, gerbang GPM MERAH beralasan, tanpa angka margin", () => {
  const d = draft();
  const t = formatBalasanGerbang(d, { catatan: [catatanAlatBaru(d)] });
  assert.equal(t.split("\n")[0], "*D71 · RS UJI COBA · MEREKX CM 250 (alat baru)*");
  assert.match(t, /❌ GPM deal — alat belum ada di database/);
  assert.match(t, /ℹ️ Alat "MEREKX CM 250" belum ada di database — dicatat sebagai alat baru dan gerbang GPM ditandai merah\. Usulan tetap bisa diajukan, langsung ke Zona Direktur\./);
  assert.deepEqual(polaTerlarang(t), [], t);
  assert.equal(formatBalasanGerbang(draft({ alat_baru: false, alat_kode: "Z3" })).split("\n")[0], "*D71 · RS UJI COBA · Z3*");
  assert.equal(gerbangUntukAm(d)[0].hijau, false);
});

test("alat baru: ALASAN strategis tidak diminta; alat katalog zona Direktur tetap diminta", () => {
  assert.deepEqual(kurangDraft(draft()).map((x) => x.kunci), []);
  const katalog = draft({ alat_baru: false, alat_kode: "Z3" });
  assert.deepEqual(kurangDraft(katalog).map((x) => x.kunci), ["alasan"]);
  assert.deepEqual(daftarKurang({ ...draft(), angka: { hd: false } }, "D71").map((x) => x.kunci), []);
  assert.equal(perkiraanZona(draft()), "direktur");
});

test("alasan gerbang 1: alat belum ada di database (merah) — merah karena margin tetap tanpa alasan", () => {
  assert.equal(alasanGerbang(1, "merah", "Alat belum ada di database — dicatat sebagai alat baru, zona Direktur"), "alat belum ada di database");
  assert.equal(alasanGerbang(1, "merah", "GPM 20,0% → zona Direktur"), null);
  assert.equal(nilaiGerbangAman(1, "merah", "Alat belum ada di database — dicatat sebagai alat baru"), "alat belum ada di database");
});

test("katalog tanpa merek (nama = kode, seperti dev/prod): salah ketik Zybio tetap disarankan, merek lain tidak", () => {
  // uji WA dev 11 Nov: "ZYBIO Z 5" sempat jadi alat baru karena nama katalog hanya "Z50" dan angka tunggal dibuang
  const kat = ["Z3", "Z50", "Z52", "EXC200", "EXC400", "EXZ8000"].map((k) => ({ kode: k, nama: k, kategori: k.startsWith("EXC") ? "CC" : "HEMATO" }));
  const kode = (t: string) => { const h = cariAlat(t, kat); return h.kind === "one" ? `=${h.kode}` : h.saran.map((x) => x.kode).sort().join(","); };
  assert.equal(kode("ZYBIO Z 5"), "Z50,Z52");
  assert.equal(kode("Zybio Z5"), "Z50,Z52");
  assert.equal(kode("EXC20"), "EXC200");
  assert.equal(kode("WIENERLAB CM250"), "");
  assert.equal(kode("Sysmex XN450"), "");
  assert.equal(kode("Mindray BC 5150"), "");
  assert.equal(kode("Z 52"), "=Z52");
});
