import assert from "node:assert/strict";
import { test } from "node:test";

import { adaLampiranGagal, balasanLampiranGagal, lampiranMasihSegar } from "./lampiran-gagal.js";

test("lampiran gagal: penanda openclaw tanpa media_path", () => {
  assert.equal(adaLampiranGagal({ body: "#REPORT 1 [whatsapp attachment unavailable]", media_path: null }), true);
  assert.equal(adaLampiranGagal({ body: "[WhatsApp attachment unavailable]" }), true);
  assert.equal(adaLampiranGagal({ body: "[whatsapp attachment unavailable]", media_path: "/x.jpg" }), false);
  assert.equal(adaLampiranGagal({ body: "#REPORT 1 selesai", media_path: null }), false);
  assert.equal(adaLampiranGagal({ body: null }), false);
});

test("lampiran gagal: balasan menyapa & minta kirim ulang", () => {
  assert.match(balasanLampiranGagal("Budi"), /^⚠️ Budi, foto\/lampiran gagal terkirim .*Kirim ulang/);
  assert.match(balasanLampiranGagal(null), /^⚠️ Foto\/lampiran gagal/);
});

test("lampiran gagal: hanya pesan ≤15 menit yang diperingatkan (antrean lama diam)", () => {
  const now = new Date("2026-11-16T12:05:00Z");
  assert.equal(lampiranMasihSegar("2026-11-16T12:00:00Z", now), true);
  assert.equal(lampiranMasihSegar("2026-11-16T11:50:00Z", now), true);
  assert.equal(lampiranMasihSegar("2026-11-16T09:12:00Z", now), false);
  assert.equal(lampiranMasihSegar(null, now), false);
  assert.equal(lampiranMasihSegar("bukan tanggal", now), false);
});
