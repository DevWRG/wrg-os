#!/usr/bin/env node
// Probe v2 READ-ONLY: MANA endpoint Accurate yang memberi stok PER GUDANG?
//
// Probe v1 (probe-accurate-warehouse.mjs) sudah menjawab "apakah kita berizin":
// ya — warehouse/list.do jalan, 109 gudang. Tapi itu cuma DAFTAR GUDANG, bukan
// saldo per SKU. Endpoint stoknya sendiri belum ketemu:
// stock-mutation-history-view membalas 404 "URL API tidak tepat" — nama
// endpointnya yang salah, BUKAN soal izin.
//
// Skrip ini mencari endpoint itu, dan yang lebih penting: MENGHITUNG ONGKOSNYA.
// Kalau breakdown per gudang cuma tersedia lewat item/detail.do (satu panggilan
// per SKU), ongkosnya = jumlah item × 1 panggilan per siklus — dan itu
// menentukan apakah F37 real-time layak sama sekali, bukan sekadar mungkin.
//
// SEMUA GET. Tak ada request yang menulis ke Accurate.
//
// ── HASIL JALAN PERTAMA DI PROD (2026-09-05) ───────────────────────────────
// Penyebut: 109 gudang (sp.rowCount cocok), 5.893 item.
//   A bulk item/list.do  — GAGAL semua 5 varian. HTTP 200 s=true, tapi kunci
//                          baris tetap {id,no,name,quantity}: detailWarehouseData /
//                          warehouseData / detailWarehouse dan filter
//                          sp.warehouseId / filter.warehouseId DIABAIKAN diam-diam.
//   B warehouse/detail.do — metadata gudang (alamat, kota, PIC, flag). NOL saldo SKU.
//   C item/detail.do      — SATU-SATUNYA yang membawa pecahan sungguhan:
//                          detailWarehouseData = array(110) berisi warehouseName,
//                          balance, unit1Quantity…unit5Quantity. Satu panggilan
//                          memberi SEMUA gudang sekaligus → sapuan penuh
//                          = 5.893 panggilan, bukan 5.893 × 109.
//   D varian mutasi       — stock-mutation / warehouse-mutation /
//                          stock-mutation-history semuanya 404 "URL API tidak
//                          tepat". item-adjustment/list.do jalan tapi itu mutasi,
//                          bukan saldo.
//
// VONIS: hanya jalur per-SKU yang nyata → F37 real-time tak layak lewat sini.
// #836 di-RE-SCOPE ke sinkron harian/inkremental, BUKAN ditutup. Yang terbukti
// adalah "kandidat yang dicoba tidak membawanya" — bukan "Accurate tak punya".
//
// Baris pertama detailWarehouseData di prod adalah "DINKES KAB. BUTON UTARA",
// yaitu gudang virtual milik customer — penguat kenapa allowlist WAJIB id
// eksplisit, bukan prefix nama.
//
// Jalankan DI MESIN YANG PUNYA KREDENSIAL PROD (Mac mini):
//   node scripts/qa/probe-accurate-stok-gudang.mjs
//   node scripts/qa/probe-accurate-stok-gudang.mjs --json
//
// Ongkos jalan skrip ini sendiri sengaja kecil: ~15 panggilan, karena
// item/detail.do hanya dicoba untuk SATU SKU contoh.

import { loadCreds, accGet, fetchAllPages, fetchRowCount, isOk, failMessage, describe, findWarehouseKeys } from "./lib/accurate.mjs";

const RAW_JSON = process.argv.includes("--json");

const creds = loadCreds();
if (creds.err) {
  console.error(`✗ ${creds.err}`);
  console.error("  Jalankan skrip ini di mesin yang punya kredensial prod (Mac mini).");
  process.exit(2);
}

console.log(`host       : ${creds.host}`);
console.log(`kredensial : ${creds.from === "env" ? "env ACCURATE_ACCESS_TOKEN/SIGNATURE_SECRET" : creds.from}`);
console.log("mode       : READ-ONLY (GET saja)\n");

const jejak = [];
const catat = (o) => jejak.push(o);

