import assert from "node:assert/strict";
import { test } from "node:test";

import { bolehKirimKe, parseAllowedTargets, sendViaWaGateway, ringkasGalat} from "./wasend.js";

// Lapis 3 pemisahan environment. Tumpukan dev membalas lewat bridge yang SAMA
// dengan prod, jadi secara teknis ia bisa mengirim ke grup mana pun — satu bug
// atau satu env keliru cukup untuk mengirim pesan uji ke grup Sales/HoD yang
// nyata. Allowlist di chokepoint membuat itu tidak mungkin.

const RESEARCH = "120363000000000001@g.us";
const SALES = "120363405485256544@g.us";

test("daftar kosong = tanpa batas (perilaku prod sekarang)", () => {
  // Wajib begini: pembatasan ini opt-in. Kalau default-nya membatasi,
  // menambahkan fitur ini akan membuat prod bisu.
  const a = parseAllowedTargets("");
  assert.equal(a.size, 0);
  assert.equal(bolehKirimKe(SALES, a), true);
});

test("tujuan terdaftar boleh, yang lain tidak", () => {
  const a = parseAllowedTargets(RESEARCH);
  assert.equal(bolehKirimKe(RESEARCH, a), true);
  assert.equal(bolehKirimKe(SALES, a), false);
});

test("JID grup dicocokkan apa adanya, bukan lewat digit", () => {
  // Dua JID grup berbeda bisa punya digit yang mirip; pencocokan digit-saja
  // tak boleh membuat grup lain lolos.
  const a = parseAllowedTargets(RESEARCH);
  assert.equal(bolehKirimKe("120363000000000002@g.us", a), false);
});

test("nomor telepon cocok lintas format tanda baca", () => {
  // Allowlist ditulis manusia; memaksa satu format berarti gagal cuma karena
  // tanda hubung.
  const a = parseAllowedTargets("6282143726401");
  for (const v of ["6282143726401", "+62 821-4372-6401", "+6282143726401", "62 821 4372 6401"]) {
    assert.equal(bolehKirimKe(v, a), true, `gagal untuk ${v}`);
  }
  assert.equal(bolehKirimKe("6289622039560", a), false);
});

test("parser mengabaikan spasi dan entri kosong", () => {
  const a = parseAllowedTargets(` ${RESEARCH} , , ${SALES} `);
  assert.equal(a.size, 2);
  assert.equal(parseAllowedTargets(undefined).size, 0);
});

test("tujuan kosong ditolak saat daftar aktif", () => {
  const a = parseAllowedTargets(RESEARCH);
  assert.equal(bolehKirimKe("", a), false);
});

// ── Perilaku end-to-end lewat sendViaWaGateway ────────────────────────────

function withEnv<T>(env: Record<string, string | undefined>, fn: (pesan: string[]) => T): T {
  const asli: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    asli[k] = process.env[k];
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const warnAsli = console.warn;
  const logAsli = console.log;
  const pesan: string[] = [];
  console.warn = (...a: unknown[]) => { pesan.push(a.map(String).join(" ")); };
  console.log = () => {};
  try {
    return fn(pesan);
  } finally {
    console.warn = warnAsli;
    console.log = logAsli;
    for (const k of Object.keys(asli)) {
      if (asli[k] === undefined) delete process.env[k];
      else process.env[k] = asli[k];
    }
  }
}

