import assert from "node:assert/strict";
import { test } from "node:test";

import { aksiSph, polaCariSph, type InputAksiSph } from "./sph-alur.js";

const dasar: InputAksiSph = { status: "draft", isCreator: false, bolehReviewPeran: false, bisaEdit: false, variantPending: 0 };

test("draft: HoD Business bukan pembuat → review jadi aksi utama", () => {
  const a = aksiSph({ ...dasar, bolehReviewPeran: true });
  assert.equal(a.review.boleh, true);
  assert.equal(a.utama, "review");
  assert.equal(a.perluAksiSaya, true);
  assert.equal(a.petunjuk, "Perlu review Anda");
});

test("draft: pembuat tak boleh review walau HoD/admin, alasannya disebut", () => {
  const a = aksiSph({ ...dasar, isCreator: true, bolehReviewPeran: true, bisaEdit: true });
  assert.equal(a.review.boleh, false);
  assert.match(a.review.alasan ?? "", /pembuat/);
  assert.equal(a.utama, null);
  assert.equal(a.petunjuk, "Menunggu review HoD Business");
});

test("draft: bukan HoD → review ditolak dgn alasan peran", () => {
  const a = aksiSph({ ...dasar, bisaEdit: true });
  assert.equal(a.review.boleh, false);
  assert.match(a.review.alasan ?? "", /HoD Business/);
  // approve belum relevan di draft
  assert.equal(a.approve.boleh, false);
  assert.match(a.approve.alasan ?? "", /review HoD/);
  // syarat & batal tetap boleh dgn izin edit
  assert.equal(a.ubahSyarat.boleh, true);
  assert.equal(a.batal.boleh, true);
});

test("hod_review: approve butuh edit, bukan pembuat, varian beres", () => {
  const s = { ...dasar, status: "hod_review" };
  assert.equal(aksiSph({ ...s, bisaEdit: true }).approve.boleh, true);
  assert.equal(aksiSph({ ...s, bisaEdit: true }).utama, "approve");
  assert.match(aksiSph({ ...s }).approve.alasan ?? "", /edit/);
  assert.match(aksiSph({ ...s, bisaEdit: true, isCreator: true }).approve.alasan ?? "", /pembuat/);
  const v = aksiSph({ ...s, bisaEdit: true, variantPending: 2 });
  assert.equal(v.approve.boleh, false);
  assert.match(v.approve.alasan ?? "", /2 item/);
  assert.equal(v.konfirmasiVarian.boleh, true);
  assert.equal(v.utama, "konfirmasiVarian");
});

test("approved: kirim butuh edit (pembuat boleh kirim), ganti ttd bukan pembuat", () => {
  const s = { ...dasar, status: "approved" };
  const a = aksiSph({ ...s, bisaEdit: true, isCreator: true });
  assert.equal(a.kirim.boleh, true);
  assert.equal(a.utama, "kirim");
  assert.equal(a.gantiTtd.boleh, false);
  assert.equal(a.ubahSyarat.boleh, false);
  assert.equal(aksiSph({ ...s }).kirim.boleh, false);
  assert.equal(aksiSph({ ...s }).petunjuk, "Disetujui — menunggu dikirim");
});

test("sent & canceled: tak ada aksi, batal ditolak", () => {
  for (const status of ["sent", "canceled"]) {
    const a = aksiSph({ ...dasar, status, bisaEdit: true, bolehReviewPeran: true });
    assert.equal(a.utama, null);
    assert.equal(a.batal.boleh, false);
    assert.equal(a.kirim.boleh, false);
    assert.equal(a.review.boleh, false);
  }
});

test("polaCariSph escape wildcard & rapikan spasi", () => {
  assert.equal(polaCariSph(""), null);
  assert.equal(polaCariSph("   "), null);
  assert.equal(polaCariSph(null), null);
  assert.equal(polaCariSph("  rs   umum "), "%rs umum%");
  assert.equal(polaCariSph("50%_a\\b"), "%50\\%\\_a\\\\b%");
  assert.equal(polaCariSph("x".repeat(300))?.length, 102);
});
