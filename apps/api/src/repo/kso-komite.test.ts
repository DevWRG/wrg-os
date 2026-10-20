import { test } from "node:test";
import assert from "node:assert/strict";
import { AKSI_TAB, TAB_KSO, putuskanIzin, refUntuk, terjemahGalatWeb, validasiAksi, type PenggunaKso } from "./kso-komite.js";
import type { Effective } from "./rbac.js";

const user = (o: Partial<PenggunaKso> = {}): PenggunaKso => ({ id: "u1", name: "U", role: "user", am_id: null, hod_key: null, ...o });
const eff = (o: Partial<Effective> = {}): Effective => ({ superuser: false, groups: [{ id: 1, key: "g", name: "G" }], permissions: {}, ...o });
const izin = (view: boolean, edit: boolean, active = true) => ({ active, view, create: false, edit, delete: false });

test("superuser & role admin boleh (sama dengan canOrLegacy web; kecuali admin di tab direksi)", () => {
  assert.equal(putuskanIzin(user(), eff({ superuser: true }), "direksi", "edit"), true);
  assert.equal(putuskanIzin(user({ role: "admin" }), eff(), "teknik", "edit"), true);
});

test("role admin TIDAK otomatis lolos Putusan Direksi; superuser tetap lolos", () => {
  const ditolak = eff({ permissions: { "kso-komite-direksi": izin(false, false, false) } });
  assert.equal(putuskanIzin(user({ role: "admin" }), ditolak, "direksi", "view"), false);
  assert.equal(putuskanIzin(user({ role: "admin" }), eff(), "direksi", "view"), false);
  assert.equal(putuskanIzin(user({ role: "admin" }), eff({ permissions: { "kso-komite-direksi": izin(true, true, true) } }), "direksi", "edit"), true);
  assert.equal(putuskanIzin(user({ role: "admin" }), ditolak, "hod", "view"), true);
  assert.equal(putuskanIzin(user({ role: "admin" }), eff({ superuser: true }), "direksi", "edit"), true);
});

test("matriks Akses Grup menentukan begitu fitur diatur — dua arah", () => {
  const e = eff({ permissions: { "kso-komite-direksi": izin(true, false) } });
  assert.equal(putuskanIzin(user(), e, "direksi", "view"), true);
  assert.equal(putuskanIzin(user(), e, "direksi", "edit"), false);
  // Direktur pun tertutup bila matriksnya menolak
  const tolak = eff({ permissions: { "kso-komite-direksi": izin(false, false) } });
  assert.equal(putuskanIzin(user({ role: "direktur" }), tolak, "direksi", "view"), false);
  assert.equal(putuskanIzin(user(), eff({ permissions: { "kso-komite-teknik": izin(true, true, false) } }), "teknik", "view"), false);
});

test("fitur belum diatur → gate lama sempit; tab baru lain TERTUTUP; tanpa grup = tidak", () => {
  assert.equal(putuskanIzin(user({ am_id: "AM-1" }), eff(), "saya", "view"), true);
  assert.equal(putuskanIzin(user({ hod_key: "yogi" }), eff(), "hod", "edit"), true);
  assert.equal(putuskanIzin(user({ role: "direktur" }), eff(), "direksi", "edit"), true);
  for (const t of ["agenda", "penawaran", "teknik", "kpi"] as const) assert.equal(putuskanIzin(user({ role: "direktur" }), eff(), t, "view"), false, t);
  assert.equal(putuskanIzin(user({ am_id: "AM-1" }), eff({ groups: [] }), "saya", "view"), false);
});

test("ref: tab AM butuh am_id, tab HOD butuh hod_key", () => {
  assert.deepEqual(refUntuk(user({ am_id: "AM-1" }), "saya"), { ok: true, ref: "AM-1" });
  assert.equal(refUntuk(user(), "saya").ok, false);
  assert.equal(refUntuk(user(), "hod").ok, false);
  assert.deepEqual(refUntuk(user(), "direksi"), { ok: true, ref: null });
});

test("setiap aksi dipetakan ke tab yang ada; kunci fitur unik", () => {
  for (const t of Object.values(AKSI_TAB)) assert.ok(TAB_KSO[t]);
  const kunci = Object.values(TAB_KSO).map((t) => t.fitur);
  assert.equal(new Set(kunci).size, kunci.length);
});

test("validasi: DITAHAN wajib tiga kolom; mandat Direksi wajib lengkap; nomor seri wajib", () => {
  assert.match(validasiAksi("usulkan", { usulan: "DITAHAN", data_kurang: "data LIS" })!, /tiga kolom/);
  assert.equal(validasiAksi("usulkan", { usulan: "DITAHAN", data_kurang: "data LIS", pemilik: "AM", tanggal_kembali: "2026-10-27" }), null);
  assert.match(validasiAksi("putus-direksi", { putusan: "SETUJU", lantai: 18000, target: 19000, tenor_maks: 36, capex_maks: 60e6 })!, /volume minimum/);
  assert.match(validasiAksi("putus-direksi", { putusan: "SETUJU", lantai: 19000, target: 18000, tenor_maks: 36, capex_maks: 60e6, volume_min: 700 })!, /pembuka/);
  assert.equal(validasiAksi("putus-direksi", { putusan: "SETUJU", lantai: 18000, target: 19000, tenor_maks: 36, capex_maks: 60e6, volume_min: 700 }), null);
  assert.match(validasiAksi("putus-direksi", { putusan: "TOLAK" })!, /alasan/);
  assert.match(validasiAksi("serah-terima", { nomor_seri: "  " })!, /Nomor seri/);
  assert.match(validasiAksi("putus-hod", { keputusan: "mungkin" })!, /Setuju/);
});

test("galat database diterjemahkan, kode tak pernah bocor", () => {
  for (const m of ["KELUAR_MANDAT: harga 18000 < lantai", "MANDAT_KEDALUWARSA", "HOD_TIDAK_BERWENANG: x", "galat lain apa pun"]) {
    const t = terjemahGalatWeb(m);
    assert.doesNotMatch(t.pesan, /[A-Z]{3,}_[A-Z_]+/);
  }
  assert.equal(terjemahGalatWeb("PERAN_TIDAK_BERWENANG: x").status, 403);
});
