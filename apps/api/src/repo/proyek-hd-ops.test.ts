import { test } from "node:test";
import assert from "node:assert/strict";
import { gateChecklist, isianOps, nilaiKolom, OPS, tabOps, type Kolom } from "./proyek-hd-ops.js";
import { ProyekHdError } from "./proyek-hd.js";

const K = (tipe: Kolom["tipe"], extra: Partial<Kolom> = {}): Kolom => ({ nama: "x", label: "X", tipe, ...extra });

test("spesifikasi: slug & tabel unik, tabel hanya hd_*, nama kolom aman", () => {
  assert.equal(new Set(OPS.map((t) => t.slug)).size, OPS.length);
  assert.equal(new Set(OPS.map((t) => t.tabel)).size, OPS.length);
  for (const t of OPS) {
    assert.match(t.tabel, /^hd_[a-z_]+$/);
    for (const k of t.kolom) assert.match(k.nama, /^[a-z][a-z0-9_]*$/);
    for (const k of t.kolom) if (k.tipe === "enum") assert.ok(k.pilihan?.length, `${t.slug}.${k.nama} butuh pilihan`);
  }
  assert.throws(() => tabOps("hd_proyek"), /tidak dikenal/);
});

test("nilaiKolom: kosong = null (bool = false), angka & persen dibatasi", () => {
  assert.equal(nilaiKolom(K("text"), "  "), null);
  assert.equal(nilaiKolom(K("bool"), ""), false);
  assert.equal(nilaiKolom(K("bool"), "TRUE"), true);
  assert.equal(nilaiKolom(K("rupiah"), "1500"), 1500);
  assert.throws(() => nilaiKolom(K("int"), 1.5), /bulat/);
  assert.throws(() => nilaiKolom(K("number"), -1), /≥ 0/);
  assert.throws(() => nilaiKolom(K("percent"), 101), /maksimal 100/);
});

test("nilaiKolom: tanggal kalender nyata, bulan YYYY-MM, enum dari pilihan", () => {
  assert.equal(nilaiKolom(K("date"), "2026-02-28"), "2026-02-28");
  assert.throws(() => nilaiKolom(K("date"), "2026-02-30"), /kalender/);
  assert.throws(() => nilaiKolom(K("month"), "2026-13"), /YYYY-MM/);
  assert.equal(nilaiKolom(K("enum", { pilihan: ["A", "B"] }), "B"), "B");
  assert.throws(() => nilaiKolom(K("enum", { pilihan: ["A", "B"] }), "C"), ProyekHdError);
});

test("isianOps: baru = semua kolom + cek wajib; ubah = hanya kolom yang dikirim", () => {
  const isu = tabOps("isu");
  assert.throws(() => isianOps(isu, { dampak: "x" }, true), /Isu wajib diisi/);
  const baru = isianOps(isu, { isu: "Listrik kurang", status: "Proses" }, true);
  assert.equal(baru.isu, "Listrik kurang");
  assert.equal(baru.tindakan, null);
  assert.deepEqual(isianOps(isu, { status: "Selesai" }, false), { status: "Selesai" });
  assert.throws(() => isianOps(isu, { isu: "" }, false), /wajib/);
  // kolom di luar spesifikasi diabaikan
  assert.deepEqual(isianOps(isu, { dihapus_at: "2026-01-01", "id; DROP": 1 }, false), {});
});

test("gate G1–G3 dari konstruksi & RO", () => {
  assert.equal(gateChecklist(null, null).every((g) => !g.ok), true);
  const g = gateChecklist({ bq_internal: true, bq_versi_rs: true, spk_wrg: true }, { spk_ro: true });
  assert.deepEqual(g.map((x) => x.ok), [true, false, true, false, true]);
});
