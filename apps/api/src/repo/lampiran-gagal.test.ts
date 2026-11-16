import assert from "node:assert/strict";
import { test } from "node:test";

import { adaLampiranGagal, balasanLampiranGagal } from "./lampiran-gagal.js";

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
