#!/usr/bin/env node
// Impor JSON hasil `pic-form-to-json.py` ke tabel migrasi 168
// (divisi, posisi, posisi_tugas, sop, sop_langkah, posisi_koordinasi,
//  divisi_okr, divisi_okr_kr).
//
// DEFAULT DRY-RUN. Tanpa --apply skrip ini menjalankan seluruh impor di dalam
// satu transaksi lalu ROLLBACK, jadi angka yang dicetak adalah hasil sungguhan
// dari data sungguhan — bukan perkiraan. Pola sama kso-asset-import.mjs.
//
// PAKAI:
//   pnpm --filter @wrg/api build                                   # skrip memakai dist/db.js
//   python3 scripts/ops/pic-form-to-json.py <folder-xlsx> --out ~/pic-form-import.json
//   node scripts/ops/pic-form-import.mjs --file ~/pic-form-import.json           # pratinjau
//   node scripts/ops/pic-form-import.mjs --file ~/pic-form-import.json --apply   # tulis
//
// SIFAT IMPOR (idempoten, aman diulang):
//   • divisi   : hanya pic_nama & hod_nama yang di-UPDATE. Baris divisi-nya
//                sendiri di-seed migrasi 168; kalau key-nya belum ada, skrip
//                BERHENTI — itu tanda migrasi belum diterapkan, dan membuat
//                barisnya di sini akan menutupi kesalahan urutan deploy.
//   • posisi   : UPSERT by (divisi_key, nama). ID-nya stabil, jadi referensi
//                dari luar tidak putus tiap impor.
//   • anak-anak (posisi_tugas, sop_langkah, posisi_koordinasi, divisi_okr):
//                DIGANTI TOTAL per induk (hapus lalu sisipkan), bukan di-upsert
//                per baris. Sheet adalah sumber kebenarannya: kalau PIC menghapus
//                satu tugas dari form, tugas itu HARUS hilang dari DB juga.
//                Upsert per-seq akan meninggalkan baris hantu yang tidak ada lagi
//                di form dan tak seorang pun tahu asalnya.
//
//   ⚠ KONSEKUENSI YANG HARUS DIINGAT KALAU NANTI ADA UI: begitu ada menu yang
//   membolehkan orang menyunting kolom di tabel-tabel anak itu (paling mungkin
//   sop_langkah.target_level), impor berikutnya akan MENGHAPUS suntingan itu.
//   Saat itu tiba, kolom yang bisa disunting harus dikecualikan dari penggantian
//   — persis seperti `pemilik_alat`/`account_id` di kso-asset-import.mjs yang
//   sengaja tidak pernah ditimpa. Untuk sekarang belum ada UI-nya, jadi
//   penggantian total masih perilaku yang benar.
//
// pj_key TIDAK di-hardcode di sini. Ejaan kolom "PJ (A)" diresolusi lewat tabel
// `pj_alias` (lower-case exact match). Ejaan yang belum terdaftar disimpan
// dengan pj_key NULL dan DILAPORKAN — bukan ditebak. Cara menambah: satu INSERT
// ke pj_alias, tanpa menyentuh kode ini.

import { readFileSync } from "node:fs";
import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
const fileIdx = process.argv.indexOf("--file");
const FILE = fileIdx > -1 ? process.argv[fileIdx + 1] : null;

if (!FILE) {
  console.error("pakai: node scripts/ops/pic-form-import.mjs --file <json> [--apply]");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(FILE, "utf8"));
const divisis = payload.divisi ?? [];
if (!divisis.length) {
  console.error(`TOLAK: ${FILE} tidak memuat divisi apa pun.`);
  process.exit(1);
}

const sql = db();
const ROLLBACK = Symbol("dry-run");
const n = (x) => x.toLocaleString("id-ID");