test("live ke tujuan di luar allowlist → sent:false, TIDAK ada fetch", async () => {
  const fetchAsli = globalThis.fetch;
  let dipanggil = 0;
  globalThis.fetch = (async () => { dipanggil += 1; return { ok: true, status: 200, text: async () => "" }; }) as unknown as typeof fetch;
  try {
    const r = await withEnv(
      { WA_SEND_URL: "http://127.0.0.1:18080/send", WA_DRY_RUN: "false", WA_SEND_ALLOWED_TARGETS: RESEARCH, WA_TEST_TARGET: undefined },
      (pesan) => sendViaWaGateway(SALES, "halo").then((res) => ({ res, pesan })),
    );
    assert.equal(r.res.sent, false, "harus GAGAL, bukan sukses senyap");
    assert.match(String(r.res.error), /allowlist/);
    assert.equal(dipanggil, 0, "gateway tak boleh dihubungi sama sekali");
    assert.match(r.pesan.join("\n"), /DITOLAK/);
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("live ke tujuan terdaftar → tetap terkirim", async () => {
  const fetchAsli = globalThis.fetch;
  let dipanggil = 0;
  globalThis.fetch = (async () => { dipanggil += 1; return { ok: true, status: 200, text: async () => "" }; }) as unknown as typeof fetch;
  try {
    const res = await withEnv(
      { WA_SEND_URL: "http://127.0.0.1:18080/send", WA_DRY_RUN: "false", WA_SEND_ALLOWED_TARGETS: RESEARCH, WA_TEST_TARGET: undefined },
      () => sendViaWaGateway(RESEARCH, "halo"),
    );
    assert.equal(res.sent, true);
    assert.equal(dipanggil, 1);
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("dry-run TIDAK diblokir allowlist — teks balasan harus tetap terlihat", async () => {
  // Memblokir di dry-run akan menyembunyikan justru hal yang dibutuhkan saat
  // menguji: isi balasannya. Tak ada yang terkirim di mode ini.
  const res = await withEnv(
    { WA_SEND_URL: "http://127.0.0.1:18080/send", WA_DRY_RUN: "true", WA_SEND_ALLOWED_TARGETS: RESEARCH, WA_TEST_TARGET: undefined },
    () => sendViaWaGateway(SALES, "halo"),
  );
  assert.equal(res.sent, true);
  assert.equal(res.dryRun, true);
});

test("WA_TEST_TARGET dialihkan DULU, lalu tujuan hasil alihan yang dinilai", async () => {
  // Urutannya penting: kalau allowlist dinilai atas tujuan ASLI, pengalihan ke
  // nomor uji bisa lolos padahal nomor itu tak terdaftar.
  const fetchAsli = globalThis.fetch;
  let dipanggil = 0;
  globalThis.fetch = (async () => { dipanggil += 1; return { ok: true, status: 200, text: async () => "" }; }) as unknown as typeof fetch;
  try {
    const res = await withEnv(
      { WA_SEND_URL: "http://127.0.0.1:18080/send", WA_DRY_RUN: "false", WA_SEND_ALLOWED_TARGETS: RESEARCH, WA_TEST_TARGET: SALES },
      () => sendViaWaGateway(RESEARCH, "halo"),
    );
    assert.equal(res.sent, false, "tujuan hasil alihan (SALES) di luar daftar → harus ditolak");
    assert.equal(dipanggil, 0);
  } finally {
    globalThis.fetch = fetchAsli;
  }
});


// ── ringkasGalat: galat gateway tak boleh kehilangan sebabnya ──────────────
//
// Regresi 21 Sep 2026: `.slice(0, 200)` membuang EKOR jawaban bridge, padahal
// di situ alasannya berada. Yang tersimpan cuma perintah yang digaungkan.

test("ringkasGalat mengambil field error bila jawaban berupa JSON", () => {
  const mentah = JSON.stringify({ sent: false, error: "GatewayTransportError: gateway timeout after 10000ms" });
  assert.equal(ringkasGalat(mentah), "GatewayTransportError: gateway timeout after 10000ms");
});

test("ringkasGalat mempertahankan EKOR — di situ sebabnya berada", () => {
  // Bentuk asli yang menipu: 200 karakter pertama habis oleh perintah yang
  // digaungkan, alasan sesungguhnya menempel di ujung.
  const perintah = "Command failed: openclaw message send --channel whatsapp --target 1203634@g.us --message " +
    "x".repeat(4000);
  const sebab = "SIGALRM: proses dibunuh timeout";
  const hasil = ringkasGalat(JSON.stringify({ sent: false, error: `${perintah}\n${sebab}` }));
  assert.ok(hasil.includes(sebab), "alasan di ekor harus ikut tersimpan");
  assert.ok(hasil.includes("dipotong"), "harus menandai bahwa ada bagian dipotong");
  assert.ok(hasil.length < 1400, `panjang wajar, dapat ${hasil.length}`);
});

test("ringkasGalat membiarkan teks pendek apa adanya", () => {
  assert.equal(ringkasGalat("tujuan di luar allowlist: +628"), "tujuan di luar allowlist: +628");
});

test("ringkasGalat tahan terhadap jawaban non-JSON", () => {
  const html = "<html><body>502 Bad Gateway</body></html>";
  assert.equal(ringkasGalat(html), html);
});
