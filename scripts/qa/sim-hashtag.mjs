#!/usr/bin/env node
// Simulasi command hashtag WA end-to-end terhadap DB nyata.
//
// Tiap skenario dijalankan lewat processInboundMessage() — fungsi YANG SAMA
// dengan jalur produksi, bukan tiruan — lalu teks balasannya ditangkap dan
// dibandingkan dengan pola yang diharapkan.
//
// Kenapa perlu ada: teks balasan TIDAK ada di return value (WaSendResult
// sengaja cuma membawa {to,sent,stub}, dan pesan keluar tak disimpan ke DB).
// Satu-satunya cara melihatnya adalah stdout wasend.ts mode STUB/DRY-RUN, yang
// mencetak "--- pesan ---\n<body>\n--- selesai ---". Harness membajak
// console.log dan memungut blok itu. Tanpa ini, memverifikasi sebuah command
// berarti menulis skrip sendiri tiap kali.
//
// TIDAK pernah mengirim WA: WA_SEND_URL dikosongkan (mode STUB).
//
// Pakai:
//   node scripts/qa/sim-hashtag.mjs                → semua skenario (butuh fixture)
//   node scripts/qa/sim-hashtag.mjs --baca-saja    → HANYA skenario tanpa efek tulis
//   node scripts/qa/sim-hashtag.mjs stok sph       → filter nama skenario
//   DATABASE_URL=postgres:///wrg_os_dev node scripts/qa/sim-hashtag.mjs
//
// Prasyarat (urutan seed-nya WAJIB — seed-dev-full punya FK ke master_user
// yang diisi seed-dev; setup dari NOL lihat scripts/qa/README.md, migrate.sh
// TIDAK bisa bootstrap DB kosong):
//   1. bash scripts/db/migrate.sh                  (skema mutakhir)
//   2. psql -d <db> -f scripts/db/seed-dev.sql
//      psql -d <db> -f scripts/db/seed-dev-full.sql
//      psql -d <db> -f scripts/qa/seed-hashtag-fixtures.sql
//   3. pnpm --filter @wrg/api build                (harness memuat dist/)
//
// Keluar dengan kode 1 kalau ada skenario yang tak cocok → bisa dipakai di
// pipeline manual. TIDAK dipasang di CI: butuh Postgres ber-skema penuh.
//
// ── BACA vs TULIS: kenapa ditandai ───────────────────────────────────────
// Tiap skenario ditandai `tulis: true` kalau jalur suksesnya MENGUBAH data
// domain. Ini bukan sekadar label — sebagian command punya efek yang nyata:
//
//   #APPROVE / #REJECT  → benar-benar MEMUTUSKAN approval request
//   #KIRIM #BAST #BUKTI → memajukan status SJ di shipment_tracking
//   #HELPDESK           → membuat tiket GA bernomor urut
//   #SPH                → menyimpan draft SPH atas nama AM
//   #KLAIM              → menyimpan baris doc_klaim
//   #install dkk        → menyimpan teknisi_report
//
// Terhadap data FIXTURE (dev) itu tak berbahaya: semua sasarannya milik
// fixture sendiri (QA-AM-1, SJ-QA-00x, APR-900x). Terhadap data NYATA,
// menjalankannya bukan verifikasi melainkan transaksi — approval orang
// betulan ikut diputus. Karena itu `--baca-saja` ada, dan skenario tulis
// DITOLAK kalau fixture-nya tak ada (lihat pemeriksaan di bawah).
//
// PERINGATAN yang tetap berlaku di mode --baca-saja: harness SELALU menyisipkan
// baris `wa_message` (processInboundMessage butuh baris nyata untuk diproses).
// Baris-baris itu ber-`input_hash` prefiks 'qa-sim-' supaya bisa dikenali &
// dibuang:
//   DELETE FROM wa_message WHERE input_hash LIKE 'qa-sim-%';
// Di DB nyata, baris sintetis itu ikut terbaca oleh rekap/digest WA kalau tak
// dibersihkan. Jadi "baca-saja" = tak mengubah data DOMAIN, bukan nol tulis.

import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

