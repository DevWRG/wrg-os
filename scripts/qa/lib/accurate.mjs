// Helper bersama untuk probe Accurate READ-ONLY di scripts/qa/.
//
// Diekstrak saat probe kedua (stok per gudang) lahir: menyalin ulang
// loadCreds/accGet ke skrip kedua berarti dua salinan aturan auth yang harus
// ikut berubah setiap kali `accurateSync.ts` berubah — persis cara dua sumber
// kebenaran mulai menyimpang diam-diam.
//
// Semua di sini SENGAJA meniru apps/api/src/repo/accurateSync.ts, supaya
// "jalan di probe" berarti "jalan juga di puller nanti". Kalau accurateSync.ts
// berubah (host, skema tanda tangan, header), file ini ikut diperbarui.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

export const PAGE_SIZE = 100;
export const MAX_PAGES = 50; // 5.000 baris; kalau kena, WAJIB dicetak eksplisit

// Urutan sumber kredensial identik loadCreds() di accurateSync.ts.
// Token/secret tak pernah dikembalikan untuk dicetak — pemanggil hanya
// menampilkan `from`.
export function loadCreds() {
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
export function wibTimestamp() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export async function accGet(creds, path, qs) {
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
      // cuplikannya, jangan buang: itu justru pembeda "salah path" vs
      // "tak berizin". Terbukti penting: /api/warehouse (bentuk REST) membalas
      // HTTP 200 berisi HALAMAN WEB, bukan 404.
      body = { _nonJson: text.slice(0, 200) };
    }
    return { httpStatus: res.status, body };
  } catch (e) {
    return { httpStatus: 0, body: { _err: String(e?.message ?? e) } };
  }
}

// Accurate membalas HTTP 200 dengan s=false untuk kegagalan LOGIS (termasuk
// penolakan izin) — jadi status HTTP saja tak pernah cukup untuk menyimpulkan.
export const isOk = (r) => r.httpStatus === 200 && r.body?.s === true;

// Pesan kegagalan bisa nongol di beberapa tempat berbeda tergantung jenis error.
export function failMessage(body) {
  const p = body?.d ?? body?.m ?? body?._nonJson ?? body?._err ?? null;
  if (p == null) return null;
  return typeof p === "string" ? p.slice(0, 300) : JSON.stringify(p).slice(0, 300);
}

