import { test } from "node:test";
import assert from "node:assert/strict";
import { AKSI_TAB, TAB_KSO, putuskanIzin, refUntuk, terjemahGalatWeb, validasiAksi, type PenggunaKso } from "./kso-komite.js";
import { bolehUbahSusunan } from "./kso-komite-susunan.js";
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
  for (const t of ["agenda", "sekretariat", "penawaran", "teknik", "kpi"] as const) assert.equal(putuskanIzin(user({ role: "direktur" }), eff(), t, "view"), false, t);
  assert.equal(putuskanIzin(user({ am_id: "AM-1" }), eff({ groups: [] }), "saya", "view"), false);
});

test("ref: tab AM butuh am_id, tab HOD butuh hod_key", () => {
  assert.deepEqual(refUntuk(user({ am_id: "AM-1" }), "saya"), { ok: true, ref: "AM-1" });
  assert.equal(refUntuk(user(), "saya").ok, false);
  assert.equal(refUntuk(user(), "hod").ok, false);
  assert.deepEqual(refUntuk(user(), "direksi"), { ok: true, ref: null });
});

test("setiap aksi dipetakan ke tab yang ada; kunci fitur unik", () => {
  for (const daftar of Object.values(AKSI_TAB)) { assert.ok(daftar.length > 0); for (const t of daftar) assert.ok(TAB_KSO[t]); }
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

test("Sekretariat: PKS hanya dari tab Sekretariat; penawaran & kalah dari Sekretariat lalu Admin Sales", () => {
  assert.deepEqual(AKSI_TAB.pks, ["sekretariat"]);
  assert.deepEqual(AKSI_TAB.penawaran, ["sekretariat", "penawaran"]);
  assert.deepEqual(AKSI_TAB.kalah, ["sekretariat", "penawaran"]);
  assert.equal(TAB_KSO.sekretariat.peran, "sekretaris");
  assert.equal(putuskanIzin(user(), eff({ permissions: { "kso-komite-sekretariat": izin(true, true) } }), "sekretariat", "edit"), true);
});

test("validasi PKS: harga, tenor, volume minimum, dan daftar klausul wajib ada", () => {
  assert.match(validasiAksi("pks", { harga_deal: 12800 })!, /Tenor/);
  assert.match(validasiAksi("pks", { harga_deal: 12800, tenor_bulan: 36 })!, /Volume minimum/);
  assert.match(validasiAksi("pks", { harga_deal: 12800, tenor_bulan: 36, volume_minimum: 1920 })!, /klausul/);
  assert.equal(validasiAksi("pks", { harga_deal: 12800, tenor_bulan: 36, volume_minimum: 0, klausul: [] }), null);
});

test("PKS tidak cocok: rincian tampil dalam bahasa manusia, tanpa kode", () => {
  const t = terjemahGalatWeb("PKS_TIDAK_COCOK: perlindungan wajib hilang (denda_telat, lapor_test)");
  assert.equal(t.status, 409);
  assert.match(t.pesan, /denda keterlambatan bayar, kewajiban lapor jumlah test/);
  assert.doesNotMatch(t.pesan, /[A-Z]{3,}_[A-Z_]+|[a-z]+_[a-z]+/);
  assert.match(terjemahGalatWeb("PKS_TIDAK_COCOK: tenor 48 bln melebihi mandat 36 bln").pesan, /tenor 48 bln melebihi mandat 36 bln/);
});

test("Susunan Komite: diubah hanya lewat centang Akses Grup atau superuser — role admin tidak otomatis", () => {
  assert.equal(bolehUbahSusunan(user({ role: "admin" }), eff()), false);
  assert.equal(bolehUbahSusunan(user(), eff({ superuser: true })), true);
  assert.equal(bolehUbahSusunan(user(), eff({ permissions: { "kso-komite-susunan": izin(true, true) } })), true);
  assert.equal(bolehUbahSusunan(user(), eff({ permissions: { "kso-komite-susunan": izin(true, false) } })), false);
});