process.env.DATABASE_URL ??= "postgres:///wrg_os_dev";
process.env.WA_INBOUND_PROCESS = "true";
process.env.WA_DRY_RUN = "true";
delete process.env.WA_SEND_URL; // mode STUB → body tercetak utuh
delete process.env.WA_INBOUND_GROUPS; // kosong = semua grup lolos
delete process.env.F26_COMPLAINT_GROUP_JID;
delete process.env.COMPLIANCE_AM_GROUP;
delete process.env.REMINDER_WA_TARGET;

const DIST = join(ROOT, "apps/api/dist");
// pathToFileURL: import() butuh URL berskema (file://), path absolut Windows
// (C:\...) bukan URL valid buat default ESM loader — POSIX kebetulan lolos.
const DIST_URL = pathToFileURL(DIST + "/").href;
let db, processInboundMessage, processUnprocessed, detectKind;
try {
  ({ db } = await import(`${DIST_URL}db.js`));
  ({ processInboundMessage, processUnprocessed, detectKind } = await import(`${DIST_URL}repo/inbound.js`));
} catch (e) {
  console.error(`Gagal memuat ${DIST} — jalankan dulu: pnpm --filter @wrg/api build\n${e.message}`);
  process.exit(1);
}

const sql = db();

// ── stub services/ai ──────────────────────────────────────────────────────
// #KLAIM memanggil services/ai POST /ocr-klaim. Distub supaya jalur #KLAIM bisa
// diuji tanpa .venv FastAPI maupun kunci OpenRouter. Bentuk balasan mengikuti
// KlaimOcrResponse. Mode ditentukan caption: memuat "dryrun" → dry_run:true.
const AI_PORT = Number(process.env.QA_AI_STUB_PORT || 8099);
process.env.AI_URL = `http://127.0.0.1:${AI_PORT}`;

const aiStub = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let caption = "";
    try {
      caption = String(JSON.parse(raw).caption ?? "");
    } catch {
      /* body tak terbaca → caption kosong */
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        /dryrun/i.test(caption)
          ? { raw_text: "", model: "dry-run", dry_run: true }
          : {
              raw_text: "INVOICE STUB",
              nomor_dokumen: "INV-STUB-001",
              tanggal_dokumen: "2026-08-20",
              nominal: "Rp 1.250.000",
              pihak: "PT Fixture Sehat",
              model: "stub-vision",
              dry_run: false,
            },
      ),
    );
  });
});
await new Promise((r) => aiStub.listen(AI_PORT, "127.0.0.1", r));

// ── berkas foto fixture ───────────────────────────────────────────────────
// ingestKlaim benar-benar membaca isi berkasnya, jadi butuh JPEG valid.
const FOTO_DIR = mkdtempSync(join(tmpdir(), "wrg-qa-foto-"));
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A/v8AooA//9k=",
  "base64",
);
const foto = (n) => {
  const p = join(FOTO_DIR, `${n}.jpg`);
  writeFileSync(p, JPEG_1PX);
  return p;
};
const FOTO = { klaim: foto("klaim"), kirim: foto("kirim"), bast: foto("bast"), bukti: foto("bukti") };

// ── pengirim (default fixture, harus cocok seed-hashtag-fixtures.sql) ─────
// Bisa di-override lewat env. Gunanya untuk menguji command BACA terhadap data
// NYATA (mis. di DB prod, mode --baca-saja): nomor fixture tak ada di roster
// nyata, jadi gerbang resolveSender menolaknya dan semua command baca cuma
// membalas hening — hasilnya terbaca seperti kerusakan, padahal cuma identitas
// pengirimnya yang tak dikenal. Isi QA_AM_WA dengan nomor AM yang BENAR ada di
// master_user, lalu QA_AM_NAMA dengan namanya (dipakai mencocokkan teks balasan
// yang menyebut nama).
//
//   QA_AM_WA=6281234567890 QA_AM_NAMA="Nama Asli" \
//     node scripts/qa/sim-hashtag.mjs --baca-saja
const AM = {
  jid: `${process.env.QA_AM_WA ?? "628111000001"}@s.whatsapp.net`,
  nama: process.env.QA_AM_NAMA ?? "Dewi Fixture",
};
const HOD = {
  jid: `${process.env.QA_HOD_WA ?? "628111000002"}@s.whatsapp.net`,
  nama: process.env.QA_HOD_NAMA ?? "Rina Fixture",
};
const TEKNISI = {
  jid: `${process.env.QA_TEKNISI_WA ?? "628111000003"}@s.whatsapp.net`,
  nama: process.env.QA_TEKNISI_NAMA ?? "Joko Fixture",
};
// Sengaja TIDAK bisa di-override: harus tetap tak dikenal roster mana pun,
// itu inti dari 5 uji penembusan gerbang.
const ASING = { jid: "628999999999@s.whatsapp.net", nama: "Orang Asing" };
const GRUP = process.env.QA_GRUP_JID ?? "6280000000000-1234567890@g.us";