// ── Langkah 0: bahan uji + penyebut ongkos ─────────────────────────────────
// Butuh satu id gudang & satu id item yang NYATA. Sekalian ambil rowCount item,
// karena angka itulah yang menentukan layak-tidaknya rencana per-SKU.
console.log("── Langkah 0: ambil id gudang & item contoh, plus jumlah item\n");

const gudang = await fetchAllPages(creds, "/accurate/api/warehouse/list.do");
if (!gudang.rows) {
  console.error("✗ warehouse/list.do gagal — jalankan probe v1 dulu untuk mendiagnosis.");
  console.error(`  ${failMessage(gudang.body) ?? ""}`);
  process.exit(1);
}
console.log(`   gudang   : ${gudang.rows.length} baris (sp.rowCount=${gudang.rowCount ?? "?"})`);
if (gudang.rowCount != null && gudang.rows.length !== gudang.rowCount) {
  console.log("   ⚠️  jumlah tak cocok dengan rowCount — jangan pakai untuk desain sebelum ditelusuri.");
}

// Ambil gudang yang PALING MUNGKIN operasional sebagai contoh, bukan baris
// pertama apa adanya — 96 dari 109 adalah gudang virtual milik customer, dan
// contoh dari situ akan memberi gambaran yang menyesatkan.
const contohGudang =
  gudang.rows.find((w) => /^GUDANG\s+SBY/i.test(String(w?.name ?? ""))) ??
  gudang.rows.find((w) => /^GUDANG/i.test(String(w?.name ?? ""))) ??
  gudang.rows[0];
console.log(`   contoh gd: id=${contohGudang?.id} name=${JSON.stringify(contohGudang?.name)}`);

const itemCount = await fetchRowCount(creds, "/accurate/api/item/list.do");
console.log(`   item     : sp.rowCount=${itemCount.rowCount ?? "tak dilaporkan"}`);

const itemSample = await accGet(creds, "/accurate/api/item/list.do", "sp.page=1&sp.pageSize=1&fields=id,no,name,quantity,availableToSell");
const contohItem = isOk(itemSample) && Array.isArray(itemSample.body.d) ? itemSample.body.d[0] : null;
console.log(`   contoh it: id=${contohItem?.id} no=${JSON.stringify(contohItem?.no)}\n`);

catat({ langkah: "bahan", gudang: gudang.rows.length, rowCountGudang: gudang.rowCount, rowCountItem: itemCount.rowCount, contohGudangId: contohGudang?.id ?? null, contohItemId: contohItem?.id ?? null });

