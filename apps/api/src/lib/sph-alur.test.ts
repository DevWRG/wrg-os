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

// ── Diskon berjenjang (migrasi 301) ──

test("tier direktur: approve tertahan sampai Direktur menyetujui", () => {
  const s: InputAksiSph = { ...dasar, status: "hod_review", bisaEdit: true, tier: "direktur" };
  const admin = aksiSph(s);
  assert.equal(admin.direkturPending, true);
  assert.equal(admin.approve.boleh, false);
  assert.match(admin.approve.alasan ?? "", /Direktur/);
  assert.equal(admin.direktur.boleh, false);
  assert.match(admin.direktur.alasan ?? "", /hanya untuk Direktur/);
  assert.equal(admin.petunjuk, "Perlu persetujuan Direktur");
  assert.equal(admin.perluAksiSaya, false);

  const dir = aksiSph({ ...s, bisaEdit: false, bolehDirekturPeran: true });
  assert.equal(dir.direktur.boleh, true);
  assert.equal(dir.utama, "direktur");
  assert.equal(dir.perluAksiSaya, true);

  const sudah = aksiSph({ ...s, direkturSudah: true });
  assert.equal(sudah.direkturPending, false);
  assert.equal(sudah.approve.boleh, true);
  assert.equal(sudah.utama, "approve");
});

test("tier direktur: pembuat tak boleh menyetujui walau Direktur; draft belum bisa", () => {
  const s: InputAksiSph = { ...dasar, status: "hod_review", tier: "direktur", bolehDirekturPeran: true };
  assert.match(aksiSph({ ...s, isCreator: true }).direktur.alasan ?? "", /pembuat/);
  const d = aksiSph({ ...s, status: "draft" });
  assert.equal(d.direktur.boleh, false);
  assert.equal(d.petunjuk, "Menunggu review HoD · lalu persetujuan Direktur");
});

test("tier hod/normal: tak ada langkah Direktur; review ditandai diskon di atas batas", () => {
  const h = aksiSph({ ...dasar, bolehReviewPeran: true, tier: "hod" });
  assert.equal(h.direkturPending, false);
  assert.equal(h.petunjuk, "Perlu review Anda · diskon di atas batas");
  const n = aksiSph({ ...dasar, status: "hod_review", bisaEdit: true });
  assert.equal(n.direktur.boleh, false);
  assert.equal(n.approve.boleh, true);
});
