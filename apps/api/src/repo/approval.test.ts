import assert from "node:assert/strict";
import { test } from "node:test";

import { gabungPetaHod, pesanTargetGagal, pilihHodKey, type SebabTargetGagal } from "./approval.js";

// Sebelum #1071 dibereskan, KEEMPAT keadaan di bawah menghasilkan satu kalimat
// yang sama: `kontak "..." belum dikonfigurasi — isi dulu di halaman config`.
// Itu benar hanya untuk keadaan pertama. Untuk tiga sisanya kalimat itu
// mengirim orang ke halaman yang salah: slot di Config Chain SUDAH terisi,
// yang bolong ada di data pengguna.
//
// Yang diuji di sini bukan kalimatnya persis, tapi dua hal yang menentukan
// apakah pesan itu berguna: (a) tiap sebab menghasilkan pesan BERBEDA, dan
// (b) pesannya menyebut tempat perbaikan yang benar.

const KASUS: SebabTargetGagal[] = [
  { sebab: "belum-dikonfigurasi", label: "HoD Sales" },
  { sebab: "hod-tanpa-pengguna", label: "HoD Bisnis", hodKey: "mufid" },
  { sebab: "hod-tanpa-wa", label: "HoD After Sales", hodKey: "muhid", nama: "Muhid" },
  { sebab: "direktur-tak-ada", label: "Direktur" },
  { sebab: "atribut-kosong", label: "HoD Sales", atribut: "wilayah" },
  { sebab: "atribut-kosong", label: "HoD Bisnis", atribut: "kategori" },
];

test("tiap sebab menghasilkan pesan yang berbeda", () => {
  const pesan = KASUS.map(pesanTargetGagal);
  assert.equal(new Set(pesan).size, KASUS.length, `ada pesan yang kembar:\n${pesan.join("\n")}`);
});

test("hanya 'belum-dikonfigurasi' yang MENGARAHKAN ke Config Chain", () => {
  // Inilah inti bug-nya: dulu SEMUA sebab menunjuk ke sini.
  //
  // Pola sengaja `di halaman Config Chain` (bentuk arahan), bukan sekadar
  // `Config Chain`. Sebab "hod-tanpa-pengguna" memang MENYEBUT Config Chain,
  // tapi untuk menyangkalnya ("...bukan di Config Chain") — dan penyangkalan
  // itu berguna, ia menahan orang dari halaman yang salah. Asersi versi
  // pertama mencocokkan kata belaka, jadi ia menganggap penyangkalan itu
  // sebagai arahan dan gagal. Yang diuji seharusnya sifatnya, bukan katanya.
  const keConfig = KASUS.filter((k) => /di halaman Config Chain/i.test(pesanTargetGagal(k)));
  assert.deepEqual(
    keConfig.map((k) => k.sebab),
    ["belum-dikonfigurasi"],
  );
});

test("sebab non-config boleh menyangkal Config Chain, asal tak mengarahkan ke sana", () => {
  const p = pesanTargetGagal(KASUS[1]); // hod-tanpa-pengguna
  assert.match(p, /bukan di Config Chain/i);
  assert.doesNotMatch(p, /di halaman Config Chain/i);
});

test("sebab yang perbaikannya di data pengguna menunjuk menu Pengguna", () => {
  for (const sebab of ["hod-tanpa-pengguna", "hod-tanpa-wa", "direktur-tak-ada"] as const) {
    const k = KASUS.find((x) => x.sebab === sebab)!;
    const pesan = pesanTargetGagal(k);
    assert.match(pesan, /menu Pengguna/i, `sebab "${sebab}" tak menunjuk menu Pengguna: ${pesan}`);
  }
});

