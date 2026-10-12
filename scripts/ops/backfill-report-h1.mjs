#!/usr/bin/env node
// Backfill: ikat ulang laporan dini hari yang terlanjur tersimpan tak-terikat.
//
// KENAPA PERLU: sampai #1066/#1067, insertAmActivities mengikat #REPORT ke
// rencana dengan `tanggal = ...` PERSIS. Laporan yang dikirim lewat tengah
// malam karena itu tak pernah menemukan rencana — tanggalnya sudah hari baru
// sementara rencananya di hari sebelumnya. Barisnya tetap tersimpan di
// activity_log (lengkap dengan hasil & next action) tapi ber-`is_unmatched`,
// dan `sales_plan.reported` tak pernah ter-set.
//
// Akibatnya capaian menampilkan 0 untuk orang yang justru bekerja dan melapor.
// Perbaikan #1066/#1067 menghentikannya TERJADI, tapi tidak memulihkan yang
// terlanjur — itu tugas skrip ini.
//
// ATURANNYA SATU SUMBER: pagar yang dipakai di sini SAMA dengan jalur live
// (repo/inbound.ts `tanggalIkatLaporan`), dan pencocokan nama memakai
// `bersihkanNamaCustomer` + ambang similarity 0,3 yang sama seperti
// `insertAmActivities`. Fungsinya di-IMPORT dari apps/api/dist, bukan disalin —
// kalau aturannya berubah, backfill ikut berubah.
//
// TIGA PAGAR (harus terpenuhi bersama, persis seperti jalur live):
//   1. tanggal aktivitas benar-benar TAK PUNYA rencana untuk AM itu — kalau ada
//      rencana di hari itu, tanggalnya dihormati dan baris dilewati;
//   2. pesan WA-nya diterima sebelum cutoff WIB (default 06:00);
//   3. H-1 punya minimal satu rencana yang BELUM dilaporkan.
//
// PAGAR TAMBAHAN khusus backfill:
//   4. satu rencana hanya boleh diikat ke SATU aktivitas — tanpa ini dua baris
//      laporan untuk faskes yang mirip bisa sama-sama mengklaim rencana yang
//      sama dan melipatgandakan capaian;
//   5. wa_message.message_id TIDAK unik (jebakan terdokumentasi) — received_at
//      diambil yang PALING AWAL lewat subquery, bukan JOIN yang menggandakan;
//   6. hanya menyentuh baris yang MASIH is_unmatched dan rencana yang MASIH
//      reported=false → aman dijalankan berulang (idempoten).
//
// JEJAK AUDIT: baris yang disentuh ditandai dengan menambahkan sufiks
// `+bf-h1` pada activity_log.source. Tidak ada kode yang memfilter kolom itu
// (diperiksa), dan sufiksnya membuat hasil backfill bisa dibedakan dari hasil
// pengikatan live — sekaligus memberi jalan mundur. Perintah pembatalannya
// dicetak skrip ini setelah --apply.
//
// Pakai (WAJIB build dulu — skrip ini memakai apps/api/dist):
//   pnpm --filter @wrg/api build
//   node scripts/ops/backfill-report-h1.mjs --from=2026-08-17 --to=2026-08-27
//   node scripts/ops/backfill-report-h1.mjs --from=... --to=... --apply
//
// Opsi: --am=1001 (batasi satu AM), --cutoff=6 (jam WIB), --apply (menulis).
//
// DATABASE_URL menentukan target — tidak ada default dan tidak ada flag --db,
// supaya tak ada yang menulis ke prod karena lupa.

// db() dari apps/api/dist, bukan `import postgres` langsung: paket itu tak
// resolvable dari root repo (pnpm tak meng-hoist), dan skrip ops lain
// (insentif-backfill-lunas-at.mjs) memakai pintu yang sama.
import { db } from "../../apps/api/dist/db.js";
import { bersihkanNamaCustomer } from "../../apps/api/dist/parsers/am.js";

