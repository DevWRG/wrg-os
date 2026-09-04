#!/usr/bin/env node
// Probe READ-ONLY: apakah endpoint gudang / stok-per-gudang Accurate bisa
// dipakai user API kita? Menjawab dua pertanyaan yang menggantung di F37
// (lihat docs/features/F37-cross-branch-stock-visibility.md §4 dan header
// migrasi 082_cross_branch_stock.sql):
//
//   (a) apakah langganan Accurate WRG mengaktifkan multi-gudang, dan 12 gudang
//       cabang di seed 082 benar terdaftar di sana;
//   (b) apakah user API kita punya izin ke endpoint gudang/mutasi/opname.
//
// Skrip ini HANYA GET. Tak ada satupun request yang menulis ke Accurate.
//
// Kenapa skrip terpisah, bukan menambah syncer di accurateSync.ts: bentuk
// response endpoint ini belum pernah dilihat siapa pun di tim. Menulis syncer
// sekarang = menebak shape, dan kalau tebakannya salah kodenya dibuang.
// Probe dulu, desain belakangan.
//
// Jalankan DI MESIN YANG PUNYA KREDENSIAL PROD (Mac mini):
//   node scripts/qa/probe-accurate-warehouse.mjs
//   node scripts/qa/probe-accurate-warehouse.mjs --json   # keluaran mentah utk arsip
//
// Kredensial dibaca dengan urutan yang SAMA persis dengan loadCreds() di
// apps/api/src/repo/accurateSync.ts, supaya "jalan di sini" berarti "jalan juga
// di puller nanti":
//   1. env ACCURATE_ACCESS_TOKEN + ACCURATE_SIGNATURE_SECRET
//   2. file ACCURATE_CRED_FILE (default ~/.openclaw/credentials/accurate.json)
// Token/secret TIDAK PERNAH dicetak — yang ditampilkan cuma sumbernya.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const RAW_JSON = process.argv.includes("--json");

function loadCreds() {
  const host = process.env.ACCURATE_HOST || "zeus.accurate.id";
  const envTok = process.env.ACCURATE_ACCESS_TOKEN;
  const envSec = process.env.ACCURATE_SIGNATURE_SECRET;
  if (envTok && envSec) return { token: envTok, secret: envSec, host, from: "env" };
  const path = process.env.ACCURATE_CRED_FILE || `${homedir()}/.openclaw/credentials/accurate.json`;
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (j.access_token && j.signature_secret) {
      return { token: j.access_token, secret: j.signature_secret, host, from: path };
    }
    return { err: `file ${path} ada tapi tak memuat access_token/signature_secret` };
  } catch {
    return { err: `kredensial tak ditemukan (env kosong, file ${path} tak terbaca)` };
  }
}

// Format timestamp WIB yang dipakai Accurate — disalin dari accurateSync.ts.
function wibTimestamp() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function accGet(creds, path, qs) {
  const ts = wibTimestamp();
  const sig = createHmac("sha256", creds.secret).update(ts).digest("hex");
  const url = `https://${creds.host}${path}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}`, "X-Api-Timestamp": ts, "X-Api-Signature": sig },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // Accurate membalas HTML saat path tak dikenal / sesi mati — simpan
      // cuplikannya, jangan buang: itu justru pembeda "404 salah path" vs
      // "403 tak berizin".
      body = { _nonJson: text.slice(0, 200) };
    }
    return { httpStatus: res.status, body };
  } catch (e) {
    return { httpStatus: 0, body: { _err: String(e?.message ?? e) } };
  }
}

// Bentuk `d` beda-beda per endpoint (array vs objek berisi array). Diringkas
// jadi kunci + contoh 1 baris supaya cukup untuk mendesain syncer, tanpa
// menumpahkan seluruh katalog ke terminal.
function describe(d) {
  if (d == null) return "d = null/absen";
  if (Array.isArray(d)) {
    if (d.length === 0) return "d = array KOSONG (0 baris)";
    const keys = Object.keys(d[0] ?? {});
    return `d = array ${d.length} baris · kunci baris-1: ${keys.join(", ") || "(objek kosong)"}`;
  }
  if (typeof d === "object") return `d = objek · kunci: ${Object.keys(d).join(", ")}`;
  return `d = ${typeof d}: ${String(d).slice(0, 80)}`;
}

// Paginasi PENUH + penyebut eksplisit.
//
// Kenapa ada: versi pertama skrip ini menarik SATU halaman `pageSize=100` lalu
// mencetak panjangnya. Untuk daftar gudang, hasilnya "100" — angka yang identik
// dengan pageSize, dan kebetulan mendekati total (109), jadi terbaca seperti
// jawaban lengkap padahal memotong 9 baris tanpa suara. Jenis kekeliruan yang
// sama dengan "backend limit + hitung di klien" di /visits: yang hilang tidak
// menimbulkan gejala apa pun.
//
// Accurate mengembalikan penyebutnya di `sp.rowCount`, jadi di sini rowCount
// dipakai sebagai KLAIM yang harus dipenuhi — bukan cuma looping sampai halaman
// pendek. Kalau yang terkumpul tak sama dengan rowCount, itu DILAPORKAN, tidak
// dibulatkan diam-diam.
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // 5.000 baris; kalau kena, dicetak eksplisit (jangan senyap)