// ── Kandidat, URUT DARI YANG PALING MURAH ──────────────────────────────────
// Urutan ini bukan selera: kalau kandidat bulk berhasil, cron 5 menit selamat
// dan kandidat mahal tak perlu dipertimbangkan sama sekali.
const KANDIDAT = [
  {
    grup: "A. BULK — item/list.do dgn field/filter gudang (1 panggilan per 100 SKU)",
    catatanOngkos: (n) => `≈ ${Math.ceil((n ?? 0) / 100)} panggilan/siklus`,
    uji: [
      { label: "fields=…,detailWarehouseData", path: "/accurate/api/item/list.do", qs: "sp.page=1&sp.pageSize=2&fields=id,no,name,quantity,detailWarehouseData" },
      { label: "fields=…,warehouseData", path: "/accurate/api/item/list.do", qs: "sp.page=1&sp.pageSize=2&fields=id,no,name,quantity,warehouseData" },
      { label: "fields=…,detailWarehouse", path: "/accurate/api/item/list.do", qs: "sp.page=1&sp.pageSize=2&fields=id,no,name,quantity,detailWarehouse" },
      { label: "filter sp.warehouseId", path: "/accurate/api/item/list.do", qs: `sp.page=1&sp.pageSize=2&fields=id,no,name,quantity&sp.warehouseId=${contohGudang?.id ?? ""}` },
      { label: "filter filter.warehouseId", path: "/accurate/api/item/list.do", qs: `sp.page=1&sp.pageSize=2&fields=id,no,name,quantity&filter.warehouseId.val=${contohGudang?.id ?? ""}` },
    ],
  },
  {
    grup: "B. SEDANG — warehouse/detail.do (1 panggilan per gudang; 13 gudang operasional)",
    catatanOngkos: () => "≈ 13 panggilan/siklus",
    uji: [{ label: "warehouse/detail.do", path: "/accurate/api/warehouse/detail.do", qs: `id=${contohGudang?.id ?? ""}` }],
  },
  {
    grup: "C. MAHAL — per SKU (1 panggilan untuk tiap item)",
    catatanOngkos: (n) => `≈ ${n ?? "?"} panggilan/siklus — lihat vonis di bawah`,
    uji: [
      { label: "item/detail.do", path: "/accurate/api/item/detail.do", qs: `id=${contohItem?.id ?? ""}` },
      // Dari probe #1191 — namanya paling menjanjikan di antara semua kandidat
      // (harfiah "ambil stok"), dan belum pernah dicoba di v1/v2.
      { label: "item/get-stock.do", path: "/accurate/api/item/get-stock.do", qs: `id=${contohItem?.id ?? ""}` },
    ],
  },
  {
    grup: "D. Varian nama utk endpoint mutasi/opname yang 404 di v1",
    catatanOngkos: () => "tergantung bentuk; mutasi = turunan, bukan saldo",
    uji: [
      { label: "stock-mutation/list.do", path: "/accurate/api/stock-mutation/list.do", qs: "sp.page=1&sp.pageSize=1" },
      { label: "item-adjustment/list.do", path: "/accurate/api/item-adjustment/list.do", qs: "sp.page=1&sp.pageSize=1" },
      { label: "warehouse-mutation/list.do", path: "/accurate/api/warehouse-mutation/list.do", qs: "sp.page=1&sp.pageSize=1" },
      { label: "stock-mutation-history/list.do", path: "/accurate/api/stock-mutation-history/list.do", qs: "sp.page=1&sp.pageSize=1" },
      // Dua di bawah juga dari #1191: varian tanpa sufiks `-order`/`-result`,
      // dan `stock-adjustment` yang berbeda dari `item-adjustment` di atas.
      { label: "stock-opname/list.do", path: "/accurate/api/stock-opname/list.do", qs: "sp.page=1&sp.pageSize=1" },
      { label: "stock-adjustment/list.do", path: "/accurate/api/stock-adjustment/list.do", qs: "sp.page=1&sp.pageSize=1" },
    ],
  },
];

const menang = []; // kandidat yang BENAR-BENAR membawa breakdown per gudang

for (const grup of KANDIDAT) {
  console.log(`── ${grup.grup}`);
  console.log(`   ongkos kalau dipakai: ${grup.catatanOngkos(itemCount.rowCount)}\n`);

  for (const u of grup.uji) {
    const r = await accGet(creds, u.path, u.qs);
    const ok = isOk(r);
    console.log(`   · ${u.label}`);
    console.log(`     HTTP ${r.httpStatus} · s=${JSON.stringify(r.body?.s)} · ${ok ? "jalan" : "gagal"}`);

    if (!ok) {
      const m = failMessage(r.body);
      if (m) console.log(`     pesan: ${m}`);
      catat({ grup: grup.grup, label: u.label, path: u.path, httpStatus: r.httpStatus, ok: false, adaGudang: false });
      console.log("");
      continue;
    }

    // "Jalan" TIDAK sama dengan "berguna". Endpoint bisa balas 200 sambil
    // mengabaikan field/filter yang tak dikenalnya — itulah jebakan utama
    // langkah ini. Yang menentukan adalah: apakah responsnya benar-benar
    // memuat pecahan per gudang?
    const { rincian, metadata } = findWarehouseKeys(r.body?.d);
    console.log(`     ${describe(r.body?.d)}`);

    // HANYA `rincian` yang dihitung. `metadata` tetap dicetak — berguna untuk
    // memahami bentuk response — tapi tak pernah jadi bukti adanya stok.
    if (rincian.length) {
      console.log(`     ✅ ADA pecahan per gudang:`);
      for (const h of rincian.slice(0, 8)) console.log(`        ${h.path} → ${h.bentuk}`);
      menang.push({ grup: grup.grup, label: u.label, path: u.path, hits: rincian.slice(0, 8) });
    } else {
      console.log(`     ⚠️  jalan, TAPI nol pecahan per gudang — field/filter kemungkinan diabaikan diam-diam.`);
    }
    if (metadata.length) {
      console.log(`     ℹ️  kunci bernama gudang tapi BUKAN pecahan (diabaikan dalam vonis):`);
      for (const h of metadata.slice(0, 6)) console.log(`        ${h.path} → ${h.bentuk}`);
    }
    catat({
      grup: grup.grup,
      label: u.label,
      path: u.path,
      httpStatus: r.httpStatus,
      ok: true,
      adaPecahan: rincian.length > 0,
      rincian: rincian.slice(0, 8),
      metadata: metadata.slice(0, 6),
    });
    console.log("");
  }
}

