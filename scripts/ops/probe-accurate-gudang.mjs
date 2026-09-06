#!/usr/bin/env node
// Probe READ-ONLY ke Accurate Online untuk menjawab #836: apakah puller stok
// per-gudang bisa dibangun, atau CSV manual harus dinyatakan permanen.
//
// KENAPA SKRIP, BUKAN LANGSUNG NULIS PULLER: migrasi 082 sengaja tidak menulis
// puller karena dua hal belum terverifikasi dan keduanya butuh kredensial prod:
//   (a) apakah langganan Accurate WRG mengaktifkan multi-gudang, dan 11 gudang
//       di tabel `warehouse` benar terdaftar di sana;
//   (b) apakah user API kita punya izin ke endpoint stok per-gudang.
// Menulis puller sebelum keduanya dijawab = menebak bentuk response. Skrip ini
// MELAPORKAN apa yang ada, tidak menyimpulkan bentuk yang tidak dilihatnya.
//
// Kandidat endpoint diambil dari catatan migrasi 082 (skema OpenAPI Accurate
// `account.accurate.id/open-api/json.do`, dokumennya terpotong sebelum bagian
// field) — jadi nama-nama di bawah adalah DUGAAN yang sedang diuji, bukan
// kontrak yang sudah diketahui. Endpoint yang tidak ada akan dilaporkan apa
// adanya, bukan dianggap kegagalan skrip.
//
// SEMUA request GET. Tidak ada tulis, tidak ada perubahan data di Accurate.
//
// Jalankan DI MAC MINI (kredensial cuma ada di sana):
//   node scripts/ops/probe-accurate-gudang.mjs
//   node scripts/ops/probe-accurate-gudang.mjs --json > /tmp/probe-gudang.json
//
// Kredensial dibaca sama persis dengan apps/api/src/repo/accurateSync.ts:
//   env ACCURATE_ACCESS_TOKEN + ACCURATE_SIGNATURE_SECRET (+ACCURATE_HOST), atau
//   file ACCURATE_CRED_FILE (default ~/.openclaw/credentials/accurate.json).
// Token/secret TIDAK PERNAH dicetak — output aman ditempel ke issue.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const JSON_MODE = process.argv.includes("--json");

function loadCreds() {
  const host = process.env.ACCURATE_HOST || "zeus.accurate.id";
  const envTok = process.env.ACCURATE_ACCESS_TOKEN;
  const envSec = process.env.ACCURATE_SIGNATURE_SECRET;
  if (envTok && envSec) return { token: envTok, secret: envSec, host, asal: "env" };
  const path = process.env.ACCURATE_CRED_FILE || `${homedir()}/.openclaw/credentials/accurate.json`;
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (j.access_token && j.signature_secret) {
      return { token: j.access_token, secret: j.signature_secret, host, asal: `file ${path}` };
    }
  } catch {
    /* file tak ada / tak valid */
  }
  return null;
}

function wibTimestamp() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// Mengembalikan hasil TERSTRUKTUR, tidak melempar: endpoint yang tak ada adalah
// jawaban yang sah dari probe ini, bukan error yang harus menghentikan sisanya.
async function accGet(creds, path, qs) {
  const ts = wibTimestamp();
  const sig = createHmac("sha256", creds.secret).update(ts).digest("hex");
  const url = `https://${creds.host}${path}${qs ? `?${qs}` : ""}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}`, "X-Api-Timestamp": ts, "X-Api-Signature": sig },
      signal: AbortSignal.timeout(30_000),
    });
    const teks = await res.text();
    let body = null;
    try {
      body = JSON.parse(teks);
    } catch {
      // HTML (halaman login/error) — potong, jangan banjiri output.
      return { path, http: res.status, ok: false, catatan: `bukan JSON (${teks.slice(0, 120).replace(/\s+/g, " ")}…)` };
    }
    return { path, http: res.status, ok: res.ok && body?.s !== false, body };
  } catch (e) {
    return { path, http: null, ok: false, catatan: `gagal konek: ${String(e?.message ?? e)}` };
  }
}

// Ringkas struktur tanpa membocorkan seluruh isi: kunci + contoh 1 baris.
export function ringkasList(body) {
  const d = body?.d;
  const rows = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : null;
  if (!rows) return { bentuk: "bukan list", kunciTeratas: Object.keys(body?.d ?? body ?? {}).slice(0, 25) };
  return {
    bentuk: "list",
    jumlah: rows.length,
    kunciBaris: rows.length ? Object.keys(rows[0]) : [],
  };
}

