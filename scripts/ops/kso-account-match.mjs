#!/usr/bin/env node
// Cocokkan nama customer di spreadsheet KSO (kso_asset.customer_raw) ke customer Accurate
// (accurate_customer), isi `kso_customer_map`, lalu sebar hasilnya ke kso_asset.account_id.
// Prasyarat: migrasi 097 + 098 sudah diterapkan dan kso_asset sudah terisi.
//
// KENAPA PENCOCOKAN INI TIDAK BOLEH OTOMATIS SEPENUHNYA:
// Nama di sheet bukan nama Accurate. Salah pasang satu faskes berarti revenue satu rumah
// sakit nyasar ke rumah sakit lain, dan kesalahan itu tidak akan kelihatan di angka total
// mana pun. Karena itu:
//   • exact / token_set   -> dipasang otomatis (deterministik, tidak ada tebakan)
//   • fuzzy               -> HANYA USULAN. account_id dibiarkan NULL sampai manusia
//                            mengonfirmasi, kecuali dijalankan dengan --terima-fuzzy.
// Baris yang `dikonfirmasi = true` tidak pernah ditimpa skrip ini.
//
// REVISI 2026-08-18 — diukur ke data nyata (235 nama sheet x 2.932 customer Accurate).
// Versi pertama hanya memasang 62 (26,4%). Tiga sebab, semuanya bisa diperbaiki:
//
// 1. Cabang `tanpa_kota` TIDAK PERNAH KENA — 0 dari 250. Asumsinya sheet menempelkan kota
//    ke belakang nama Accurate, jadi ekor kota dipotong lalu dicocokkan. Kenyataannya nama
//    Accurate SENDIRI yang memuat kota (2.896 dari 2.932 mengandung KOTA/KAB.); yang beda
//    urutan katanya, bukan ada-tidaknya kota:
//        sheet    'RS Widodo Ngawi'
//        Accurate 'WIDODO, RS KAB. NGAWI'
//    Memotong kota dari sisi sheet justru MENJAMIN meleset. Cabang itu diganti `token_set`.
//
// 2. Prefiks '[merged]' (penanda merge dari Accurate, ikut tersalin ke sheet) menghalangi
//    6 kecocokan yang sebenarnya identik persis. Sekarang dibuang saat normalisasi.
//
// 3. 15 dari 250 "customer" bukan customer, melainkan baris pemisah seksi di sheet
//    ('Station', 'SURABAYA 2', 'MADURA', 'JAKARTA', 'NTB'). Sekarang dilewati dan
//    dilaporkan terpisah, bukan dihitung sebagai gagal cocok.
//
// 4. Ringkasan dry-run dulu menghitung NAMA, padahal `kso_customer_map` berkunci slug —
//    jadi pratinjau menjanjikan 111 sementara --apply memasang 105. Semua penghitung
//    sekarang per customer_key, supaya pratinjau = hasil.
//
// Hasil setelah perbaikan, diukur end-to-end: 105 dari 227 customer_key (46,3%) terpasang
// deterministik, naik dari 62 (27,3%) — tanpa satu pun tebakan fuzzy diterima otomatis.
//
// PAKAI:
//   pnpm --filter @wrg/api build
//   node scripts/ops/kso-account-match.mjs                        # pratinjau
//   node scripts/ops/kso-account-match.mjs --apply                # pasang exact + token_set
//   node scripts/ops/kso-account-match.mjs --apply --terima-fuzzy 0.92
//        ^ pasang juga usulan fuzzy dengan skor >= 0.92 DAN unggul jelas dari runner-up.
//          Tetap ditandai dikonfirmasi=false supaya bisa disisir.

import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
const fzIdx = process.argv.indexOf("--terima-fuzzy");
const AMBANG_FUZZY = fzIdx > -1 ? Number(process.argv[fzIdx + 1]) : null;
const JARAK_MIN = 0.08; // selisih minimal ke kandidat kedua sebelum boleh dipasang otomatis

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set.");
  process.exit(1);
}
if (AMBANG_FUZZY !== null && !(AMBANG_FUZZY > 0 && AMBANG_FUZZY <= 1)) {
  console.error("--terima-fuzzy butuh angka 0..1, mis. 0.92");
  process.exit(1);
}

// Penanda merge Accurate yang ikut tersalin ke sheet. Dibuang SEBELUM normalisasi apa pun,
// supaya '[merged] WIDODO, RS KAB. NGAWI' bisa exact ke 'WIDODO, RS KAB. NGAWI'.
const tanpaPenanda = (s) => String(s ?? "").replace(/^\s*\[merged\]\s*/i, "");