// ── Vonis ──────────────────────────────────────────────────────────────────
console.log("═══ VONIS ═══\n");

if (menang.length === 0) {
  console.log("❌ NOL kandidat membawa breakdown per gudang.");
  console.log("   Jangan simpulkan \"tak mungkin\" dari sini — yang terbukti baru:");
  console.log("   kandidat YANG DICOBA tidak membawanya. Langkah lanjut:");
  console.log("     · minta dokumentasi endpoint stok ke pihak Accurate/partner,");
  console.log("       khususnya nama yang benar untuk stock-mutation-history-view;");
  console.log("     · sementara itu F37 tetap jalur CSV import — itu BUKAN kegagalan,");
  console.log("       kolom `source` memang dirancang untuk hidup berdampingan.");
  console.log("   Tempelkan keluaran ini ke #836 sebagai bukti konkret + tanggal.");
} else {
  const bulk = menang.find((m) => m.grup.startsWith("A"));
  const sedang = menang.find((m) => m.grup.startsWith("B"));
  console.log(`✅ ${menang.length} kandidat membawa jejak gudang:`);
  for (const m of menang) console.log(`   · ${m.label}  (${m.grup.split(" — ")[0]})`);
  console.log("");

  if (bulk) {
    console.log("   → PAKAI YANG BULK (grup A). Cron accurate-stock-sync 5 menit tetap layak.");
  } else if (sedang) {
    console.log("   → Grup A gagal, grup B jalan: ±13 panggilan/siklus. Masih layak 5 menit,");
    console.log("     tapi verifikasi dulu bahwa detail gudang memuat SEMUA SKU, bukan halaman pertama.");
  } else {
    const n = itemCount.rowCount;
    console.log(`   ⚠️  HANYA jalur per-SKU yang jalan: ±${n ?? "?"} panggilan per siklus.`);
    console.log("     Untuk cron 5 menit itu tak masuk akal (dan syncDocItems di accurateSync.ts");
    console.log("     sudah membuktikan pola per-dokumen harus inkremental + berbatas).");
    console.log("     VONIS: F37 real-time TIDAK layak lewat jalur ini. Re-scope #836 jadi");
    console.log("     sinkron harian/inkremental — JANGAN ditutup sebagai 'tak mungkin'.");
  }
  console.log("");
  console.log("   Sebelum menulis puller, dua hal masih menunggu keputusan orang:");
  console.log("     (a) tiga gudang Surabaya di Accurate vs satu kode SBY di kita —");
  console.log("         PK item_stock_branch (item_id, warehouse_kode) memaksa DIJUMLAHKAN;");
  console.log("     (b) 5 cabang tanpa padanan (LAMONGAN, TUBAN, JOGJA, SOLO, NTT).");
  console.log("   Dan allowlist WAJIB id eksplisit di warehouse.accurate_warehouse_id:");
  console.log("   `suspended` nol untuk SEMUA 109 baris, prefix nama 'GUDANG' bocor.");
}

if (RAW_JSON) {
  console.log("\n─── jejak JSON ───");
  console.log(JSON.stringify(jejak, null, 2));
}