try {
  // ---- prasyarat: migrasi 168 sudah jalan? --------------------------------
  const [{ ada }] = await sql`
    SELECT count(*)::int AS ada FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('divisi','posisi','posisi_tugas','sop','sop_langkah',
                          'posisi_koordinasi','divisi_okr','divisi_okr_kr','pj_alias')`;
  if (ada < 9) {
    console.error(`TOLAK: baru ${ada}/9 tabel migrasi 168 ada di DB ini.`);
    console.error("Terapkan infra/postgres/init/168_pic_form_spine.sql dulu.");
    process.exit(1);
  }

  const alias = new Map(
    (await sql`SELECT alias, pj_key FROM pj_alias`).map((r) => [r.alias, r.pj_key]));

  const stat = [];
  const pjTakDikenal = new Map();   // ejaan -> jumlah baris
  let hapus = 0;

  try {
    await sql.begin(async (tx) => {
      for (const d of divisis) {
        const [row] = await tx`SELECT key FROM divisi WHERE key = ${d.divisi_key}`;
        if (!row) {
          throw new Error(
            `divisi '${d.divisi_key}' (${d.divisi_label}) tidak ada di tabel divisi. ` +
            `Migrasi 168 men-seed 6 key; kalau form memakai divisi baru, tambahkan ` +
            `lewat migrasi — jangan disisipkan diam-diam oleh importer.`);
        }
        await tx`
          UPDATE divisi SET pic_nama = ${d.pic_nama ?? null},
                            hod_nama = ${d.hod_nama ?? null}
           WHERE key = ${d.divisi_key}`;

        const s = { divisi: d.divisi_key, posisi: 0, tugas: 0, sop: 0, langkah: 0, koord: 0, obj: 0, kr: 0 };

        // ---- posisi + anak-anaknya -----------------------------------------
        for (const p of d.posisi) {
          const [{ id }] = await tx`
            INSERT INTO posisi (divisi_key, nama, jumlah_orang, level_raw, catatan, seq)
            VALUES (${d.divisi_key}, ${p.nama}, ${p.jumlah_orang ?? null},
                    ${p.level_raw ?? null}, ${p.catatan ?? null}, ${p.seq})
            ON CONFLICT (divisi_key, nama) DO UPDATE SET
              jumlah_orang = EXCLUDED.jumlah_orang,
              level_raw    = EXCLUDED.level_raw,
              catatan      = EXCLUDED.catatan,
              seq          = EXCLUDED.seq
            RETURNING id`;
          s.posisi++;

          const delT = await tx`DELETE FROM posisi_tugas       WHERE posisi_id = ${id}`;
          const delK = await tx`DELETE FROM posisi_koordinasi  WHERE posisi_id = ${id}`;
          hapus += delT.count + delK.count;

          if (p.tugas.length) {
            const baris = p.tugas.map((t) => {
              const raw = t.pj_raw ?? null;
              const key = raw ? (alias.get(raw.toLowerCase()) ?? null) : null;
              if (raw && !key) pjTakDikenal.set(raw, (pjTakDikenal.get(raw) ?? 0) + 1);
              return {
                posisi_id: id, uraian: t.uraian, rules: t.rules ?? null,
                frekuensi_raw: t.frekuensi_raw ?? null, frekuensi: t.frekuensi ?? null,
                pj_raw: raw, pj_key: key, kpi_target: t.kpi_target ?? null, seq: t.seq,
              };
            });
            await tx`INSERT INTO posisi_tugas ${tx(baris)}`;
            s.tugas += baris.length;
          }

          if (p.koordinasi.length) {
            const baris = p.koordinasi.map((k) => ({
              posisi_id: id, dengan_raw: k.dengan_raw, dengan_key: k.dengan_key ?? null,
              dengan_grup: k.dengan_grup ?? null, apa: k.apa ?? null,
              pemicu: k.pemicu ?? null, seq: k.seq,
            }));
            await tx`INSERT INTO posisi_koordinasi ${tx(baris)}`;
            s.koord += baris.length;
          }
        }

        // ---- SOP + langkah --------------------------------------------------
        for (const so of d.sop) {
          const [{ id }] = await tx`
            INSERT INTO sop (divisi_key, nama, seq)
            VALUES (${d.divisi_key}, ${so.nama}, ${so.seq})
            ON CONFLICT (divisi_key, nama) DO UPDATE SET seq = EXCLUDED.seq
            RETURNING id`;
          s.sop++;
          const del = await tx`DELETE FROM sop_langkah WHERE sop_id = ${id}`;
          hapus += del.count;
          if (so.langkah.length) {
            const baris = so.langkah.map((l) => ({
              sop_id: id, seq: l.seq, langkah: l.langkah,
              kondisi_raw: l.kondisi_raw ?? null, kondisi: l.kondisi ?? null,
              target_raw: l.target_raw ?? null, target_level: l.target_level ?? null,
              catatan: l.catatan ?? null,
            }));
            await tx`INSERT INTO sop_langkah ${tx(baris)}`;
            s.langkah += baris.length;
          }
        }

        // ---- OKR divisi (CASCADE ikut membuang key result-nya) --------------
        const delO = await tx`DELETE FROM divisi_okr WHERE divisi_key = ${d.divisi_key}`;
        hapus += delO.count;
        for (const o of d.okr) {
          const [{ id }] = await tx`
            INSERT INTO divisi_okr (divisi_key, objective, perspective_raw, perspective, seq)
            VALUES (${d.divisi_key}, ${o.objective}, ${o.perspective_raw ?? null},
                    ${o.perspective ?? null}, ${o.seq})
            RETURNING id`;
          s.obj++;
          if (o.kr.length) {
            await tx`INSERT INTO divisi_okr_kr ${tx(
              o.kr.map((k) => ({ okr_id: id, key_result: k.key_result, seq: k.seq })))}`;
            s.kr += o.kr.length;
          }
        }

        stat.push(s);
      }

      if (!APPLY) throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }

  // ---- laporan -------------------------------------------------------------
  console.log(APPLY ? "MODE: --apply (ditulis)\n" : "MODE: pratinjau — transaksi di-ROLLBACK, DB tidak berubah\n");
  console.log(
    "DIVISI".padEnd(14) + "POSISI".padStart(7) + "TUGAS".padStart(7) +
    "SOP".padStart(6) + "LANGKAH".padStart(9) + "KOORD".padStart(7) +
    "OBJ".padStart(5) + "KR".padStart(5));
  const tot = { posisi: 0, tugas: 0, sop: 0, langkah: 0, koord: 0, obj: 0, kr: 0 };
  for (const s of stat) {
    console.log(
      s.divisi.padEnd(14) + String(s.posisi).padStart(7) + String(s.tugas).padStart(7) +
      String(s.sop).padStart(6) + String(s.langkah).padStart(9) + String(s.koord).padStart(7) +
      String(s.obj).padStart(5) + String(s.kr).padStart(5));
    for (const k of Object.keys(tot)) tot[k] += s[k];
  }
  console.log(
    "TOTAL".padEnd(14) + String(tot.posisi).padStart(7) + String(tot.tugas).padStart(7) +
    String(tot.sop).padStart(6) + String(tot.langkah).padStart(9) + String(tot.koord).padStart(7) +
    String(tot.obj).padStart(5) + String(tot.kr).padStart(5));
  console.log(`\nbaris anak yang diganti (dihapus lalu disisipkan ulang): ${n(hapus)}`);

  if (pjTakDikenal.size) {
    console.log("\n⚠ ejaan PJ (A) yang TIDAK ada di tabel pj_alias — disimpan dengan pj_key NULL:");
    for (const [k, v] of [...pjTakDikenal].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(v).padStart(5)}× ${k}`);
    }
    console.log("   Perbaiki dengan: INSERT INTO pj_alias (alias,pj_key) VALUES (lower('<ejaan>'),'<kanonik>');");
    console.log("   lalu jalankan ulang impor ini. JANGAN tambal daftar di dalam kode.");
  } else {
    console.log("\nsemua ejaan PJ (A) terpetakan lewat pj_alias.");
  }

  if (APPLY) {
    const lengkap = await sql`
      SELECT divisi, posisi, tugas, langkah_sop, koordinasi, objective,
             pct_tugas_ada_kpi, pct_langkah_ada_target, pct_pj_kanonik,
             terpetakan_ke_department
        FROM v_form_kelengkapan ORDER BY divisi_key`;
    console.log("\n== v_form_kelengkapan (setelah impor) ==");
    for (const r of lengkap) {
      console.log(
        `   ${r.divisi.padEnd(23)} posisi=${String(r.posisi).padStart(2)} tugas=${String(r.tugas).padStart(3)}` +
        ` langkah=${String(r.langkah_sop).padStart(3)} koord=${String(r.koordinasi).padStart(2)}` +
        ` obj=${String(r.objective).padStart(2)}` +
        ` | KPI ${String(r.pct_tugas_ada_kpi ?? "—").padStart(5)}%` +
        ` target ${String(r.pct_langkah_ada_target ?? "—").padStart(5)}%` +
        ` PJ-kanonik ${String(r.pct_pj_kanonik ?? "—").padStart(5)}%` +
        `${r.terpetakan_ke_department ? "" : "  ⚠ tanpa pemetaan department"}`);
    }
    console.log("\nSELESAI.");
  } else {
    console.log("\nTidak ada yang ditulis. Ulangi dengan --apply untuk menerapkan.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