// ── mode & gerbang keamanan ───────────────────────────────────────────────
const argv = process.argv.slice(2);
const BACA_SAJA = argv.includes("--baca-saja");
const filter = argv.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());

// Fixture ADA = aman menjalankan skenario tulis, karena semua sasaran tulis
// (QA-AM-1, SJ-QA-00x, APR-900x, hod@qa.invalid) adalah milik fixture. Fixture
// TIDAK ada = DB ini bukan DB fixture → jangan sentuh apa pun yang menulis.
const [fixtureAda] = await sql`SELECT 1 FROM master_user WHERE am_id = 'QA-AM-1'`;

if (!fixtureAda && !BACA_SAJA) {
  console.error(
    [
      "Fixture tidak ditemukan (master_user 'QA-AM-1' tak ada) — skenario TULIS ditolak.",
      "",
      "Skenario tulis punya efek domain nyata: #APPROVE benar-benar memutuskan",
      "approval request, #KIRIM/#BAST memajukan status SJ, #HELPDESK membuat tiket.",
      "Di DB fixture itu aman (sasarannya milik fixture); di DB nyata itu transaksi.",
      "",
      "Pilih salah satu:",
      "  psql -d wrg_os_dev -f scripts/qa/seed-hashtag-fixtures.sql   # semai fixture, lalu ulangi",
      "  node scripts/qa/sim-hashtag.mjs --baca-saja                  # uji terhadap data apa adanya",
    ].join("\n"),
  );
  process.exit(1);
}
// Item yang punya stok cabang (dipilih seed) — dipakai buat #STOK cocok-tunggal.
const [itemStok] = await sql`
  SELECT ai.no, ai.name FROM item_stock_branch sb
  JOIN accurate_item ai ON ai.id = sb.item_id
  WHERE sb.warehouse_kode = 'KEDIRI' ORDER BY ai.no LIMIT 1`;
// Dua kode price book nyata, dipilih deterministik berdasarkan diskon_maks-nya
// (bukan "yang pertama muncul"): createSphDraft menolak diskon di atas plafon
// SKU, jadi skenario "format benar" butuh SKU yang plafonnya ≥ 5% — kalau tidak,
// yang gagal adalah fixture-nya, bukan kodenya, dan itu terbaca seperti regresi.
const [plOk] = await sql`
  SELECT kode, diskon_maks FROM product_pricelist
  WHERE periode = 'H2-2026' AND kode IS NOT NULL AND kode <> '' AND diskon_maks >= 0.05
  ORDER BY kode LIMIT 1`;
const [plNol] = await sql`
  SELECT kode, diskon_maks FROM product_pricelist
  WHERE periode = 'H2-2026' AND kode IS NOT NULL AND kode <> '' AND diskon_maks = 0
  ORDER BY kode LIMIT 1`;

// Gagal DATA jangan menyamar jadi gagal KODE. Tanpa pemeriksaan ini, katalog
// yang kosong muncul sebagai `#SPH RS Fixture Sehat | - | 10 | 5%` lalu dibalas
// 'Kode "-" tak ketemu' — terbaca seperti bug #SPH, padahal seed-nya yang
// belum jalan. Kasus nyata: seed-dev-full.sql TIDAK mengisi product_pricelist
// (data price book nyata tak boleh masuk repo publik), jadi DB baru selalu
// kena ini sampai scripts/qa/seed-hashtag-fixtures.sql dijalankan.
const kurang = [
  !itemStok && "accurate_item + item_stock_branch (gudang KEDIRI) — dibutuhkan #STOK",
  !plOk && "product_pricelist: SKU ber-diskon_maks ≥ 5% — dibutuhkan #SPH",
  !plNol && "product_pricelist: SKU ber-diskon_maks = 0% — dibutuhkan uji plafon #SPH",
].filter(Boolean);
if (kurang.length) {
  console.error(
    [
      "Prasyarat DATA belum lengkap — bukan kegagalan kode:",
      ...kurang.map((k) => `  · ${k}`),
      "",
      "Jalankan seed-nya:",
      "  psql -d wrg_os_dev -f scripts/db/seed-dev.sql             # master_user demo (prasyarat berikutnya)",
      "  psql -d wrg_os_dev -f scripts/db/seed-dev-full.sql        # katalog accurate_item dkk",
      "  psql -d wrg_os_dev -f scripts/qa/seed-hashtag-fixtures.sql",
    ].join("\n"),
  );
  process.exit(1);
}