const slug = (s) => tanpaPenanda(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const kata = (s) =>
  tanpaPenanda(s).toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 1);

// Kata jenis-faskes & administratif. Dibuang saat membentuk himpunan token supaya
// 'RS Widodo Ngawi' dan 'WIDODO, RS KAB. NGAWI' menghasilkan himpunan yang sama.
const STOPWORD = new Set([
  "KAB", "KABUPATEN", "KOTA", "RS", "RSU", "RSUD", "RSIA", "RSK", "RSB",
  "KLINIK", "LAB", "LABORATORIUM", "PT", "CV", "UPT", "PUSKESMAS",
  "UMUM", "DAERAH", // 'RS UMUM DAERAH' vs 'RSUD'
]);

// DAFTAR INI SENGAJA PENDEK. Percobaan memperluasnya ke PKM/RSI/RSUP/BALAI/PENGOBATAN
// diuji dan DITOLAK: hasilnya net nol (105 -> 105) tapi dua kecocokan "baru"-nya salah,
// karena justru kata jenis faskes itulah pembedanya —
//   'PKM Gondang Legi Malang' jadi cocok ke 'GONDANG LEGI, RSI KAB. MALANG'
//   padahal yang benar 'GONDANGLEGI, PKM KAB. MALANG' (dua entitas berbeda),
//   dan 'Klinik Aulia Jombang' (ambigu AULIA vs AULIA II) jadi terpasang otomatis.
// Sekaligus 5 kecocokan benar hilang karena tokennya tinggal < 2. Jangan diperluas
// tanpa mengukur ulang kedua arahnya.

// Singkatan yang harus dibentangkan supaya sebanding. Hanya yang benar-benar setara.
const EKSPANSI = new Map([
  ["DINKES", ["DINAS", "KESEHATAN"]],
]);

// Himpunan token bermakna — urutan kata diabaikan, jenis faskes diabaikan.
const himpunan = (s) => {
  const out = new Set();
  for (const w of kata(s)) {
    for (const x of EKSPANSI.get(w) ?? [w]) if (!STOPWORD.has(x)) out.add(x);
  }
  return out;
};

const kunciHimpunan = (h) => [...h].sort().join("|");

// Baris pemisah seksi di sheet: nama stasiun/area yang ikut terbaca sebagai "customer".
// Bukan faskes, jadi tidak boleh dihitung sebagai gagal cocok.
const STASIUN = new Set([
  "SURABAYA", "KEDIRI", "MALANG", "MADURA", "MADIUN", "JEMBER", "PRAMED",
  "JAKARTA", "NTB", "BALI", "SEMARANG", "SOLO", "YOGYA", "YOGYAKARTA",
  "BANDUNG", "STATION", "JATIM", "JATENG",
]);
const barisSeksi = (s) => {
  const u = slug(s).replace(/[0-9]+$/, "");
  return u.length < 4 || STASIUN.has(u);
};

// Dice pada bigram karakter: tahan terhadap singkatan & urutan kata yang bertukar,
// yang dua-duanya lumrah di nama faskes ("RSIA KIRANA" vs "KIRANA, RSIA").
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const big = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ma = big(a), mb = big(b);
  let sama = 0;
  for (const [g, n] of ma) sama += Math.min(n, mb.get(g) ?? 0);
  return (2 * sama) / (a.length - 1 + b.length - 1);
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let irisan = 0;
  for (const w of sa) if (sb.has(w)) irisan++;
  return irisan / (sa.size + sb.size - irisan);
}

const skor = (aSlug, aKata, bSlug, bKata) =>
  0.6 * dice(aSlug, bSlug) + 0.4 * jaccard(aKata, bKata);

const sql = db();

