import assert from "node:assert/strict";
import { test } from "node:test";

import { callAi, statistikDegradasiAi } from "./ai.js";

// Gerbang "hasil terdegradasi bukan hasil".
//
// 25 Sep 2026, kuota OpenRouter habis (usage $49,81 vs limit $5). services/ai
// membalas 200 + teks template dengan penanda `model: "dry-run-fallback"`, dan
// karena 200 terlihat sukses, templatenya ikut disimpan sebagai hasil sungguhan:
// dua baris monitor_digest kind 'rekap' terisi DUMP PROMPT, yang terpanjang
// 54.878 karakter. Job-nya sendiri tetap dicatat "ok".
//
// Semua tes di bawah menjaga satu aturan: 200 yang isinya template harus
// berubah jadi error, KECUALI pemanggil yang memang memintanya.

function stubAi(body: Record<string, unknown>, status = 200) {
  const asli = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = asli;
  };
}

test("hasil ber-model dry-run-fallback ditolak jadi 503, bukan diteruskan 200", async () => {
  const pulih = stubAi({ model: "dry-run-fallback", rekap: "[DRY RUN — tanpa LLM]\n\nSYSTEM:\n..." });
  try {
    const r = await callAi("/rekap", {});
    // 503 = status yang SUDAH ditangani 19 pemanggil lewat cabang status >= 400.
    assert.equal(r.status, 503);
    assert.equal(r.data.degraded, true);
    // Teks templatenya tidak boleh ikut lolos — kalau ia masih ada di data,
    // pemanggil yang ceroboh tetap bisa menyimpannya.
    assert.equal(r.data.rekap, undefined);
  } finally {
    pulih();
  }
});

test("dry-run yang DISENGAJA tetap lolos apa adanya", async () => {
  // Pembedaan yang menentukan: 'dry-run' = sengaja tanpa LLM (AI_DRY_RUN /
  // tanpa API key) dan itu sah. Kalau keduanya disamakan, mode dry-run untuk
  // hemat token ikut mati.
  const pulih = stubAi({ model: "dry-run", rekap: "template" });
  try {
    const r = await callAi("/rekap", {});
    assert.equal(r.status, 200);
    assert.equal(r.data.rekap, "template");
  } finally {
    pulih();
  }
});

test("hasil LLM sungguhan tidak tersentuh", async () => {
  const pulih = stubAi({ model: "anthropic/claude-haiku-4.5", rekap: "REKAP WRG ..." });
  try {
    const r = await callAi("/rekap", {});
    assert.equal(r.status, 200);
    assert.equal(r.data.rekap, "REKAP WRG ...");
  } finally {
    pulih();
  }
});

test("izinkanTemplate meneruskan hasil degradasi apa adanya", async () => {
  // Dipakai #KLAIM: di sana field kosong + ocr_dry_run adalah degradasi jujur,
  // dan menolaknya jadi 503 justru MENGHILANGKAN baris doc_klaim-nya.
  const pulih = stubAi({ model: "dry-run-fallback", dry_run: true, raw_text: null });
  try {
    const r = await callAi("/ocr-klaim", {}, { izinkanTemplate: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.model, "dry-run-fallback");
  } finally {
    pulih();
  }
});

test("penolakan tetap membawa model, supaya kolom audit tak kehilangan sebab", async () => {
  // serviceticket menulis model_used; tanpa ini "services/ai mati" dan "LLM
  // gagal, hasilnya template" jadi tak terbedakan di data.
  const pulih = stubAi({ model: "dry-run-fallback", severity: "berat" });
  try {
    const r = await callAi("/triage-ticket", {});
    assert.equal(r.data.model, "dry-run-fallback");
    // Field hasilnya TIDAK boleh ikut — 'berat' di sini cuma tebakan template.
    assert.equal(r.data.severity, undefined);
  } finally {
    pulih();
  }
});

test("degradasi terhitung dan terpapar untuk dipantau", async () => {
  const sebelum = statistikDegradasiAi().total;
  const pulih = stubAi({ model: "dry-run-fallback" });
  try {
    await callAi("/resume", {});
    await callAi("/daily-summary", {});
  } finally {
    pulih();
  }
  const sesudah = statistikDegradasiAi();
  assert.equal(sesudah.total, sebelum + 2);
  // Dipapar di GET /health supaya "AI diam-diam mati" bisa dipantau dari luar
  // tanpa menunggu ada orang membaca log pm2.
  assert.equal(sesudah.terakhir_path, "/daily-summary");
  assert.match(sesudah.terakhir_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("izinkanTemplate tetap dihitung sebagai degradasi", async () => {
  // Pengecualiannya soal APA yang dilakukan dengan hasilnya, bukan soal
  // menyembunyikan kejadiannya dari pemantauan.
  const sebelum = statistikDegradasiAi().total;
  const pulih = stubAi({ model: "dry-run-fallback" });
  try {
    await callAi("/ocr-klaim", {}, { izinkanTemplate: true });
  } finally {
    pulih();
  }
  assert.equal(statistikDegradasiAi().total, sebelum + 1);
});

test("status error dari services/ai tidak berubah maknanya", async () => {
  const pulih = stubAi({ error: "boom" }, 500);
  try {
    const r = await callAi("/rekap", {});
    assert.equal(r.status, 500);
  } finally {
    pulih();
  }
});