// ── penangkap balasan ─────────────────────────────────────────────────────
const realLog = console.log;
let captured = [];
console.log = (...args) => {
  const m = args.map(String).join(" ").match(/--- pesan ---\n([\s\S]*?)\n--- selesai ---/);
  if (m) captured.push(m[1]);
};
const restoreLog = () => {
  console.log = realLog;
};

// ── reset state: harness WAJIB bisa dijalankan berulang ───────────────────
// Tanpa ini run ke-2 gagal palsu (SJ sudah kirim, APR sudah approved) dan
// bikin orang mengira ada regresi.
async function resetState() {
  await sql`DELETE FROM wa_message WHERE input_hash LIKE 'qa-sim-%'`;
  await sql`
    UPDATE shipment_tracking SET status='draft', kirim_at=NULL, kirim_by=NULL, kirim_lat=NULL,
      kirim_lon=NULL, kirim_photo_path=NULL, terima_at=NULL, terima_by=NULL,
      bast_at=NULL, bast_by=NULL, bast_lat=NULL, bast_lon=NULL, bast_photo_path=NULL,
      bukti_at=NULL, bukti_by=NULL, bukti_photo_path=NULL, signature_photo_path=NULL,
      distance_km=NULL, eta_days=NULL
    WHERE sj_number IN ('SJ-QA-001','SJ-QA-002','SJ-QA-003')`;
  // SJ-002 siap #BAST → status 'terima'. Langkah terima itu WEB-ONLY (F42
  // #714, Admin Shipping) dan TIDAK punya hashtag, jadi harness menyetelnya
  // langsung; lihat catatan KEDALUWARSA di docs/features/F12-*.md.
  await sql`
    UPDATE shipment_tracking SET status='terima', kirim_at=now() - interval '2 day',
      kirim_by='qa-fixture', kirim_lat=-7.80, kirim_lon=112.00,
      terima_at=now() - interval '1 day', terima_by='qa-fixture'
    WHERE sj_number='SJ-QA-002'`;
  await sql`
    UPDATE shipment_tracking SET status='bast', kirim_at=now() - interval '3 day',
      kirim_by='qa-fixture', terima_at=now() - interval '2 day', terima_by='qa-fixture',
      bast_at=now() - interval '1 day', bast_by='qa-fixture'
    WHERE sj_number='SJ-QA-003'`;
  await sql`
    UPDATE approval_request SET status='pending', current_urutan=1, decided_at=NULL
    WHERE kode IN ('APR-9001','APR-9002','APR-9003')`;
  await sql`
    UPDATE approval_step SET status='pending', decided_by=NULL, decided_at=NULL, decision_note=NULL
    WHERE request_id IN (SELECT id FROM approval_request WHERE kode IN ('APR-9001','APR-9002','APR-9003'))`;
}
// resetState memulangkan baris FIXTURE ke tahap awal. Dilewati kalau fixture
// tak ada — di DB nyata tak ada yang boleh dipulangkan.
if (fixtureAda) await resetState();
else await sql`DELETE FROM wa_message WHERE input_hash LIKE 'qa-sim-%'`;

let seq = 0;
async function kirimPesan({ body, from, type = "text", media = null, geo = null }) {
  seq += 1;
  const hash = `qa-sim-${Date.now()}-${seq}`;
  const [row] = await sql`
    INSERT INTO wa_message (group_jid, group_name, sender_jid, sender_name, message_type, body,
                            input_hash, message_id, media_path, geo_lat, geo_lon)
    VALUES (${GRUP}, 'Grup Simulasi QA', ${from.jid}, ${from.nama}, ${type}, ${body},
            ${hash}, ${hash}, ${media}, ${geo?.lat ?? null}, ${geo?.lon ?? null})
    RETURNING id::text, group_jid, sender_jid, sender_name, body, message_type, message_id,
              received_at::text, media_path, geo_lat, geo_lon, geo_ts, geo_address`;
  captured = [];
  const out = await processInboundMessage(row);
  return { out, balasan: captured.slice() };
}

