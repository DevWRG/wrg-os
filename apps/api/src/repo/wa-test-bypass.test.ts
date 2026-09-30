import assert from "node:assert/strict";
import { test } from "node:test";

import { isWaTestBypassGroup, namaUji, TANDA_UJI } from "./wa-test-bypass.js";

const RESEARCH = "120363409252019573@g.us";
const LAIN = "120363000000000999@g.us";

function dengan(env: string | undefined, fn: () => void): void {
  const asli = process.env.WA_TEST_BYPASS_GROUP;
  if (env === undefined) delete process.env.WA_TEST_BYPASS_GROUP;
  else process.env.WA_TEST_BYPASS_GROUP = env;
  try {
    fn();
  } finally {
    if (asli === undefined) delete process.env.WA_TEST_BYPASS_GROUP;
    else process.env.WA_TEST_BYPASS_GROUP = asli;
  }
}

test("env tak di-set → MATI untuk grup mana pun (ini satu-satunya penjaga prod)", () => {
  dengan(undefined, () => {
    assert.equal(isWaTestBypassGroup(RESEARCH), false);
    assert.equal(isWaTestBypassGroup(LAIN), false);
  });
});

test("env kosong / cuma koma & spasi → tetap MATI, bukan cocok-semua", () => {
  for (const env of ["", "   ", ",", " , , "]) {
    dengan(env, () => assert.equal(isWaTestBypassGroup(RESEARCH), false, `env=${JSON.stringify(env)}`));
  }
});

test("hanya grup yang terdaftar yang terbuka", () => {
  dengan(RESEARCH, () => {
    assert.equal(isWaTestBypassGroup(RESEARCH), true);
    assert.equal(isWaTestBypassGroup(LAIN), false);
  });
});

test("daftar berkoma + spasi di sekitar JID tetap dikenali", () => {
  dengan(` ${RESEARCH} , ${LAIN} `, () => {
    assert.equal(isWaTestBypassGroup(RESEARCH), true);
    assert.equal(isWaTestBypassGroup(LAIN), true);
  });
});

test("JID kosong/null tak pernah cocok", () => {
  dengan(RESEARCH, () => {
    assert.equal(isWaTestBypassGroup(null), false);
    assert.equal(isWaTestBypassGroup(undefined), false);
    assert.equal(isWaTestBypassGroup(""), false);
  });
});

test("cocoknya PERSIS — substring tak boleh lolos", () => {
  // JID grup itu angka panjang; pencocokan longgar akan membuat grup lain yang
  // JID-nya kebetulan berawalan sama ikut terbuka.
  dengan(RESEARCH, () => {
    assert.equal(isWaTestBypassGroup(RESEARCH.replace("@g.us", "9@g.us")), false);
    assert.equal(isWaTestBypassGroup("120363409252019573"), false);
  });
});

test("namaUji menandai baris roster hasil bypass", () => {
  assert.equal(namaUji("Michael Christopher"), `${TANDA_UJI}Michael Christopher`);
  assert.equal(namaUji("  Michael  "), `${TANDA_UJI}Michael`);
});

test("namaUji idempoten — prefiks tak menumpuk saat dipanggil ulang", () => {
  // ensureBypassTeknisi di-key `nama` (UNIQUE). Kalau prefiksnya menumpuk,
  // tiap pesan bikin baris BARU dan roster uji beranak tanpa batas.
  const sekali = namaUji("Michael");
  assert.equal(namaUji(sekali), sekali);
  assert.equal(namaUji(namaUji(sekali)), sekali);
});