async function fetchAllPages(creds, path, extraQs) {
  const rows = [];
  let rowCount = null;
  let page = 1;
  let last = null;
  let capped = false;

  for (; page <= MAX_PAGES; page++) {
    const qs = [`sp.page=${page}`, `sp.pageSize=${PAGE_SIZE}`, extraQs].filter(Boolean).join("&");
    const res = await accGet(creds, path, qs);
    last = res;
    if (res.httpStatus !== 200 || res.body?.s !== true) return { ...res, rows: null, rowCount: null, pages: page };

    const d = res.body?.d;
    if (!Array.isArray(d)) return { ...res, rows: null, rowCount: null, pages: page }; // bukan endpoint list
    rows.push(...d);

    // `sp` bisa absen di sebagian endpoint — kalau begitu, jatuh balik ke
    // aturan halaman-pendek seperti syncer di accurateSync.ts.
    const sp = res.body?.sp;
    if (sp && Number.isFinite(Number(sp.rowCount))) rowCount = Number(sp.rowCount);

    if (rowCount != null && rows.length >= rowCount) break;
    if (d.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) capped = true;
  }

  return { ...last, rows, rowCount, pages: Math.min(page, MAX_PAGES), capped };
}

// Nama gudang paling berguna untuk diadu manual dengan seed 082 — itulah
// pertanyaan (a). Diambil best-effort karena nama fieldnya belum diketahui.
function warehouseNames(d) {
  if (!Array.isArray(d)) return null;
  const names = d
    .map((r) => r?.name ?? r?.warehouseName ?? r?.nama ?? null)
    .filter(Boolean)
    .map(String);
  return names.length ? names : null;
}

const creds = loadCreds();
if (creds.err) {
  console.error(`✗ ${creds.err}`);
  console.error("  Jalankan skrip ini di mesin yang punya kredensial prod (Mac mini).");
  process.exit(2);
}

console.log(`host       : ${creds.host}`);
console.log(`kredensial : ${creds.from === "env" ? "env ACCURATE_ACCESS_TOKEN/SIGNATURE_SECRET" : creds.from}`);
console.log("mode       : READ-ONLY (GET saja, tak ada tulis ke Accurate)\n");

// Kandidat path. Konvensi NYATA di accurateSync.ts adalah
// `/accurate/api/<entity>/list.do` — BUKAN `/api/<entity>` seperti yang tertulis
// di skema OpenAPI. Bentuk REST tetap ikut dicoba sebagai kontrol: kalau yang
// `.do` gagal dan REST juga gagal dengan kode BEDA, itu informasi; kalau
// dua-duanya 404, kemungkinan besar memang salah path, bukan soal izin.
const TARGETS = [
  { label: "warehouse (list.do)", path: "/accurate/api/warehouse/list.do", paginate: true, key: true },
  { label: "warehouse (REST, kontrol)", path: "/api/warehouse", raw: true },
  { label: "stock-mutation-history-view", path: "/accurate/api/stock-mutation-history-view/list.do", paginate: true },
  { label: "stock-opname-order", path: "/accurate/api/stock-opname-order/list.do", paginate: true },
  { label: "stock-opname-result", path: "/accurate/api/stock-opname-result/list.do", paginate: true },
  { label: "item-transfer", path: "/accurate/api/item-transfer/list.do", paginate: true },
];