// Paginasi PENUH + penyebut eksplisit.
//
// Kenapa ada: versi pertama probe menarik SATU halaman pageSize=100 lalu
// mencetak panjangnya. Untuk daftar gudang hasilnya "100" — identik dengan
// pageSize dan kebetulan mendekati total (109), jadi terbaca seperti jawaban
// lengkap padahal memotong 9 baris tanpa gejala.
//
// `sp.rowCount` dipakai sebagai KLAIM yang harus dipenuhi. Kalau yang terkumpul
// tak sama dengan rowCount, itu DILAPORKAN, bukan dibulatkan diam-diam.
export async function fetchAllPages(creds, path, extraQs) {
  const rows = [];
  let rowCount = null;
  let page = 1;
  let last = null;
  let capped = false;

  for (; page <= MAX_PAGES; page++) {
    const qs = [`sp.page=${page}`, `sp.pageSize=${PAGE_SIZE}`, extraQs].filter(Boolean).join("&");
    const res = await accGet(creds, path, qs);
    last = res;
    if (!isOk(res)) return { ...res, rows: null, rowCount: null, pages: page };

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

// Ambil HANYA penyebutnya (1 panggilan, pageSize=1). Dipakai untuk menghitung
// ongkos panggilan sebuah rencana sebelum rencananya dipilih — mis. "kalau
// per-SKU, berapa panggilan per siklus?".
export async function fetchRowCount(creds, path, extraQs) {
  const qs = ["sp.page=1", "sp.pageSize=1", extraQs].filter(Boolean).join("&");
  const res = await accGet(creds, path, qs);
  if (!isOk(res)) return { ok: false, rowCount: null, res };
  const rc = Number(res.body?.sp?.rowCount);
  return { ok: true, rowCount: Number.isFinite(rc) ? rc : null, res };
}

// Ringkas bentuk `d` jadi kunci + jumlah, bukan dump isi — cukup untuk
// mendesain syncer tanpa menumpahkan seluruh katalog ke terminal.
export function describe(d) {
  if (d == null) return "d = null/absen";
  if (Array.isArray(d)) {
    if (d.length === 0) return "d = array KOSONG (0 baris)";
    const keys = Object.keys(d[0] ?? {});
    return `d = array ${d.length} baris · kunci baris-1: ${keys.join(", ") || "(objek kosong)"}`;
  }
  if (typeof d === "object") return `d = objek · kunci: ${Object.keys(d).join(", ")}`;
  return `d = ${typeof d}: ${String(d).slice(0, 80)}`;
}

// Cari kunci yang BAUNYA seperti breakdown per gudang, di kedalaman berapa pun.
// Dipakai probe stok: kita belum tahu nama fieldnya, jadi jangan menebak satu
// nama — telusuri dan laporkan semua jalur yang mencurigakan.
//
// ⚠️ PELAJARAN 2026-09-05 — kecocokan NAMA KUNCI saja tidak cukup.
// Versi pertama fungsi ini menganggap setiap kunci yang memuat "warehouse"
// sebagai jejak. Akibatnya `warehouse/detail.do` — yang isinya metadata gudang
// (alamat, kota, PIC) dan NOL saldo SKU — dinilai membawa breakdown, hanya
// karena punya dua flag boolean `scrapWarehouse: false` dan
// `defaultWarehouse: false`. Vonis probe lalu mengambil cabang "grup B jalan,
// 13 panggilan/siklus" dan MENYEMBUNYIKAN kesimpulan yang benar (hanya jalur
// per-SKU yang nyata). Heuristik yang dibuat untuk mencegah false negative
// justru melahirkan false positive yang lebih berbahaya, karena ia mengarahkan
// desain ke jalur yang tak ada isinya.
//
// Karena itu hasilnya kini DIPISAH:
//   rincian  — benar-benar berbentuk pecahan per gudang (array objek, atau
//              objek yang memuat angka). Ini saja yang boleh dihitung "menang".
//   metadata — kunci bernama gudang tapi nilainya skalar/kosong (flag, nama,
//              id). Tetap dicetak supaya terlihat, tapi TIDAK pernah dianggap
//              sebagai bukti adanya stok per gudang.
const RE_GUDANG = /(warehouse|gudang)/i;

// Pecahan per gudang selalu berbentuk koleksi berisi angka. Flag boolean,
// string nama, dan id tunggal tidak pernah memenuhi ini.
function bentukRincian(v) {
  if (Array.isArray(v)) return v.length > 0 && typeof v[0] === "object" && v[0] !== null;
  if (v && typeof v === "object") return Object.values(v).some((x) => typeof x === "number");
  return false;
}

export function findWarehouseKeys(obj, maxDepth = 4) {
  const rincian = [];
  const metadata = [];
  const walk = (node, path, depth) => {
    if (node == null || depth > maxDepth) return;
    if (Array.isArray(node)) {
      // Cukup periksa elemen pertama — bentuk elemen array di API ini seragam.
      if (node.length) walk(node[0], `${path}[0]`, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      const p = path ? `${path}.${k}` : k;
      if (RE_GUDANG.test(k)) {
        const bentuk = Array.isArray(v)
          ? `array(${v.length})${v.length && typeof v[0] === "object" ? ` kunci: ${Object.keys(v[0]).join(",")}` : ""}`
          : v && typeof v === "object"
            ? `objek kunci: ${Object.keys(v).join(",")}`
            : `${typeof v} = ${String(v).slice(0, 40)}`;
        (bentukRincian(v) ? rincian : metadata).push({ path: p, bentuk });
      }
      walk(v, p, depth + 1);
    }
  };
  walk(obj, "", 0);
  return { rincian, metadata };
}