// Cari jejak "per gudang" di dalam objek apa pun, sedalam apa pun. Ini inti
// probe-nya: kalau breakdown gudang ternyata SUDAH ikut di detail item, puller
// tak perlu endpoint baru sama sekali.
const POLA_GUDANG = /(warehouse|gudang)/i;
export function jejakGudang(obj, prefix = "", hasil = [], depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== "object") return hasil;
  for (const [k, v] of Object.entries(obj)) {
    const jalur = prefix ? `${prefix}.${k}` : k;
    if (POLA_GUDANG.test(k)) {
      hasil.push({
        jalur,
        tipe: Array.isArray(v) ? `array[${v.length}]` : v === null ? "null" : typeof v,
        contoh: Array.isArray(v)
          ? v.length
            ? Object.keys(v[0] ?? {}).slice(0, 12)
            : []
          : typeof v === "object"
            ? Object.keys(v ?? {}).slice(0, 12)
            : v,
      });
    }
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === "object") jejakGudang(v[0], `${jalur}[0]`, hasil, depth + 1);
    } else if (typeof v === "object") {
      jejakGudang(v, jalur, hasil, depth + 1);
    }
  }
  return hasil;
}

const log = (...a) => {
  if (!JSON_MODE) console.log(...a);
};

async function main() {
  const creds = loadCreds();
  if (!creds) {
    console.error(
      "Kredensial Accurate tidak ditemukan.\n" +
        "Set ACCURATE_ACCESS_TOKEN + ACCURATE_SIGNATURE_SECRET, atau sediakan\n" +
        "~/.openclaw/credentials/accurate.json. Skrip ini HARUS dijalankan di Mac mini.",
    );
    process.exit(2);
  }
  log(`Host: ${creds.host} · kredensial dari ${creds.asal}\n`);

  const laporan = { host: creds.host, waktu: new Date().toISOString(), langkah: {} };

  // ── 1. Modul multi-gudang aktif? ──────────────────────────────────────────
  log("── 1. Daftar gudang (warehouse/list.do) ──");
  const wh = await accGet(creds, "/accurate/api/warehouse/list.do", "sp.page=1&sp.pageSize=100");
  laporan.langkah.warehouse = { http: wh.http, ok: wh.ok, catatan: wh.catatan ?? null };
  if (!wh.ok) {
    log(`  ✗ HTTP ${wh.http ?? "-"} — ${wh.catatan ?? JSON.stringify(wh.body?.d ?? wh.body).slice(0, 300)}`);
    log("  → Kalau ini 403/401: user API tidak punya izin. Kalau 404: modul multi-gudang tidak aktif.\n");
  } else {
    const r = ringkasList(wh.body);
    const rows = Array.isArray(wh.body?.d) ? wh.body.d : (wh.body?.d?.data ?? []);
    laporan.langkah.warehouse.jumlah = rows.length;
    laporan.langkah.warehouse.kunciBaris = r.kunciBaris;
    laporan.langkah.warehouse.daftar = rows.map((x) => ({
      id: x.id ?? null,
      name: x.name ?? null,
      // Nama field penanda "bukan gudang cabang" belum diketahui — dibawa apa
      // adanya kalau ada, supaya bisa dinilai manusia. Migrasi 082: gudang
      // VIRTUAL di customer TIDAK BOLEH ikut tampil.
      suspended: x.suspended ?? null,
      description: x.description ?? null,
    }));
    log(`  ✓ ${rows.length} gudang. Kunci baris: ${r.kunciBaris.join(", ")}`);
    for (const g of laporan.langkah.warehouse.daftar) {
      log(`     [${g.id}] ${g.name}${g.suspended ? " (suspended)" : ""}`);
    }
    log(
      "\n  → Bandingkan dengan allowlist kita:\n" +
        "     psql \"$DATABASE_URL\" -c 'SELECT kode, nama, jenis FROM warehouse ORDER BY kode;'\n" +
        "     Gudang di Accurate yang TIDAK ada di tabel itu jangan otomatis dimasukkan —\n" +
        "     migrasi 082: gudang virtual di customer harus tetap tak tampil.\n",
    );
  }

  // ── 2. Breakdown gudang mungkin sudah ada di detail item ──────────────────
  log("── 2. Apakah stok per-gudang sudah ikut di item/detail.do? ──");
  const itemList = await accGet(
    creds,
    "/accurate/api/item/list.do",
    "sp.page=1&sp.pageSize=1&fields=id,no,name",
  );
  const contohItem = Array.isArray(itemList.body?.d) ? itemList.body.d[0] : (itemList.body?.d?.data ?? [])[0];
  if (!contohItem?.id) {
    log(`  ✗ tidak dapat contoh item (HTTP ${itemList.http ?? "-"}) — langkah ini dilewati.\n`);
    laporan.langkah.itemDetail = { ok: false, catatan: "tidak dapat contoh item" };
  } else {
    const det = await accGet(creds, "/accurate/api/item/detail.do", `id=${contohItem.id}`);
    laporan.langkah.itemDetail = { http: det.http, ok: det.ok, itemId: contohItem.id, itemNo: contohItem.no ?? null };
    if (!det.ok) {
      log(`  ✗ HTTP ${det.http ?? "-"} — ${det.catatan ?? "gagal"}\n`);
    } else {
      const jejak = jejakGudang(det.body?.d ?? {});
      laporan.langkah.itemDetail.jejakGudang = jejak;
      laporan.langkah.itemDetail.kunciTeratas = Object.keys(det.body?.d ?? {});
      log(`  item contoh: [${contohItem.id}] ${contohItem.no ?? "-"} ${contohItem.name ?? ""}`);
      if (jejak.length === 0) {
        log("  ✗ TIDAK ada field bernama *warehouse*/*gudang* di detail item.");
        log("    → breakdown per gudang tidak bisa didapat dari endpoint yang sudah dipakai.\n");
      } else {
        log(`  ✓ ${jejak.length} field bernuansa gudang ditemukan:`);
        for (const j of jejak) log(`     ${j.jalur} : ${j.tipe} → ${JSON.stringify(j.contoh)}`);
        log("    → kalau salah satunya berisi qty per gudang, puller TIDAK butuh endpoint baru:");
        log("      cukup tambah `fields=` di syncItems() dan tulis ke item_stock_branch.\n");
      }
    }
  }

  // ── 3. Kandidat endpoint stok per-gudang ──────────────────────────────────
  // Nama-nama ini DUGAAN dari catatan migrasi 082. Yang 404 bukan berarti fitur
  // tak ada — bisa jadi namanya lain. Yang 403 = ada tapi tak diizinkan; itu
  // jawaban yang berbeda dan penting dibedakan.
  log("── 3. Kandidat endpoint stok/mutasi per-gudang ──");
  const kandidat = [
    ["/accurate/api/stock-mutation-history-view/list.do", "sp.page=1&sp.pageSize=1"],
    ["/accurate/api/item-transfer/list.do", "sp.page=1&sp.pageSize=1"],
    ["/accurate/api/stock-opname/list.do", "sp.page=1&sp.pageSize=1"],
    ["/accurate/api/stock-adjustment/list.do", "sp.page=1&sp.pageSize=1"],
    ["/accurate/api/item/get-stock.do", `id=${contohItem?.id ?? 1}`],
    ["/accurate/api/warehouse/detail.do", `id=${laporan.langkah.warehouse?.daftar?.[0]?.id ?? 1}`],
  ];
  laporan.langkah.kandidat = [];
  for (const [path, qs] of kandidat) {
    const r = await accGet(creds, path, qs);
    const ringkas = r.ok ? ringkasList(r.body) : null;
    const pesanApi = !r.ok && r.body ? JSON.stringify(r.body?.d ?? r.body).slice(0, 200) : null;
    laporan.langkah.kandidat.push({ path, http: r.http, ok: r.ok, ringkas, catatan: r.catatan ?? pesanApi });
    const tanda = r.ok ? "✓" : "✗";
    const ekor = r.ok
      ? `${ringkas.bentuk}${ringkas.jumlah != null ? ` (${ringkas.jumlah})` : ""} — kunci: ${(ringkas.kunciBaris ?? ringkas.kunciTeratas ?? []).join(", ")}`
      : (r.catatan ?? pesanApi ?? "");
    log(`  ${tanda} HTTP ${String(r.http ?? "-").padEnd(3)} ${path}`);
    if (ekor) log(`        ${ekor}`);
  }

  log("\n── Cara membaca hasil ini (jawaban untuk #836) ──");
  log("  · Langkah 1 gagal 401/403  → user API tak berizin. Minta tim yang pegang Accurate.");
  log("  · Langkah 1 gagal 404      → modul multi-gudang tidak aktif → tutup #836 sebagai");
  log("                               limitasi permanen, CSV manual jadi sumber resmi.");
  log("  · Langkah 2 menemukan qty per gudang → puller = tambah `fields=` di syncItems(),");
  log("                               tanpa endpoint baru. Jalur termurah.");
  log("  · Langkah 3 ada yang ✓     → puller baru mengikuti pola syncItems/syncSalesOrders,");
  log("                               tulis ke item_stock_branch dengan source='accurate'");
  log("                               (kolomnya sudah disiapkan migrasi 082).");
  log("  · Apa pun hasilnya: puller WAJIB memfilter `WHERE kode IN (SELECT kode FROM warehouse)`.");
  log("    Menarik seluruh daftar gudang apa adanya akan membocorkan stok gudang virtual");
  log("    milik customer ke layar AM (arahan Direktur 2026-07-31, dicatat di migrasi 082).");

  if (JSON_MODE) console.log(JSON.stringify(laporan, null, 2));
}

// Dijaga supaya `ringkasList`/`jejakGudang` bisa di-import & diuji tanpa
// menembak API Accurate (lihat scripts/ops/probe-accurate-gudang.test.mjs).
if (import.meta.main) {
  main().catch((e) => {
    console.error("probe gagal:", e?.message ?? e);
    process.exit(1);
  });
}
