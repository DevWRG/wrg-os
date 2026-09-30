import assert from "node:assert/strict";
import { test } from "node:test";

import { LOGIN_ROLES, normalizeLoginRole } from "./users.js";

// Gerbang nilai app_user.role. Yang dijaga di sini bukan sekadar "tolak sampah",
// tapi satu kelas bug yang sudah ada di kode: perms.ts membandingkan
// `role === "admin"` PERSIS (tanpa trim/lowercase) sedangkan berkas *-access.ts
// memakai norm() yang melakukan keduanya. Nilai ' Admin' karena itu lolos gate
// Insentif/Executive tapi gagal di can() — orang yang sama punya akses berbeda
// per menu, tanpa error apa pun. Normalisasi di titik tulis menutup celah itu.

test("nilai kanonik diterima apa adanya", () => {
  assert.equal(normalizeLoginRole("admin"), "admin");
  assert.equal(normalizeLoginRole("direktur"), "direktur");
  assert.equal(normalizeLoginRole("user"), "user");
});

test("spasi & huruf besar dirapikan, bukan ditolak", () => {
  assert.equal(normalizeLoginRole(" Admin "), "admin");
  assert.equal(normalizeLoginRole("DIREKTUR"), "direktur");
  assert.equal(normalizeLoginRole("User\n"), "user");
});

test("'viewer' ditolak — dihapus lewat migrasi 181", () => {
  // Tak pernah dicek kode mana pun, tapi namanya menjanjikan read-only sehingga
  // admin mengira sudah membatasi orang padahal izin nyatanya dari Akses Grup.
  assert.equal(normalizeLoginRole("viewer"), null);
});

test("nilai ngawur & kosong ditolak, bukan diam-diam jadi 'user'", () => {
  // Jatuh diam-diam ke default akan menyembunyikan salah ketik admin: dia mengira
  // sudah menaikkan orang jadi direktur, tabel tetap menampilkan user.
  for (const v of ["", "   ", "superuser", "hod", "Admin2", null, undefined, 7, {}]) {
    assert.equal(normalizeLoginRole(v), null, `harus ditolak: ${JSON.stringify(v)}`);
  }
});

test("daftar kanonik tepat tiga nilai", () => {
  // Penjaga arah: menambah role baru berarti ada gate baru yang membacanya.
  // Kalau daftar ini tumbuh tanpa gate, kita mengulang persis kasus 'viewer'.
  assert.deepEqual([...LOGIN_ROLES], ["admin", "direktur", "user"]);
});
