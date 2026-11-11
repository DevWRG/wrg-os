import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBon, nilaiBarisBon, kelompokOpname, balasanOpname, pilihTautanOtomatis, balasanLapor, kodeBon,
  type BonRow, type KandidatSparepart,
} from "./bon-sparepart.js";

const brg = (no: string, nama: string): KandidatSparepart => ({ item_id: 1, no, nama, satuan: "PCS" });

test("parseBon: bantuan / status", () => {
  assert.deepEqual(parseBon("#BON"), { aksi: "bantuan" });
  assert.deepEqual(parseBon("#bon status"), { aksi: "status" });
  assert.deepEqual(parseBon("halo"), { aksi: "bantuan" });
});

test("parseBon: baris pertama langsung barang + baris berikutnya; jumlah x2 / 2 pcs, default 1", () => {
  const r = parseBon("#BON Pompa peristaltik x2\nLampu halogen 12V\n- Selang silikon × 3\nFilter 5 micron\nO-ring 4 pcs");
  assert.equal(r.aksi, "baru");
  if (r.aksi !== "baru") return;
  assert.deepEqual(r.baris.map((b) => [b.query, b.qty]), [
    ["Pompa peristaltik", 2], ["Lampu halogen 12V", 1], ["Selang silikon", 3], ["Filter 5 micron", 1], ["O-ring", 4],
  ]);
});

test("parseBon: angka polos di ujung nama BUKAN jumlah; jumlah desimal koma", () => {
  const r = parseBon("#BON Lampu 12\nKabel x1,5");
  if (r.aksi !== "baru") throw new Error("harus baru");
  assert.deepEqual(r.baris.map((b) => [b.query, b.qty]), [["Lampu 12", 1], ["Kabel", 1.5]]);
});

test("parseBon: hashtag tidak harus di baris pertama; karakter tak terlihat dibuang", () => {
  const r = parseBon("info darurat\n​#BON Sensor suhu x1");
  assert.equal(r.aksi, "baru");
});

test("nilaiBarisBon: tak ditemukan / ambigu / qty buruk / ok", () => {
  assert.equal(nilaiBarisBon({ teks: "x", query: "x", qty: 1 }, []).ok, false);
  const amb = nilaiBarisBon({ teks: "x", query: "x", qty: 1 }, [brg("A.1", "Pompa A"), brg("A.2", "Pompa B")]);
  assert.equal(amb.ok, false);
  assert.match(amb.masalah ?? "", /tulis kodenya: A\.1 Pompa A/);
  assert.equal(nilaiBarisBon({ teks: "x", query: "x", qty: NaN }, [brg("A.1", "P")]).ok, false);
  assert.equal(nilaiBarisBon({ teks: "x", query: "x", qty: 0 }, [brg("A.1", "P")]).ok, false);
  const ok = nilaiBarisBon({ teks: "x", query: "x", qty: 2 }, [brg("A.1", "P")]);
  assert.equal(ok.ok, true);
  assert.equal(ok.qty, 2);
});

const bon = (o: Partial<BonRow> & { id: number }): BonRow => ({
  kode: kodeBon(o.id), teknisi_id: "t1", teknisi_nama: "Fajar", asal: "gudang", status: "dibuat", customer_nama: null, catatan: null,
  dibuat_oleh: "Yugi", dibuat_at: "2026-10-20T00:00:00.000Z", dilaporkan_at: null, sj_number: null, sj_sumber: null, hari: 3,
  item: [{ urut: 1, item_id: 1, item_no: "A.1", item_nama: "Pompa A", qty: 2, satuan: "PCS", dilaporkan_qty: 0 }], ...o,
});

test("kelompokOpname: empat daftar, batal dibuang", () => {
  const o = kelompokOpname([
    bon({ id: 1 }),
    bon({ id: 2, status: "dilaporkan" }),
    bon({ id: 3, status: "dilaporkan", asal: "teknisi" }),
    bon({ id: 4, status: "selesai", sj_number: "SJK.1" }),
    bon({ id: 5, status: "batal" }),
  ]);
  assert.deepEqual(o.belum_dilaporkan.map((b) => b.id), [1]);
  assert.deepEqual(o.dilaporkan_belum_sj.map((b) => b.id), [2]);
  assert.deepEqual(o.tanpa_bon_gudang.map((b) => b.id), [3]);
  assert.deepEqual(o.selesai.map((b) => b.id), [4]);
});

test("balasanOpname: memuat tiap kelompok, tanda sebagian, SJ; kosong = tak ada yang menggantung", () => {
  const o = kelompokOpname([
    bon({ id: 1, item: [{ urut: 1, item_id: 1, item_no: "A.1", item_nama: "Pompa A", qty: 2, satuan: null, dilaporkan_qty: 1 }] }),
    bon({ id: 2, status: "dilaporkan" }),
    bon({ id: 3, status: "dilaporkan", asal: "teknisi" }),
    bon({ id: 4, status: "selesai", sj_number: "SJK.1" }),
  ]);
  const t = balasanOpname(o, 1);
  assert.match(t, /1 bon baru tertaut ke SJ/);
  assert.match(t, /Belum dilaporkan teknisi \(1\)/);
  assert.match(t, /BN1 Fajar — Pompa A ×2 \(sebagian dilaporkan\), 3 hari lalu/);
  assert.match(t, /Dilaporkan, SJ belum ada \(1\)/);
  assert.match(t, /#BON tanpa bon gudang \(1\)/);
  assert.match(t, /BN4 Fajar → SJK\.1/);
  assert.match(balasanOpname(kelompokOpname([])), /Tidak ada bon yang menggantung/);
});

test("balasanOpname: daftar dipotong 8 baris + sisa", () => {
  const banyak = Array.from({ length: 11 }, (_, i) => bon({ id: i + 1 }));
  const t = balasanOpname(kelompokOpname(banyak));
  assert.match(t, /\+3 lagi/);
  assert.equal((t.match(/^• BN/gm) ?? []).length, 8);
});

test("pilihTautanOtomatis: hanya bon dengan tepat satu kandidat dan SJ tak diperebutkan", () => {
  const p = [
    { bon_id: 1, sj_id: 10, number: "S10" },                                  // aman
    { bon_id: 2, sj_id: 20, number: "S20" }, { bon_id: 2, sj_id: 21, number: "S21" }, // dua kandidat → manual
    { bon_id: 3, sj_id: 30, number: "S30" }, { bon_id: 4, sj_id: 30, number: "S30" }, // berebut S30 → manual
  ];
  assert.deepEqual(pilihTautanOtomatis(p), [{ bon_id: 1, sj_id: 10, number: "S10" }]);
  assert.deepEqual(pilihTautanOtomatis([]), []);
});

test("balasanLapor: lengkap, sebagian, tanpa bon gudang", () => {
  const t = balasanLapor("Fajar", { lengkap: ["BN1"], sebagian: ["BN2"], tanpaBon: [{ kode: "BN9", item: "Selang ×3" }] });
  assert.match(t, /#BON tercatat, Fajar/);
  assert.match(t, /BN1 \(lengkap\)/);
  assert.match(t, /Cocok sebagian dengan bon gudang: BN2/);
  assert.match(t, /BN9: Selang ×3 — belum ada bon gudangnya/);
});