const arg = (n, d = null) => {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`));
  return p ? p.slice(n.length + 3) : d;
};
const APPLY = process.argv.includes("--apply");
const FROM = arg("from");
const TO = arg("to");
const AM = arg("am");
const CUTOFF = Number(arg("cutoff", "6"));
// Default 0,3 = sama dengan insertAmActivities. Bisa dinaikkan lewat --ambang.
//
// KENAPA boleh beda dari live: di jalur live, laporan dan rencana berasal dari
// konteks hari yang SAMA, jadi 0,3 cukup aman. Backfill menjangkau lintas hari
// dan menulis ke riwayat yang sudah jadi — salah pasang berarti seseorang
// dikreditkan kunjungan yang tak dia lakukan, dan tak ada orang yang akan
// mengoreksinya. Terlihat di prod: pada 0,3 muncul "RS Assakinah Medika" →
// "RS Kamar Medika" (0,38) dan "Puskesmas Trenggalek" → "Dinkes Kab Trenggalek"
// (0,39) — dua faskes yang jelas berbeda. Untuk backfill, jalankan dengan
// --ambang=0.55 dan tinjau sisanya manual.
const AMBANG = Number(arg("ambang", "0.3"));
if (!(AMBANG > 0 && AMBANG < 1)) { console.error("--ambang harus di antara 0 dan 1"); process.exit(2); }

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL wajib di-set. Contoh:\n  DATABASE_URL=postgres:///wrg_os_prod node scripts/ops/backfill-report-h1.mjs --from=… --to=…");
  process.exit(2);
}
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
if (!isoOk(FROM) || !isoOk(TO)) {
  console.error("--from dan --to WAJIB, format YYYY-MM-DD. Rentang eksplisit disengaja: tanpa itu mudah tak sengaja menyapu seluruh riwayat.");
  process.exit(2);
}
if (!(CUTOFF >= 0 && CUTOFF <= 23)) {
  console.error("--cutoff harus 0..23");
  process.exit(2);
}

const sql = db();
const rp = (n) => String(n).padStart(4);

// Kandidat: aktivitas tak-terikat dalam rentang, berikut jam terima WIB
// (paling awal) dan hitungan rencana di tanggalnya + di H-1.
const kandidat = await sql`
  SELECT a.id, a.am_id, a.tanggal::text AS tanggal, a.customer_name, a.source,
         (a.tanggal - 1)::text AS h1,
         (SELECT extract(hour FROM (min(w.received_at) AT TIME ZONE 'Asia/Jakarta'))::int
            FROM wa_message w WHERE w.message_id = a.message_id) AS jam_wib,
         (SELECT count(*)::int FROM sales_plan p
           WHERE p.am_id = a.am_id AND p.tanggal = a.tanggal) AS n_hari_itu,
         (SELECT count(*)::int FROM sales_plan p
           WHERE p.am_id = a.am_id AND p.tanggal = a.tanggal - 1 AND NOT p.reported) AS n_h1_belum
    FROM activity_log a
   WHERE a.is_unmatched
     AND a.plan_id IS NULL
     AND a.message_id IS NOT NULL
     AND a.tanggal BETWEEN ${FROM}::date AND ${TO}::date
     ${AM ? sql`AND a.am_id = ${AM}` : sql``}
   ORDER BY a.am_id, a.tanggal, a.id`;

console.log(`Rentang ${FROM} … ${TO}${AM ? ` · AM ${AM}` : ""} · ambang ${AMBANG} · cutoff ${String(CUTOFF).padStart(2, "0")}:00 WIB · ${APPLY ? "APPLY (MENULIS)" : "pratinjau (tak menulis)"}`);
console.log(`Kandidat tak-terikat: ${kandidat.length}\n`);

const dilewati = { punya_rencana: 0, jam_kerja: 0, h1_kosong: 0, tanpa_pesan: 0, tak_cocok: 0, rencana_terpakai: 0 };
const rencanaTerpakai = new Set();
const rencana = [];
const pasangan = [];

for (const a of kandidat) {
  if (a.jam_wib === null) { dilewati.tanpa_pesan++; continue; }
  if (Number(a.n_hari_itu) > 0) { dilewati.punya_rencana++; continue; }
  if (Number(a.jam_wib) >= CUTOFF) { dilewati.jam_kerja++; continue; }
  if (Number(a.n_h1_belum) < 1) { dilewati.h1_kosong++; continue; }

  const nama = bersihkanNamaCustomer(String(a.customer_name ?? ""));
  const cands = await sql`
    SELECT id, customer_name, similarity(customer_name, ${nama}) AS score
      FROM sales_plan
     WHERE am_id = ${a.am_id} AND tanggal = ${a.h1}::date AND NOT reported
       AND similarity(customer_name, ${nama}) > ${AMBANG}
     ORDER BY score DESC`;
  if (!cands.length) { dilewati.tak_cocok++; continue; }
  for (const c of cands) {
    pasangan.push({
      aktivitas: Number(a.id), am: String(a.am_id),
      dari: String(a.tanggal), ke: String(a.h1), jam: Number(a.jam_wib),
      laporan: String(a.customer_name), plan: String(c.customer_name),
      planId: Number(c.id), skor: Number(c.score), source: String(a.source ?? ""),
    });
  }
}

// Penugasan GLOBAL menurut skor, bukan urut id aktivitas.
//
// KENAPA: dulu tiap aktivitas mengambil kandidat terbaik yang MASIH bebas —
// artinya kalau kandidat terbaiknya sudah diklaim, ia turun ke kandidat
// BERIKUTNYA. Satu laporan yang sebenarnya tak punya rencana karena itu bisa
// menyerobot rencana milik laporan lain, dan korbannya ikut terdorong ke
// rencana yang salah. Terlihat di prod 22 Agu 2026 (AM 12): "Puskesmas
// Baruharjo" tak punya rencana, menyerobot "Puskesmas Pogalan" (0,37), lalu
// Pogalan asli terdorong ke "Puskesmas Trenggalek" (0,41) dan Trenggalek asli
// ke "PMI Trenggalek" (0,50) — tiga pasangan yang seharusnya 1,00 jadi salah
// semua gara-gara satu laporan tanpa rencana.
//
// Sekarang: semua pasangan calon diurutkan menurut skor menurun, lalu diambil
// kalau aktivitas DAN rencananya sama-sama masih bebas. Pasangan sempurna
// selalu menang lebih dulu, dan yang tak kebagian DILEWATI — tidak diturunkan
// ke rencana lain. Tie-break memakai id supaya hasilnya deterministik.
pasangan.sort((x, y) => y.skor - x.skor || x.aktivitas - y.aktivitas || x.planId - y.planId);
const aktivitasTerpakai = new Set();
for (const p of pasangan) {
  if (aktivitasTerpakai.has(p.aktivitas) || rencanaTerpakai.has(p.planId)) continue;
  aktivitasTerpakai.add(p.aktivitas);
  rencanaTerpakai.add(p.planId);
  rencana.push(p);
}
dilewati.rencana_terpakai = new Set(pasangan.map((p) => p.aktivitas)).size - rencana.length;
rencana.sort((x, y) => x.am.localeCompare(y.am) || x.dari.localeCompare(y.dari) || x.aktivitas - y.aktivitas);

if (rencana.length === 0) {
  console.log("Tak ada yang bisa diikat ulang.");
} else {
  console.log("AM     dari       → ke         jam  skor  laporan → rencana");
  console.log("─".repeat(96));
  for (const r of rencana) {
    console.log(
      `${r.am.padEnd(6)} ${r.dari} → ${r.ke}  ${String(r.jam).padStart(2, "0")}:xx ${r.skor.toFixed(2)}  ` +
      `${r.laporan.slice(0, 30).padEnd(30)} → ${r.plan.slice(0, 30)}`,
    );
  }
}
console.log(`\nAkan diikat      : ${rp(rencana.length)}`);
console.log(`Dilewati:`);
console.log(`  punya rencana  : ${rp(dilewati.punya_rencana)}  (tanggalnya dihormati)`);
console.log(`  jam kerja      : ${rp(dilewati.jam_kerja)}  (>= ${CUTOFF}:00 WIB, bukan kasus tengah malam)`);
console.log(`  H-1 kosong     : ${rp(dilewati.h1_kosong)}  (tak ada rencana belum-lapor di H-1)`);
console.log(`  tanpa pesan WA : ${rp(dilewati.tanpa_pesan)}  (message_id tak ketemu di wa_message)`);
console.log(`  nama tak cocok : ${rp(dilewati.tak_cocok)}  (similarity <= ${AMBANG})`);
console.log(`  rencana dipakai: ${rp(dilewati.rencana_terpakai)}  (sudah diklaim aktivitas lain)`);

if (!APPLY) {
  console.log(`\nPratinjau saja — tidak ada yang ditulis. Tambahkan --apply untuk menulis.`);
  await sql.end();
  process.exit(0);
}

let ok = 0;
for (const r of rencana) {
  // Transaksi per baris: satu kegagalan tak boleh menggagalkan sisanya, dan
  // syarat idempoten diulang DI DALAM UPDATE (bukan cuma dicek di atas) supaya
  // tetap aman kalau ada proses lain menyentuh baris yang sama.
  await sql.begin(async (tx) => {
    const upd = await tx`
      UPDATE sales_plan SET reported = true, reported_at = now(), activity_id = ${r.aktivitas}
       WHERE id = ${r.planId} AND reported = false RETURNING id`;
    if (upd.length === 0) return; // sudah dilaporkan proses lain
    await tx`
      UPDATE activity_log
         SET plan_id = ${r.planId}, is_unmatched = false, match_score = ${r.skor},
             tanggal = ${r.ke}::date,
             source = CASE WHEN source LIKE '%+bf-h1' THEN source ELSE COALESCE(source,'') || '+bf-h1' END
       WHERE id = ${r.aktivitas} AND is_unmatched`;
    ok += 1;
  });
}
console.log(`\nDitulis: ${ok} aktivitas terikat + ${ok} rencana ditandai reported.`);
console.log(`\nJalan mundur (kalau perlu):`);
console.log(`  UPDATE sales_plan SET reported=false, reported_at=NULL, activity_id=NULL`);
console.log(`   WHERE activity_id IN (SELECT id FROM activity_log WHERE source LIKE '%+bf-h1');`);
console.log(`  UPDATE activity_log SET plan_id=NULL, is_unmatched=true, match_score=NULL,`);
console.log(`         source=replace(source,'+bf-h1','') WHERE source LIKE '%+bf-h1';`);
console.log(`  (tanggal aktivitas TIDAK dikembalikan otomatis — catat dulu kalau perlu)`);
await sql.end();
