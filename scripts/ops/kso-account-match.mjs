#!/usr/bin/env node
// Cocokkan nama customer di spreadsheet KSO (kso_asset.customer_raw) ke customer Accurate
// (accurate_customer), isi `kso_customer_map`, lalu sebar hasilnya ke kso_asset.account_id.
// Prasyarat: migrasi 097 + 098 sudah diterapkan dan kso_asset sudah terisi.
//
// KENAPA PENCOCOKAN INI TIDAK BOLEH OTOMATIS SEPENUHNYA:
// Nama di sheet bukan nama Accurate. Sheet menulis "<nama Accurate> <KOTA>" digabung —
// "AULIA II, BALAI PENGOBATAN KAB. JOMBANG" — dan kolom Kota-nya berisi "KAB. JOMBANG"
// yang sama. Salah pasang satu faskes berarti revenue satu rumah sakit nyasar ke rumah
// sakit lain, dan kesalahan itu tidak akan kelihatan di angka total mana pun. Karena itu:
//   • exact / tanpa_kota  -> dipasang otomatis (deterministik, tidak ada tebakan)
//   • fuzzy               -> HANYA USULAN. account_id dibiarkan NULL sampai manusia
//                            mengonfirmasi, kecuali dijalankan dengan --terima-fuzzy.
// Baris yang `dikonfirmasi = true` tidak pernah ditimpa skrip ini.
//
// PAKAI:
//   pnpm --filter @wrg/api build
//   node scripts/ops/kso-account-match.mjs                        # pratinjau
//   node scripts/ops/kso-account-match.mjs --apply                # pasang exact + tanpa_kota
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

const slug = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const kata = (s) =>
  String(s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length > 1);

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
    slug: slug(c.name), kata: kata(c.name),
  }));
  const byslug = new Map();
  for (const c of acc) if (!byslug.has(c.slug)) byslug.set(c.slug, c);

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
  for (const s of sumber) {
    const raw = String(s.customer_raw);
    const key = slug(raw);
    if (terkunci.has(key)) continue; // sudah ditinjau manusia — jangan diusik

    // Varian tanpa ekor kota: sheet menempelkan kota ke belakang nama Accurate.
    const kotaSlug = slug(s.kota);
    const tanpaKota = kotaSlug && key.endsWith(kotaSlug)
      ? key.slice(0, key.length - kotaSlug.length)
      : null;

    let baris;
    if (byslug.has(key)) {
      const c = byslug.get(key);
      baris = { key, raw, jumlah_alat: s.jumlah_alat, account_id: c.id, metode: "exact",
                skor: 1, kandidat: [{ id: c.id, name: c.name, skor: 1 }] };
    } else if (tanpaKota && byslug.has(tanpaKota)) {
      const c = byslug.get(tanpaKota);
      baris = { key, raw, jumlah_alat: s.jumlah_alat, account_id: c.id, metode: "tanpa_kota",
                skor: 1, kandidat: [{ id: c.id, name: c.name, skor: 1 }] };
    } else {
      // Dinilai terhadap dua bentuk (dengan & tanpa kota), diambil yang terbaik.
      const kt = kata(raw);
      const ktTanpa = tanpaKota ? kata(tanpaKota) : kt;
      const nilai = acc.map((c) => ({
        id: c.id, name: c.name,
        skor: Math.max(
          skor(key, kt, c.slug, c.kata),
          tanpaKota ? skor(tanpaKota, ktTanpa, c.slug, c.kata) : 0),
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
  const terpasang = hasil.filter((h) => h.account_id !== null);

  console.log("=== Hasil pencocokan ===");
  console.log(`  nama customer unik di kso_asset : ${sumber.length}`);
  console.log(`  sudah dikonfirmasi (dilewati)   : ${terkunci.size}`);
  console.log(`  customer Accurate tersedia      : ${acc.length}`);
  console.log(`  exact                           : ${per("exact").length}`);
  console.log(`  tanpa_kota                      : ${per("tanpa_kota").length}`);
  console.log(`  fuzzy (usulan)                  : ${per("fuzzy").length}` +
    (AMBANG_FUZZY !== null
      ? `  -> dipasang: ${per("fuzzy").filter((h) => h.account_id).length} (ambang ${AMBANG_FUZZY})`
      : "  -> tidak dipasang (pakai --terima-fuzzy <skor>)"));
  console.log(`  tidak ada padanan               : ${per("tidak_ada").length}`);
  console.log(`  TOTAL akan punya account_id     : ${terpasang.length}`);

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

  console.log(`\nSELESAI. peta=${hasil.length} baris, kso_asset.account_id diperbarui=${disebar}`);
  console.log("Tinjau usulan fuzzy, lalu tandai dikonfirmasi=true supaya tidak ikut tertimpa:");
  console.log("  UPDATE kso_customer_map SET account_id=<id>, metode='manual', dikonfirmasi=true WHERE customer_key='...';");
} finally {
  await sql.end({ timeout: 5 });
}