try {
  const [{ ada }] = await sql`
    SELECT count(*)::int AS ada FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kso_customer_map'`;
  if (!ada) {
    console.error("Tabel kso_customer_map belum ada. Terapkan 098_kso_revenue.sql dulu.");
    process.exit(1);
  }

  const pelanggan = await sql`
    SELECT id, name, no FROM accurate_customer WHERE COALESCE(NULLIF(name,''), '') <> ''`;
  if (!pelanggan.length) {
    console.error(
      "accurate_customer kosong. Jalankan sync Accurate dulu — tanpa itu semua nama akan\n" +
      "tercatat 'tidak_ada' dan menyesatkan.");
    process.exit(1);
  }
  const acc = pelanggan.map((c) => ({
    id: Number(c.id), name: String(c.name),
    slug: slug(c.name), kata: kata(c.name), set: himpunan(c.name),
  }));
  const byslug = new Map();
  for (const c of acc) if (!byslug.has(c.slug)) byslug.set(c.slug, c);

  // Indeks himpunan-token. Nilainya ARRAY, bukan satu customer: kalau dua customer
  // Accurate menghasilkan himpunan yang sama, itu ambigu dan TIDAK boleh dipasang
  // otomatis — justru kasus paling berbahaya (dua faskes semarga di kota yang sama).
  const byset = new Map();
  for (const c of acc) {
    if (c.set.size < 2) continue; // pagar: 'MALANG' jangan sampai cocok ke 'RSUD KOTA MALANG'
    const k = kunciHimpunan(c.set);
    if (!byset.has(k)) byset.set(k, []);
    byset.get(k).push(c);
  }

  // Satu baris per nama customer unik di kso_asset (bukan per aset).
  const sumber = await sql`
    SELECT customer_raw,
           min(kota) AS kota,
           count(*)::int AS jumlah_alat
    FROM kso_asset
    GROUP BY customer_raw
    ORDER BY customer_raw`;

  const terkunci = new Set(
    (await sql`SELECT customer_key FROM kso_customer_map WHERE dikonfirmasi = true`)
      .map((r) => r.customer_key));

  const hasil = [];
  const seksi = [];
  for (const s of sumber) {
    const raw = String(s.customer_raw);
    const key = slug(raw);
    if (terkunci.has(key)) continue; // sudah ditinjau manusia — jangan diusik
    if (barisSeksi(raw)) { seksi.push(raw); continue; } // pemisah seksi sheet, bukan faskes

    let baris;
    if (byslug.has(key)) {
      const c = byslug.get(key);
      baris = { key, raw, jumlah_alat: s.jumlah_alat, account_id: c.id, metode: "exact",
                skor: 1, kandidat: [{ id: c.id, name: c.name, skor: 1 }] };
    } else if (
      himpunan(raw).size >= 2 && (byset.get(kunciHimpunan(himpunan(raw))) ?? []).length === 1
    ) {
      // Himpunan token bermakna sama persis, dan hanya SATU customer Accurate yang
      // menghasilkannya. Deterministik: tidak ada skor, tidak ada tebakan — cuma urutan
      // kata & kata jenis faskes yang diabaikan.
      const c = byset.get(kunciHimpunan(himpunan(raw)))[0];
      baris = { key, raw, jumlah_alat: s.jumlah_alat, account_id: c.id, metode: "token_set",
                skor: 1, kandidat: [{ id: c.id, name: c.name, skor: 1 }] };
    } else {
      const kt = kata(raw);
      const nilai = acc.map((c) => ({
        id: c.id, name: c.name, skor: skor(key, kt, c.slug, c.kata),
      })).sort((a, b) => b.skor - a.skor).slice(0, 3);

      const top = nilai[0];
      const jarak = top ? top.skor - (nilai[1]?.skor ?? 0) : 0;
      const layakOtomatis =
        AMBANG_FUZZY !== null && top && top.skor >= AMBANG_FUZZY && jarak >= JARAK_MIN;
      baris = {
        key, raw, jumlah_alat: s.jumlah_alat,
        account_id: layakOtomatis ? top.id : null,
        metode: top && top.skor >= 0.5 ? "fuzzy" : "tidak_ada",
        skor: top ? Number(top.skor.toFixed(4)) : null,
        kandidat: nilai.map((n) => ({ id: n.id, name: n.name, skor: Number(n.skor.toFixed(4)) })),
        jarak: Number(jarak.toFixed(4)),
      };
    }
    hasil.push(baris);
  }

  const per = (m) => hasil.filter((h) => h.metode === m);
  const terpasang = new Set(hasil.filter((h) => h.account_id !== null).map((h) => h.key));

  // Dihitung per customer_key (slug), BUKAN per nama. `kso_customer_map` berkunci slug,
  // jadi nama yang cuma beda spasi ganda / tanda baca / prefiks '[merged]' runtuh jadi satu
  // baris saat ditulis. Menghitung nama membuat pratinjau menjanjikan lebih banyak daripada
  // yang benar-benar terpasang (111 vs 105 pada data nyata) — pratinjau yang tidak sama
  // dengan hasil lebih berbahaya daripada tidak ada pratinjau.
  const kunciUnik = (m) => new Set(hasil.filter((h) => h.metode === m).map((h) => h.key)).size;
  const kunciDeterministik = new Set(
    hasil.filter((h) => h.metode === "exact" || h.metode === "token_set").map((h) => h.key));
  const deterministik = kunciDeterministik.size;
  const kunciSemua = new Set(hasil.map((h) => h.key)).size;

  console.log("=== Hasil pencocokan ===");
  console.log(`  nama customer unik di kso_asset : ${sumber.length}`);
  console.log(`  baris pemisah seksi (dilewati)  : ${seksi.length}`);
  console.log(`  nama customer dinilai           : ${hasil.length}` +
    (kunciSemua !== hasil.length
      ? `  (-> ${kunciSemua} customer_key; ${hasil.length - kunciSemua} nama kembar runtuh)`
      : ""));
  console.log(`  sudah dikonfirmasi (dilewati)   : ${terkunci.size}`);
  console.log(`  customer Accurate tersedia      : ${acc.length}`);
  console.log(`  exact                           : ${kunciUnik("exact")}`);
  console.log(`  token_set                       : ${kunciUnik("token_set")}`);
  console.log(`  -> deterministik (dipasang)     : ${deterministik}` +
    (kunciSemua ? ` (${(100 * deterministik / kunciSemua).toFixed(1)}%)` : ""));
  console.log(`  fuzzy (usulan)                  : ${per("fuzzy").length}` +
    (AMBANG_FUZZY !== null
      ? `  -> dipasang: ${per("fuzzy").filter((h) => h.account_id).length} (ambang ${AMBANG_FUZZY})`
      : "  -> tidak dipasang (pakai --terima-fuzzy <skor>)"));
  console.log(`  tidak ada padanan               : ${per("tidak_ada").length}`);
  console.log(`  TOTAL akan punya account_id     : ${terpasang.size}`);

  const contoh = per("fuzzy").sort((a, b) => b.skor - a.skor).slice(0, 15);
  if (contoh.length) {
    console.log("\n=== Usulan fuzzy teratas (periksa manual) ===");
    for (const h of contoh) {
      console.log(`  ${h.skor.toFixed(3)} (jarak ${h.jarak.toFixed(3)}) ${h.raw.slice(0, 44)}`);
      console.log(`        -> ${h.kandidat[0].name}`);
    }
  }
  const nihil = per("tidak_ada").slice(0, 10);
  if (nihil.length) {
    console.log("\n=== Tanpa padanan (10 pertama) ===");
    for (const h of nihil) console.log(`  ${h.raw.slice(0, 60)}  (${h.jumlah_alat} alat)`);
  }
  if (seksi.length) {
    console.log("\n=== Dilewati: pemisah seksi sheet, bukan faskes ===");
    console.log(`  ${seksi.join(", ")}`);
    console.log("  Kalau ada nama faskes betulan di daftar ini, perbaiki STASIUN di skrip.");
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. Tidak ada yang ditulis. Tambahkan --apply untuk mengeksekusi.");
    process.exit(0);
  }

  for (const h of hasil) {
    await sql`
      INSERT INTO kso_customer_map
        (customer_key, customer_raw, account_id, metode, skor, kandidat, updated_at)
      VALUES (${h.key}, ${h.raw}, ${h.account_id}, ${h.metode}, ${h.skor ?? null},
              ${sql.json(h.kandidat ?? [])}, now())
      ON CONFLICT (customer_key) DO UPDATE SET
        customer_raw = EXCLUDED.customer_raw,
        account_id   = EXCLUDED.account_id,
        metode       = EXCLUDED.metode,
        skor         = EXCLUDED.skor,
        kandidat     = EXCLUDED.kandidat,
        updated_at   = now()
      WHERE kso_customer_map.dikonfirmasi = false`;
  }

  // Sebar ke aset. Hanya mengisi dari peta — TIDAK mengosongkan account_id yang sudah
  // dipasang manual lewat aplikasi (peta account_id NULL dilewati, bukan menimpa NULL).
  const [{ count: disebar }] = await sql`
    WITH upd AS (
      UPDATE kso_asset a
      SET account_id = m.account_id, updated_at = now()
      FROM kso_customer_map m
      WHERE m.customer_key = upper(regexp_replace(a.customer_raw, '[^A-Za-z0-9]', '', 'g'))
        AND m.account_id IS NOT NULL
        AND a.account_id IS DISTINCT FROM m.account_id
      RETURNING 1)
    SELECT count(*)::int AS count FROM upd`;

  console.log(`\nSELESAI. peta=${kunciSemua} baris, kso_asset.account_id diperbarui=${disebar}`);
  console.log("Tinjau usulan fuzzy, lalu tandai dikonfirmasi=true supaya tidak ikut tertimpa:");
  console.log("  UPDATE kso_customer_map SET account_id=<id>, metode='manual', dikonfirmasi=true WHERE customer_key='...';");
} finally {
  await sql.end({ timeout: 5 });
}
