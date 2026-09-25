import assert from "node:assert/strict";
import { test } from "node:test";

import { pesanTargetGagal, type SebabTargetGagal } from "./approval.js";

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