const hasil = [];
for (const t of TARGETS) {
  const r = t.raw ? await accGet(creds, t.path, null) : await fetchAllPages(creds, t.path);
  const { httpStatus, body } = r;
  const s = body?.s;
  // Accurate membalas HTTP 200 dengan s=false untuk kegagalan logis (termasuk
  // "tak berizin") — jadi HTTP status saja TIDAK cukup untuk menyimpulkan.
  const ok = httpStatus === 200 && s === true;
  const pesan = body?.d ?? body?.m ?? body?._nonJson ?? body?._err ?? null;

  console.log(`── ${t.label}`);
  console.log(`   ${t.path}`);
  console.log(`   HTTP ${httpStatus} · s=${JSON.stringify(s)} · ${ok ? "✅ BISA DIPAKAI" : "❌ gagal"}`);

  if (ok && r.rows) {
    // Penyebut dicetak berdampingan dengan yang terkumpul supaya pemotongan
    // diam-diam mustahil lolos dari mata pembaca.
    const denom = r.rowCount == null ? "sp.rowCount tak dilaporkan endpoint" : `sp.rowCount=${r.rowCount}`;
    console.log(`   terkumpul ${r.rows.length} baris dari ${denom} · ${r.pages} halaman`);
    if (r.rowCount != null && r.rows.length !== r.rowCount) {
      console.log(`   ⚠️  TIDAK COCOK dengan rowCount — jangan pakai angka ini untuk desain sebelum ditelusuri.`);
    }
    if (r.capped) {
      console.log(`   ⚠️  BERHENTI di batas ${MAX_PAGES} halaman — daftar ini TERPOTONG, naikkan MAX_PAGES.`);
    }
    console.log(`   ${describe(r.rows)}`);
    const names = warehouseNames(r.rows);
    if (names) {
      console.log(`   nama gudang (${names.length}):`);
      for (const n of names) console.log(`     · ${n}`);
    }
  } else if (ok) {
    console.log(`   ${describe(body?.d)}`);
  } else if (pesan) {
    console.log(`   pesan: ${typeof pesan === "string" ? pesan.slice(0, 300) : JSON.stringify(pesan).slice(0, 300)}`);
  }
  console.log("");

  hasil.push({
    label: t.label,
    path: t.path,
    httpStatus,
    s: s ?? null,
    ok,
    baris: r.rows?.length ?? null,
    rowCount: r.rowCount ?? null,
    terpotong: !!r.capped,
    key: !!t.key,
  });
}

const kunci = hasil.find((h) => h.key);
console.log("═══ KESIMPULAN ═══");
if (kunci?.ok) {
  console.log("✅ /accurate/api/warehouse/list.do BISA diakses.");
  console.log("");
  console.log("   Hasil jalan pertama di prod (2026-09-04) — pakai sebagai pembanding:");
  console.log("     · 109 gudang total. 13 berawalan GUDANG, 96 sisanya gudang VIRTUAL milik");
  console.log("       customer (DINKES/PKM/LABKESDA).");
  console.log("     · Cocok dgn seed 082: SBY, JEMBER, KEDIRI, MADIUN, MADURA, JAKARTA.");
  console.log("       NTB kemungkinan = GUDANG MATARAM (nama beda).");
  console.log("       TAK ADA padanan: LAMONGAN, TUBAN, JOGJA, SOLO, NTT.");
  console.log("       Hanya di Accurate: SURABAYA 1, SURABAYA2, PUSAT NOT AVAILABLE,");
  console.log("       PUSAT QTN, SPAREPART KSO, TEMPORARY.");
  console.log("");
  console.log("   ⚠️  ALLOWLIST HARUS PAKAI ID EKSPLISIT — bukan heuristik:");
  console.log("     · `suspended` NOL dari 109 baris, termasuk yang jelas bukan gudang");
  console.log("       operasional → tak ada sinyal dari Accurate yang bisa dipercaya.");
  console.log("     · Prefix nama 'GUDANG' juga bocor (SPAREPART KSO, TEMPORARY, 2× PUSAT).");
  console.log("     Isi warehouse.accurate_warehouse_id manual sekali; kolom itu jadi");
  console.log("     SATU-SATUNYA gerbang yang menahan 96 gudang customer masuk layar AM.");
  console.log("");
  console.log("   ⚠️  Endpoint stok-per-gudang BELUM ketemu — warehouse/list.do cuma daftar");
  console.log("     gudang, bukan saldo per SKU. stock-mutation-history-view membalas 404");
  console.log("     'URL API tidak tepat' (nama endpoint salah, BUKAN soal izin).");
  console.log("     Kandidat berikutnya, urut dari yang paling murah panggilannya:");
  console.log("       1. item/list.do + filter/field gudang (bulk; kalau jalan, cron 5 menit selamat)");
  console.log("       2. warehouse/detail.do?id=<id>  (13 panggilan saja)");
  console.log("       3. item/detail.do per SKU — ~5.800 panggilan/siklus, TAK layak 5 menit.");
  console.log("          Kalau cuma ini yang jalan, F37 real-time tak layak → re-scope #836");
  console.log("          jadi sinkron harian, jangan ditutup.");
} else {
  console.log("❌ /accurate/api/warehouse/list.do TIDAK bisa diakses.");
  console.log("   JANGAN langsung simpulkan 'modul multi-gudang mati'. Bedakan dulu:");
  console.log("     · HTTP 404 di SEMUA path        → kemungkinan besar salah path/konvensi, bukan izin.");
  console.log("     · HTTP 200 + s=false + pesan izin → user API memang tak berizin (minta ke admin Accurate).");
  console.log("     · HTTP 401/403                  → token/secret salah atau kedaluwarsa.");
  console.log("   Tempelkan keluaran lengkap skrip ini ke issue #836 sebagai bukti konkret,");
  console.log("   lalu update F37 §4 dengan tanggal + siapa yang mengecek.");
}

if (RAW_JSON) {
  console.log("\n─── ringkasan JSON ───");
  console.log(JSON.stringify(hasil, null, 2));
}