// ── skenario ──────────────────────────────────────────────────────────────
// `harap` = pola yang WAJIB muncul di balasan. `null` = bot HARUS diam
// (gerbang pengirim / hashtag tanpa tujuan).
// Nama pengirim bisa di-override lewat env, jadi pola harapan disusun runtime.
// Di-escape supaya nama ber-titik/tanda kurung tak jadi metakarakter regex.
const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const skenario = [
  // F2 #STOK — gerbang: resolveSender (master_user)
  { nama: "stok · satu barang cocok", body: `#STOK ${itemStok?.no ?? "-"}`, from: AM, harap: /📦 \*.+\*/ },
  { nama: "stok · barang tak ada", body: "#STOK barangtidakada", from: AM, harap: /tidak ditemukan/ },
  { nama: "stok · argumen kosong", body: "#STOK", from: AM, harap: new RegExp(`⚠️ Isi nama/kode barang setelah #STOK, ${esc(AM.nama)}`) },
  { nama: "stok · pengirim tak dikenal (gerbang)", body: "#STOK FX80", from: ASING, harap: null },

  // F4/QW3 #CEK — gerbang: resolveSender. Isinya data komersial.
  { nama: "cek · varian nomor dokumen", body: "#CEK SO-00123", from: AM, harap: /.+/ },
  { nama: "cek · varian customer", body: "#CEK CUSTOMER RSUD Kota", from: AM, harap: /.+/ },
  { nama: "cek · argumen kosong", body: "#CEK", from: AM, harap: new RegExp(`⚠️ Isi nomor dokumen atau nama customer setelah #CEK, ${esc(AM.nama)}`) },
  { nama: "cek · pengirim tak dikenal (gerbang)", body: "#CEK SO-00123", from: ASING, harap: null },

  // F15 #PRICING
  // Ekspektasi harus menuntut BARIS HASIL, bukan sekadar "ada balasan".
  // Dengan /.+/ , balasan "Tidak ada produk cocok" ikut dianggap lulus — itu
  // yang terjadi di DB baru tanpa fixture price book: #PRICING lolos semu
  // sementara #SPH gagal, padahal penyebabnya sama.
  { nama: "pricing · ada kata kunci", body: "#PRICING reagen", from: AM, harap: /• .+ — List Rp[\d.]+, maks diskon \d+%, floor Rp[\d.]+/ },
  { nama: "pricing · tak ada yang cocok", body: "#PRICING produkyangtidakada", from: AM, harap: /Tidak ada produk cocok "produkyangtidakada" di Price Book/ },
  { nama: "pricing · argumen kosong", body: "#PRICING", from: AM, harap: /⚠️ #PRICING butuh kata kunci/ },
  { nama: "pricing · pengirim tak dikenal (gerbang)", body: "#PRICING reagen", from: ASING, harap: null },

  // F15 #SPH — 4 bagian dipisah "|", diskon wajib bertanda %
  { tulis: true, nama: "sph · format benar", body: `#SPH RS Fixture Sehat | ${plOk?.kode ?? "-"} | 10 | 5%`, from: AM, harap: new RegExp(`✅ Draft SPH tersimpan, ${esc(AM.nama)}`) },
  { nama: "sph · kode tak ada di price book", body: "#SPH RS Fixture Sehat | KODE-NGAWUR | 10 | 5%", from: AM, harap: new RegExp(`⚠️ Kode "KODE-NGAWUR" tak ketemu di Price Book, ${esc(AM.nama)}`) },
  // Plafon diskon per-SKU ditegakkan di createSphDraft — jalur WA pakai fungsi
  // yang SAMA dgn form web, jadi aturannya tak bisa ditembus lewat WA.
  { nama: "sph · diskon di atas plafon SKU", body: `#SPH RS Fixture Sehat | ${plNol?.kode ?? "-"} | 10 | 5%`, from: AM, harap: /melebihi diskon maks SKU ini/ },
  { nama: "sph · diskon tanpa tanda %", body: `#SPH RS Fixture Sehat | ${plOk?.kode ?? "-"} | 10 | 5`, from: AM, harap: /wajib pakai tanda %/ },
  { nama: "sph · bagian kurang dari 4", body: "#SPH RS Fixture Sehat | KODE | 10", from: AM, harap: /4 bagian dipisah/ },

  // DOC-KLAIM #KLAIM — sengaja TANPA gerbang pengirim, tapi wajib foto
  { tulis: true, nama: "klaim · foto + OCR aktif", body: "#KLAIM invoice customer X", from: ASING, type: "image", media: FOTO.klaim, harap: /✅ #KLAIM diterima, foto tersimpan\./ },
  { tulis: true, nama: "klaim · foto + OCR dry-run", body: "#KLAIM dryrun invoice customer X", from: ASING, type: "image", media: FOTO.klaim, harap: /📥 Foto #KLAIM tersimpan\. OCR belum aktif \(mode dry-run\)/ },
  { nama: "klaim · tanpa foto", body: "#KLAIM invoice customer X", from: ASING, harap: /⚠️ #KLAIM wajib disertai foto dokumen/ },
  // services/ai mati HARUS dibalas sopan, bukan melempar & merobohkan batch.
  { nama: "klaim · services/ai mati", body: "#KLAIM invoice customer X", from: ASING, type: "image", media: FOTO.klaim, matikanAi: true, harap: /⚠️ Gagal proses #KLAIM: services\/ai .* status 503/ },

  // F8 readiness board — gerbang: matchTeknisiByName (pushname → teknisi_capacity)
  { tulis: true, nama: "install · teknisi dikenal", body: "#install Alat X terpasang", from: TEKNISI, harap: new RegExp(`✅ Laporan #INSTALL tercatat — ${esc(TEKNISI.nama)}\\.`) },
  { tulis: true, nama: "servis · teknisi dikenal", body: "#servis Ganti part", from: TEKNISI, harap: new RegExp(`✅ Laporan #SERVIS tercatat — ${esc(TEKNISI.nama)}\\.`) },
  { tulis: true, nama: "training · teknisi dikenal", body: "#training Training operator", from: TEKNISI, harap: new RegExp(`✅ Laporan #TRAINING tercatat — ${esc(TEKNISI.nama)}\\.`) },
  { tulis: true, nama: "kalibrasi · teknisi dikenal", body: "#kalibrasi Kalibrasi alat X selesai", from: TEKNISI, harap: new RegExp(`✅ Laporan #KALIBRASI tercatat — ${esc(TEKNISI.nama)}\\.`) },
  { nama: "kalibrasi · bukan teknisi (gerbang)", body: "#kalibrasi Alat X", from: ASING, harap: null },
  // Hashtag polos tanpa deskripsi TIDAK boleh tersimpan sbg laporan sah.
  { nama: "install · teks kosong", body: "#install", from: TEKNISI, harap: new RegExp(`⚠️ #INSTALL terdeteksi tapi teks kosong, ${esc(TEKNISI.nama)}`) },

  // F12/F42/F93 shipping — sengaja TANPA gerbang (kurir tak punya roster)
  { tulis: true, nama: "kirim · SJ ada", body: "#KIRIM SJ-QA-001", from: ASING, type: "image", media: FOTO.kirim, geo: { lat: -7.82, lon: 112.01 }, harap: /✅ SJ SJ-QA-001 \(RSUD Fixture Kediri\) ditandai \*DIKIRIM\*\./ },
  { tulis: true, nama: "bast · SJ sudah terima", body: "#BAST SJ-QA-002", from: ASING, type: "image", media: FOTO.bast, geo: { lat: -7.81, lon: 112.02 }, harap: /✅ SJ SJ-QA-002 \(Klinik Fixture Kediri\) ditandai \*BAST\/SELESAI\*\./ },
  { tulis: true, nama: "bukti · SJ sudah bast", body: "#BUKTI SJ-QA-003", from: ASING, type: "image", media: FOTO.bukti, harap: /✅ SJ SJ-QA-003 \(Lab Fixture Kediri\) ditandai \*BUKTI TERSIMPAN\*\./ },
  // Galat state machine harus jadi instruksi yang bisa dikerjakan kurir —
  // langkah `terima` web-only, jadi balasannya wajib menyebut siapa dimintai.
  { nama: "bast · SJ baru dikirim, belum terima", body: "#BAST SJ-QA-001", from: ASING, harap: /⚠️ SJ SJ-QA-001 belum ditandai TERIMA, jadi belum bisa BAST\. Minta admin tandai penerimaan dulu di menu Shipping/ },
  { nama: "bukti · SJ belum BAST", body: "#BUKTI SJ-QA-001", from: ASING, harap: /⚠️ SJ SJ-QA-001 belum BAST, jadi bukti terima belum bisa diunggah/ },
  { nama: "kirim · SJ sudah pernah dikirim", body: "#KIRIM SJ-QA-002", from: ASING, harap: /⚠️ SJ SJ-QA-002 sudah pernah ditandai KIRIM — tak perlu #KIRIM lagi/ },
  { nama: "kirim · nomor SJ kosong", body: "#KIRIM", from: ASING, harap: /⚠️ Format #KIRIM tak lengkap — sertakan No\. SJ/ },
  { nama: "kirim · SJ tak ketemu", body: "#KIRIM SJ-9999-999", from: ASING, harap: /⚠️ SJ "SJ-9999-999" tidak ditemukan di tracking pengiriman\./ },

  // F139 #HELPDESK — sengaja TANPA gerbang
  { tulis: true, nama: "helpdesk · ada deskripsi", body: "#HELPDESK AC ruang meeting mati total", from: ASING, harap: /✅ Tiket TKT-\d{4}-\d+ dibuat \(.+\), status: open\./ },
  { nama: "helpdesk · teks kosong", body: "#HELPDESK", from: ASING, harap: /⚠️ #HELPDESK terdeteksi tapi teks kosong/ },

  // F11 approval — gerbang: resolveApprover (app_user, BUKAN master_user)
  { tulis: true, nama: "approve · tahap terakhir", body: "#APPROVE APR-9001 oke lanjutkan", from: HOD, harap: new RegExp(`✅ APR-9001 disetujui \\(tahap terakhir\\) — request selesai\\. Terima kasih, ${esc(HOD.nama)}\\.`) },
  { tulis: true, nama: "approve · lanjut tahap berikutnya", body: "#APPROVE APR-9002", from: HOD, harap: new RegExp(`✅ APR-9002 disetujui, lanjut ke tahap berikutnya\\. Terima kasih, ${esc(HOD.nama)}\\.`) },
  { tulis: true, nama: "reject · ditolak", body: "#REJECT APR-9003 nominal terlalu besar", from: HOD, harap: new RegExp(`❌ APR-9003 ditolak, tercatat\\. Terima kasih, ${esc(HOD.nama)}\\.`) },
  { nama: "approve · kode salah format", body: "#APPROVE 9001", from: HOD, harap: /tidak valid, format: APR-0001/ },
  { nama: "approve · bukan approver (gerbang)", body: "#APPROVE APR-9001", from: ASING, harap: null },
];

const cocokNama = (s) => !filter.length || filter.some((f) => s.nama.toLowerCase().includes(f));
const dipakai = skenario.filter((s) => cocokNama(s) && !(BACA_SAJA && s.tulis));
const dilewati = skenario.filter((s) => cocokNama(s) && BACA_SAJA && s.tulis);

const hasil = [];
for (const s of dipakai) {
  const aiUrlAsli = process.env.AI_URL;
  if (s.matikanAi) process.env.AI_URL = "http://127.0.0.1:9"; // port mati
  let out = {};
  let balasan = [];
  let err = null;
  try {
    ({ out, balasan } = await kirimPesan(s));
  } catch (e) {
    err = e.message;
  } finally {
    process.env.AI_URL = aiUrlAsli;
  }
  const teks = balasan.join("\n~~~\n");
  const status = err ? "ERROR" : s.harap === null ? (balasan.length === 0 ? "COCOK" : "BEDA") : s.harap.test(teks) ? "COCOK" : "BEDA";
  hasil.push({ nama: s.nama, kirim: s.body, status, teks, err, out, harap: s.harap, tulis: !!s.tulis });
}

// ── uji khusus: #BUKTI teks-saja HARUS terjaring processUnprocessed ───────
// Regresi nyata pernah terjadi di sini: `bukti` hilang dari regex penyaring
// sehingga #BUKTI tanpa foto tak pernah terpilih. Paritas daftar hashtag-nya
// dijaga tes murni (inbound-kind-filter.test.ts); ini uji jalur DB-nya.
//
// Ditandai TULIS: menyasar SJ-QA-003 dan memajukan statusnya, jadi dilewati di
// mode --baca-saja. Paritas hashtag-nya sendiri tetap terjaga tes murni yang
// jalan di CI, jadi melewatinya di sini tak meninggalkan lubang.
await sql`UPDATE wa_message SET processed_at = now(), processed_kind = 'qa-cleanup'
          WHERE input_hash LIKE 'qa-sim-%' AND processed_at IS NULL`;
let buktiTerjaring = null; // null = tak diuji (mode baca-saja)
let batchErr = null;
try {
  if (!BACA_SAJA) {
    const hb = `qa-sim-bukti-teks-${Date.now()}`;
    await sql`
      INSERT INTO wa_message (group_jid, sender_jid, sender_name, message_type, body, input_hash, message_id)
      VALUES (${GRUP}, ${ASING.jid}, ${ASING.nama}, 'text', '#BUKTI SJ-QA-003', ${hb}, ${hb})`;
    captured = [];
    const batch = await processUnprocessed(50);
    buktiTerjaring = batch.results.some((r) => String(r.kind) === "bukti");
  }
} catch (e) {
  batchErr = e.message;
}

restoreLog();
aiStub.close();

// ── laporan ───────────────────────────────────────────────────────────────
const lebar = Math.max(...hasil.map((h) => h.nama.length), 1);
console.log("\n=============== SIMULASI COMMAND HASHTAG WA ===============");
console.log(
  `Mode: ${BACA_SAJA ? "BACA-SAJA (skenario tulis dilewati)" : "PENUH (baca + tulis)"}` +
    `  ·  Data: ${fixtureAda ? "FIXTURE (QA-*)" : "APA ADANYA (fixture tak ada)"}\n`,
);
for (const h of hasil) {
  const tanda = h.status === "COCOK" ? "✓" : h.status === "BEDA" ? "✗" : "!";
  console.log(`${tanda} [${h.status}] ${h.tulis ? "TULIS" : "BACA "} ${h.nama.padEnd(lebar)}  ← ${h.kirim}`);
  if (h.err) console.log(`      ERROR: ${h.err}`);
  else if (h.teks) console.log(h.teks.split("\n").map((l) => "      │ " + l).join("\n"));
  else console.log(`      │ (diam — kind=${h.out?.kind}, ${JSON.stringify(h.out?.skipped ?? h.out?.error ?? "")})`);
  if (h.status === "BEDA") console.log(`      HARAP: ${h.harap ?? "(diam)"}`);
  console.log("");
}

// Cakupan yang TIDAK diuji harus kelihatan. Mode baca-saja yang melaporkan
// "semua hijau" tanpa menyebut apa yang dilewati terbaca seperti verifikasi
// penuh — padahal justru command paling berisiko yang tak ikut diuji.
if (dilewati.length) {
  console.log(`── ${dilewati.length} skenario TULIS dilewati (--baca-saja) ──`);
  for (const s of dilewati) console.log(`  · ${s.nama}`);
  console.log("");
}

const n = (st) => hasil.filter((h) => h.status === st).length;
const nTulis = hasil.filter((h) => h.tulis).length;
console.log("===========================================================");
console.log(
  `total=${hasil.length} (baca=${hasil.length - nTulis} tulis=${nTulis})  ` +
    `cocok=${n("COCOK")}  beda=${n("BEDA")}  error=${n("ERROR")}  dilewati=${dilewati.length}`,
);
console.log(
  `#BUKTI teks-saja terjaring processUnprocessed: ${
    buktiTerjaring === null ? "tak diuji (mode baca-saja)" : buktiTerjaring ? "YA" : "TIDAK ← REGRESI"
  }`,
);
if (batchErr) console.log(`processUnprocessed melempar: ${batchErr}`);
console.log(`detectKind("#BUKTI SJ-1") = ${detectKind("#BUKTI SJ-1")}`);
console.log(`\nBersihkan baris sintetis: DELETE FROM wa_message WHERE input_hash LIKE 'qa-sim-%';`);

await sql.end();
// buktiTerjaring === null (tak diuji) tak dihitung gagal.
process.exit(n("BEDA") + n("ERROR") === 0 && buktiTerjaring !== false && !batchErr ? 0 : 1);
