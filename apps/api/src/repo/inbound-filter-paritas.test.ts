// Paritas daftar hashtag yang DIJARING processUnprocessed vs yang DIKENALI
// detectKind. Dua daftar ini pernah menyimpang tanpa suara di main: `faktur`
// dikenali detectKind tapi hilang dari regex penyaring SQL, jadi #FAKTUR teks
// tak pernah diproses (ketahuan saat port F95, 13 Okt 2026). Berkas ini sengaja
// identik di main & dev supaya sinkron main→dev tak berkonflik.
//
//   pnpm --filter @wrg/api test

import test from "node:test";
import assert from "node:assert/strict";

import { INBOUND_FILTER_KINDS, detectKind, inboundHashtagPattern } from "./inbound.js";

test("setiap hashtag yang dijaring juga dikenali detectKind", () => {
  for (const h of INBOUND_FILTER_KINDS) {
    assert.equal(detectKind(`#${h.toUpperCase()} uji`), h, `#${h}`);
  }
});

test("regex penyaring (dialek Postgres ~*, di sini diuji sebagai JS) menjaring tiap hashtag", () => {
  const re = new RegExp(inboundHashtagPattern(), "i");
  for (const h of INBOUND_FILTER_KINDS) {
    assert.ok(re.test(`pengantar\n# ${h} uji`), `#${h}`);
  }
});

test("faktur, call, note ada di daftar jaring", () => {
  for (const h of ["faktur", "call", "note"]) {
    assert.ok((INBOUND_FILTER_KINDS as readonly string[]).includes(h), h);
  }
});