test("pesan menyebut label tahap — tanpa itu, request mana yang tertahan jadi tebakan", () => {
  for (const k of KASUS) {
    assert.match(pesanTargetGagal(k), new RegExp(k.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("sebab hod menyebut hod_key-nya, supaya bisa dicari di data", () => {
  assert.match(pesanTargetGagal(KASUS[1]), /mufid/);
  assert.match(pesanTargetGagal(KASUS[2]), /muhid/);
});

test("hod-tanpa-wa menyebut NAMA orangnya, bukan cuma hod_key", () => {
  // Bedanya dgn hod-tanpa-pengguna: di sini orangnya ADA dan sudah tertaut,
  // jadi menyebut namanya membuat perbaikannya satu langkah — buka orang itu,
  // isi nomornya.
  assert.match(pesanTargetGagal(KASUS[2]), /Muhid/);
});

// ── Routing tahap per atribut request (#1071, migrasi 190) ─────────────────
// Keputusan pemilik fitur: tahap 1 ikut wilayah pengaju, tahap 2 ikut kategori
// barang. Peta di bawah = seed migrasi 190.
const TAHAP1 = { routing: "wilayah" as const, hodKey: null, hodKeyMap: { east: "rocky", west: "yogi" } };
const TAHAP2 = { routing: "kategori" as const, hodKey: null, hodKeyMap: { IVD: "mufid", Medical: "arman" } };
const TAHAP4 = { routing: "tetap" as const, hodKey: "ika", hodKeyMap: null };

test("tahap 1 memilih HoD Sales dari wilayah pengaju", () => {
  assert.deepEqual(pilihHodKey(TAHAP1, { wilayah: "east", kategori: null }), { hodKey: "rocky" });
  assert.deepEqual(pilihHodKey(TAHAP1, { wilayah: "west", kategori: "IVD" }), { hodKey: "yogi" });
});

test("tahap 2 memilih HoD Bisnis dari kategori barang", () => {
  assert.deepEqual(pilihHodKey(TAHAP2, { wilayah: "east", kategori: "IVD" }), { hodKey: "mufid" });
  assert.deepEqual(pilihHodKey(TAHAP2, { wilayah: null, kategori: "Medical" }), { hodKey: "arman" });
});

test("atribut kosong dilaporkan sebagai 'kurang', BUKAN dijatuhkan ke hod_key slot", () => {
  // hod_key slot sengaja diisi di sini: kalau pilihHodKey jatuh ke nilai itu,
  // request tanpa wilayah akan diam-diam dikirim ke satu orang tetap.
  const slotBerisi = { ...TAHAP1, hodKey: "rocky" };
  assert.deepEqual(pilihHodKey(slotBerisi, { wilayah: null, kategori: "IVD" }), { kurang: "wilayah" });
  assert.deepEqual(pilihHodKey(TAHAP2, { wilayah: "east", kategori: null }), { kurang: "kategori" });
});

test("peta tanpa entri untuk nilainya = belum dikonfigurasi (hodKey null), bukan 'kurang'", () => {
  const petaSebagian = { ...TAHAP1, hodKeyMap: { east: "rocky" } };
  assert.deepEqual(pilihHodKey(petaSebagian, { wilayah: "west", kategori: null }), { hodKey: null });
});

test("tahap 'tetap' mengabaikan atribut request", () => {
  assert.deepEqual(pilihHodKey(TAHAP4, { wilayah: null, kategori: null }), { hodKey: "ika" });
  assert.deepEqual(pilihHodKey(TAHAP4, { wilayah: "west", kategori: "Medical" }), { hodKey: "ika" });
});

test("pesan atribut-kosong menyebut atribut yang hilang dan tak mengarah ke Config Chain", () => {
  const w = pesanTargetGagal({ sebab: "atribut-kosong", label: "HoD Sales", atribut: "wilayah" });
  const k = pesanTargetGagal({ sebab: "atribut-kosong", label: "HoD Bisnis", atribut: "kategori" });
  assert.match(w, /wilayah/);
  assert.match(k, /kategori/);
  assert.doesNotMatch(w, /di halaman Config Chain/i);
  assert.doesNotMatch(k, /di halaman Config Chain/i);
});

test("gabung peta: kunci di luar kosakata routing ditolak", () => {
  // "East" (huruf besar) dan "ivd" adalah salah ketik yang paling mungkin.
  assert.equal(gabungPetaHod("wilayah", TAHAP1.hodKeyMap, { East: "rocky" }).ok, false);
  assert.equal(gabungPetaHod("kategori", TAHAP2.hodKeyMap, { ivd: "mufid" }).ok, false);
  assert.equal(gabungPetaHod("tetap", null, { east: "rocky" }).ok, false);
});

test("gabung peta: ubah satu entri, entri lain tetap; null menghapus", () => {
  const g = gabungPetaHod("wilayah", TAHAP1.hodKeyMap, { west: "rocky" });
  assert.deepEqual(g, { ok: true, peta: { east: "rocky", west: "rocky" } });
  const h = gabungPetaHod("kategori", TAHAP2.hodKeyMap, { Medical: null });
  assert.deepEqual(h, { ok: true, peta: { IVD: "mufid" } });
});
