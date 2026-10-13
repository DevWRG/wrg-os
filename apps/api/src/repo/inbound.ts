import { db } from "../db.js";
import { detectDaily, parseDaily, stripInvisible } from "../parsers/dailyplan.js";
import { parseAmPlan, parseAmReport, bersihkanNamaCustomer } from "../parsers/am.js";
import { sendViaWaGateway, type WaSendResult } from "../wasend.js";
import { handleSalesAnalyticsQuery } from "./inbound-sales-analytics.js";
import { balasanKampanye, scopeDariPengirim } from "./campaign.js";
import { balasanBrief } from "./customer-intel.js";
import { resolveSender } from "./master.js";
import { upsertDailyTodo, computeIsLate } from "./todo.js";
import { createReminder } from "./reminder.js";
import {
  ingestKoran,
  kataKategoriTersedia,
  nyatakanNihil,
  parseNihil,
  parseTriage,
  triageDariWa,
  type IngestKoranResult,
} from "./cashin.js";
import { parseApprovalMessage } from "../parsers/approval.js";
import { resolveApprover } from "./approval.js";
import { parseOvertimeArg, formatDurasi } from "../parsers/overtime.js";
import { getPengajuProfile, submitOvertime, decideOvertime } from "./overtime.js";
import {
  parseInteraksi,
  cariAkun,
  catatInteraksi,
  balasanFormat,
  balasanAmbiguInteraksi,
  balasanTercatat,
} from "./interaction.js";
import { parseLeads, contohLeads, leadsJadiDeal, balasanLeadsDeal } from "./lead.js";
import {
  parseDemoTrial,
  balasanFormatDT,
  resolusiFaskes,
  bukaDemoTrial,
  tutupDemoTrial,
  balasanBuka,
  balasanAmbiguDT,
  balasanTutup,
  wibHariIni,
  DemoTrialError,
} from "./demo-trial.js";
import { FULL_SCOPE } from "./access-scope.js";
import { buildFakturReply } from "./faktur.js";
import { syncDeliveryOrders } from "./accurateSync.js";
import {
  findBySjNumber,
  markKirim,
  markTerima,
  markBast,
  markBukti,
  pelakuShippingWa,
  createShipment,
  parseSjRef,
  cariDoAccurate,
  cabangDariNomorSj,
  type DoAccurate,
} from "./shipment-tracking.js";
import { accountIdDariTulisan } from "./akun-faskes.js";

// Role yang pakai alur AM per-customer (sales_plan/activity_log + foto), bukan todo.
const AM_ROLES = new Set(["AM", "Teknisi"]);
const isAmRole = (role?: string | null) => AM_ROLES.has((role ?? "").trim());

// Pemrosesan inbound WA (#PLAN/#REPORT/#LEADS/#UPDATE) — pengganti legacy
// wrg-inbound.sh. Format NYATA tim (lihat parsers/dailyplan.ts): #plan/#report
// + nama + daftar bernomor (TODO harian). Alur: resolve pengirim → parse →
// sales_todo → balas grup.
//
// GATED: hanya jalan bila WA_INBOUND_PROCESS=true. Balasan via sendViaWaGateway
// → patuh WA_DRY_RUN. Idempoten: wa_message.processed_at. Pengirim tak dikenal →
// SILENT (tak balas) supaya tak spam non-AM/pesan bot di grup campuran.

export type InboundKind =
  | "plan"
  | "report"
  | "leads"
  | "update"
  | "sales"
  | "koran"
  | "overtime"
  | "faktur"
  | "approve"
  | "reject"
  | "call"
  | "note"
  | "kirim"
  | "terima"
  | "bast"
  | "bukti"
  | "demo"
  | "trial"
  | "kampanye"
  | "brief"
  | "none";

// Hashtag yang dijaring processUnprocessed. Diekspor supaya diuji berpasangan
// dengan detectKind (inbound-kind-filter.test.ts): dulu ditulis inline di SQL
// dan sudah menyimpang — `faktur` dikenali detectKind tapi HILANG dari regex
// penyaring, jadi #FAKTUR teks di main tak pernah diproses sama sekali.
// (dev menutup kelas bug ini dengan INBOUND_HASHTAGS sebagai sumber tunggal.)
export const INBOUND_FILTER_KINDS = [
  "plan", "report", "leads", "update", "sales", "koran", "overtime", "faktur", "approve", "reject", "call", "note",
  "kirim", "terima", "bast", "bukti", "demo", "trial", "kampanye", "brief",
] as const;
export const inboundHashtagPattern = (): string => `#\\s*(${INBOUND_FILTER_KINDS.join("|")})`;

const LEADS_UPDATE_LINE = /^\s*#\s*(leads|update)\b/i;
const SALES_LINE = /^\s*#\s*sales\b/i;
// F-CASHIN — setoran rekening koran harian dari admin Finance.
const KORAN_LINE = /^\s*#\s*koran\b/i;
// #OVERTIME — pengajuan lembur SEBELUM lembur (migrasi 199, repo/overtime.ts).
const OVERTIME_LINE = /^\s*#\s*overtime\b/i;
// F91 — cek status satu invoice. `\b` penting: #FAKTURIS (nama grup/fitur
// F149) tidak boleh ikut terpicu.
const FAKTUR_LINE = /^\s*#\s*faktur\b/i;
// #APPROVE/#REJECT <kode> [alasan] — di main HANYA melayani kode OT-xxxx
// (lembur). Engine approval F11 (APR-xxxx) belum dipromosikan ke main.
const APPROVE_REJECT_LINE = /^\s*#\s*(approve|reject)\b/i;
// F95 — #CALL/#NOTE per faskes ke interaction_log (repo/interaction.ts). `\b`
// menjaga #NOTES / #CALLBACK dkk tak ikut terpicu.
const INTERAKSI_LINE = /^\s*#\s*(call|note)\b/i;
// F18 — #DEMO / #TRIAL: buka (faskes: alat) atau tutup (DM-/TR-xxxx hasil).
const DEMO_TRIAL_LINE = /^\s*#\s*(demo|trial)\b/i;
// F74 — #KAMPANYE (baca progres kampanye; tak menulis apa pun).
const KAMPANYE_LINE = /^\s*#\s*kampanye\b/i;
// F131 — #BRIEF <faskes>: briefing pra-kunjungan (baca saja).
const BRIEF_LINE = /^\s*#\s*brief\b/i;
// F12/F42/F93 — hashtag SHIPPING dari kurir: "#KIRIM SJK 6142" / "#TERIMA SJK
// 6142" / "#BAST SJK 6142" / "#BUKTI SJK 6142" (caption foto atau teks biasa;
// rujukan SJ = jenis + angka urut DO Accurate, lihat parseSjRef).
const SHIPPING_LINE = /^\s*#\s*(kirim|terima|bast|bukti)\b\s*(.*)$/i;

function extractHashtagArg(body: string | null, lineRegex: RegExp): string {
  if (!body) return "";
  const line = stripInvisible(body).split(/\r?\n/).find((l) => lineRegex.test(l)) ?? "";
  return line.replace(lineRegex, "").trim();
}

export function detectKind(body: string | null): InboundKind {
  const daily = detectDaily(body); // line-anchored #plan/#report (sudah strip invisible)
  if (daily) return daily;
  if (body) {
    for (const line of stripInvisible(body).split(/\r?\n/)) {
      const m = line.match(LEADS_UPDATE_LINE);
      if (m) return m[1].toLowerCase() as "leads" | "update";
      if (SALES_LINE.test(line)) return "sales";
      if (KORAN_LINE.test(line)) return "koran";
      const ar = line.match(APPROVE_REJECT_LINE);
      if (ar) return ar[1].toLowerCase() as "approve" | "reject";
      if (OVERTIME_LINE.test(line)) return "overtime";
      if (FAKTUR_LINE.test(line)) return "faktur";
      const ia = line.match(INTERAKSI_LINE);
      if (ia) return ia[1].toLowerCase() as "call" | "note";
      const dt = line.match(DEMO_TRIAL_LINE);
      if (dt) return dt[1].toLowerCase() as "demo" | "trial";
      const sh = line.match(SHIPPING_LINE);
      if (sh) return sh[1].toLowerCase() as "kirim" | "terima" | "bast" | "bukti";
      if (KAMPANYE_LINE.test(line)) return "kampanye";
      if (BRIEF_LINE.test(line)) return "brief";
    }
  }
  return "none";
}

// Terjemahkan galat guard state machine shipment jadi instruksi yang bisa
// dikerjakan KURIR di lapangan (pesan asli shipment-tracking.ts menyebut nama
// state internal).
function pesanGagalShipping(sjNumber: string, error?: string): string {
  const e = error ?? "";
  if (e.includes("langkah bast sudah dilakukan")) {
    return `SJ ${sjNumber} sudah pernah ditandai BAST — tak perlu #BAST lagi. Kalau mau lanjut, pakai #BUKTI.`;
  }
  if (e.includes("langkah terima belum ditandai")) {
    return `SJ ${sjNumber} belum ditandai TERIMA, jadi belum bisa BAST. Kirim #TERIMA dulu, lalu #BAST lagi.`;
  }
  if (e.includes("BAST belum selesai")) {
    return `SJ ${sjNumber} belum BAST, jadi bukti terima belum bisa diunggah. Selesaikan #BAST dulu, lalu kirim #BUKTI lagi.`;
  }
  if (e.includes("langkah kirim sudah dilakukan")) {
    return `SJ ${sjNumber} sudah pernah ditandai KIRIM — tak perlu #KIRIM lagi. Langkah berikutnya #TERIMA saat barang sampai.`;
  }
  if (e.includes("langkah terima sudah dilakukan")) {
    return `SJ ${sjNumber} sudah pernah ditandai TERIMA — langkah berikutnya #BAST.`;
  }
  if (e.includes("terima otomatis sudah lewat")) {
    return `SJ ${sjNumber} sudah BAST — tak perlu #TERIMA lagi.`;
  }
  if (e.includes("langkah kirim belum selesai")) {
    return `SJ ${sjNumber} belum ditandai KIRIM. Kirim #KIRIM dulu saat berangkat.`;
  }
  return `Gagal update SJ ${sjNumber}: ${e}`;
}

// Ambil rujukan SJ dari baris hashtag shipping — SELURUH sisa baris, karena
// bentuk ringkas terdiri dari beberapa token ("SJK 6142 JKT"). Diurai parseSjRef.
function extractSjArg(body: string | null): string | null {
  if (!body) return null;
  for (const line of stripInvisible(body).split(/\r?\n/)) {
    const m = line.match(SHIPPING_LINE);
    if (m && m[2].trim()) return m[2].trim();
  }
  return null;
}

// Saklar klaster shipping (#KIRIM/#TERIMA/#BAST/#BUKTI). Default MATI: di prod
// WA_INBOUND_PROCESS sudah true, jadi tanpa saklar ini kode yang masuk main
// langsung membalas di grup sebelum alurnya disosialisasikan ke kurir.
export function isShippingWaEnabled(): boolean {
  return (process.env.WA_SHIPPING_ENABLED ?? "false").toLowerCase() === "true";
}

// DO Accurate disinkron terjadwal (ACCURATE_SYNC_CRON, default jam 10–20 hari
// kerja) — SJ yang dibuat pagi belum ada di mirror saat kurir berangkat. Kalau
// rujukan tak ketemu, tarik 1 halaman DO terbaru (100 baris) lalu cari ulang.
// Dibatasi sekali per menit supaya salah ketik beruntun tak membanjiri Accurate.
let segarDoTerakhir = 0;
async function segarkanDoTerbaru(): Promise<boolean> {
  if (Date.now() - segarDoTerakhir < 60_000) return false;
  segarDoTerakhir = Date.now();
  try {
    const r = await syncDeliveryOrders({ maxPages: 1 });
    return r.ok;
  } catch (e) {
    console.error("[inbound] segarkan DO Accurate gagal:", e);
    return false;
  }
}

async function cariDoUntukWa(arg: string): Promise<DoAccurate[]> {
  const ref = parseSjRef(arg);
  if (!ref) return [];
  const ada = await cariDoAccurate(ref);
  if (ada.length) return ada;
  return (await segarkanDoTerbaru()) ? cariDoAccurate(ref) : [];
}

export function isInboundEnabled(): boolean {
  return (process.env.WA_INBOUND_PROCESS ?? "false").toLowerCase() === "true";
}

const wibDate = (): string => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function allowedGroups(): string[] {
  return (process.env.WA_INBOUND_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function groupAllowed(jid: string): boolean {
  const g = allowedGroups();
  return g.length === 0 || g.includes(jid);
}

export interface WaRow {
  id: string;
  group_jid: string;
  sender_jid: string | null;
  sender_name: string | null;
  body: string | null;
  message_type: string | null;
  message_id: string | null;
  received_at: string;
  media_path?: string | null;
  geo_lat?: number | null;
  geo_lon?: number | null;
  geo_ts?: string | null;
  geo_address?: string | null;
}

// #REPORT → tandai sales_todo hari itu reported + simpan report_data. Buat baris
// bila plan hari itu belum ada (report tanpa plan).
const REPORT_AUTO_MATCH = 0.7;

interface ReportOutcome {
  n: number;
  matched: number;
  baru: number;
  newItems: string[];
  planExists: boolean;
}

// #REPORT → cocokkan tiap item report vs item #PLAN hari itu (pg_trgm
// GREATEST(similarity, word_similarity(plan,report)) ≥ 0.70 = matched, port
// legacy). Simpan report_data + tandai reported. Return breakdown utk balasan.
async function markReported(
  amId: string,
  amName: string | null,
  tanggal: string,
  items: string[],
  rawBody: string,
): Promise<ReportOutcome> {
  const sql = db();
  const [plan] = await sql`
    SELECT items FROM sales_todo WHERE am_id = ${amId} AND tanggal = ${tanggal}
    ORDER BY submitted_at DESC NULLS LAST LIMIT 1
  `;
  const planItems: string[] = Array.isArray(plan?.items) ? (plan.items as string[]) : [];
  const planArr = planItems.length ? planItems : [""];

  const scored = items.length
    ? await sql`
        SELECT r.item AS task,
          COALESCE((
            SELECT max(greatest(similarity(r.item, p.item), word_similarity(p.item, r.item)))
            FROM unnest(${planArr}::text[]) p(item) WHERE p.item <> ''
          ), 0) AS score
        FROM unnest(${items}::text[]) WITH ORDINALITY r(item, ord)
        ORDER BY r.ord
      `
    : [];
  const rd = scored.map((r) => ({
    task: String(r.task),
    score: Number(r.score),
    matched: Number(r.score) >= REPORT_AUTO_MATCH,
  }));
  const matched = rd.filter((x) => x.matched).length;
  const newItems = rd.filter((x) => !x.matched).map((x) => x.task);

  await sql`
    INSERT INTO sales_todo (am_id, am_name, tanggal, items, raw_body, reported, reported_at, report_data)
    VALUES (${amId}, ${amName}, ${tanggal},
            ${sql.json(items as unknown as Parameters<typeof sql.json>[0])}, ${rawBody},
            true, now(), ${sql.json(rd as unknown as Parameters<typeof sql.json>[0])})
    ON CONFLICT (am_id, tanggal) DO UPDATE SET
      reported = true, reported_at = now(),
      report_data = ${sql.json(rd as unknown as Parameters<typeof sql.json>[0])},
      am_name = COALESCE(EXCLUDED.am_name, sales_todo.am_name)
  `;
  return { n: items.length, matched, baru: newItems.length, newItems, planExists: !!plan };
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function fmtTanggalDisplay(tanggal: string): string {
  const d = new Date(`${tanggal.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return tanggal;
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MO[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function buildReportReply(nama: string, tanggal: string, r: ReportOutcome): string {
  let s = `✅ Report tercatat, ${nama}\n\n📅 ${fmtTanggalDisplay(tanggal)}\n🗒️ ${r.n} tasklist reported\n🎯 Match plan: ${r.matched} ✓`;
  if (r.baru > 0) s += `  ⚠️ Baru : ${r.baru}`;
  if (r.baru > 0) {
    s += `\n━━━━━━━━━━━━━━━━━━━━`;
    for (const it of r.newItems) s += `\n  ⚠️ ${it}`;
  }
  if (!r.planExists) s += `\n⚠️ Tidak ada #PLAN hari ini untuk match.`;
  return s;
}

function progressBar(filled: number, total: number): string {
  if (total <= 0) return "";
  const f = Math.max(0, Math.min(total, filled));
  return "▓".repeat(f) + "░".repeat(total - f);
}

// Balasan #REPORT AM — selaras format legacy "Kapten" (EOD + progress + foto pending).
// Diekspor untuk diuji tanpa DB (repo/inbound-reply.test.ts).
export function buildAmReportReply(
  nama: string,
  tanggal: string,
  n: number,
  res: { matched: number; unmatched: number; unmatchedNames?: string[] },
  planTotal: number,
  reported: number,
  pendingPhoto: string[],
  // Foto sudah menempel TAPI tanpa koordinat. Dibedakan dari pendingPhoto
  // (foto belum ada sama sekali) karena obatnya beda — lihat blok di bawah.
  tanpaGeo: { customer: string; adaOverlay: boolean }[] = [],
): string {
  let s = `✅ Report EOD tercatat, ${nama}\n\n📅 ${fmtTanggalDisplay(tanggal)}\n🗒️ ${n} customer reported`;
  if (planTotal > 0) s += `\n📊 ${reported}/${planTotal} customer selesai  ${progressBar(reported, planTotal)}`;
  s += `\n🎯 Match plan: ${res.matched}✓`;
  if (res.unmatched > 0) s += ` ${res.unmatched}⚠️`;
  // Nama customer yang tak match SELALU disebut. Tanpa ini AM cuma melihat
  // "1⚠️" dan tak punya cara tahu customer mana yang gagal dicocokkan —
  // datanya sudah ada di unmatchedNames, dulu hanya tidak dicetak.
  const namesTakMatch = res.unmatchedNames ?? [];
  if (namesTakMatch.length > 0) {
    s += `\n\n⚠️ *Di luar #PLAN hari ini (${namesTakMatch.length} customer):*\n${namesTakMatch.join(", ")}`;
    s += "\n\nKalau memang dikunjungi, kirim ulang #PLAN lengkap (semua customer hari ini) lalu #REPORT lagi — biar terhitung selesai.";
  }
  if (pendingPhoto.length > 0) {
    s += `\n\n⚠️ *Foto visit belum ada (${pendingPhoto.length} customer):*\n${pendingPhoto.join(", ")}`;
    s += "\n\nKirim foto Geo-Tagging Camera per customer dgn caption `Nama Customer` — fuzzy match auto-pair ke pending.";
  }
  // Foto menempel tapi TANPA koordinat = kunjungan tak pernah masuk menu Visits
  // (`sales_plan.visit_lat IS NOT NULL`, repo/visit.ts). Sebelum blok ini balasan
  // justru bilang "✅ Semua foto visit lengkap." — AM diberi tahu berhasil padahal
  // visitnya tak terhitung, dan tak punya cara tahu. Cakupan geotag Arif 24%,
  // Aulia 40% (vs Sidqi 88%) bertahan berbulan-bulan karena kegagalannya senyap.
  if (tanpaGeo.length > 0) {
    const tanpaOverlay = tanpaGeo.filter((g) => !g.adaOverlay).map((g) => g.customer);
    const ocrGagal = tanpaGeo.filter((g) => g.adaOverlay).map((g) => g.customer);
    s += `\n\n⚠️ *Foto tanpa koordinat (${tanpaGeo.length} customer)* — visit belum terhitung di menu Visits:`;
    // Dua sebab, dua obat. Tanpa overlay = fotonya memang bukan dari kamera
    // geotag; koordinat gagal dibaca = overlay ada (jamnya kebaca) tapi baris
    // Lat/Long terpotong — cukup kirim ulang, tak perlu kunjungan ulang.
    if (tanpaOverlay.length > 0) {
      s += `\n• Tanpa overlay geotag: ${tanpaOverlay.join(", ")} — foto ulang pakai Geo-Tagging Camera. Kirim ulang dari galeri tak menolong, overlay-nya tak ikut.`;
    }
    if (ocrGagal.length > 0) {
      s += `\n• Koordinat gagal dibaca: ${ocrGagal.join(", ")} — kirim ulang fotonya, pastikan baris \`Lat … Long …\` utuh dan tak tertutup jari/stiker.`;
    }
  }
  if (pendingPhoto.length === 0 && tanpaGeo.length === 0) {
    s += `\n✅ Semua foto visit lengkap.`;
  }
  return s;
}

/**
 * Tempelkan foto pesan `#REPORT` ke baris aktivitas yang LAHIR dari pesan itu.
 *
 * processInboundMessage() hanya menjalankan photoFollowup() saat
 * `kind === "none"` — yaitu foto TANPA caption berhashtag. Padahal banyak AM
 * melapor dengan foto ber-caption `#Report / Cust : X / Hasil : …`; pesan itu
 * dirutekan ke jalur laporan, dan fotonya sendiri TIDAK PERNAH terpasang.
 *
 * Akibatnya di produksi: dari 1.250 baris activity_log yang berasal dari foto
 * ber-caption #Report, 1.235 (98,8%) `photo_path`-nya NULL dan 1.242
 * `photo_geotag`-nya NULL — padahal OCR sudah mengekstrak koordinatnya ke
 * `wa_message.geo_lat`. Sidqi 589/589 (100%), Vicky 174/174, Firman 124/124.
 * Dua akibat yang terlihat: kolom Geotag di kartu kunjungan nol untuk AM yang
 * fotonya justru lengkap, dan bot menagih "Foto visit belum ada" untuk foto
 * yang baru saja dikirim AM.
 *
 * Dipasang SEBELUM daftar `pending` foto dihitung, supaya balasan tidak lagi
 * menagih foto yang sudah menempel.
 */
async function tempelFotoLaporan(row: WaRow, tanggal: string): Promise<Record<string, unknown> | null> {
  if (!String(row.message_type ?? "").toLowerCase().startsWith("image") || !row.media_path) return null;
  const sql = db();
  const hasGeo = row.geo_lat != null && row.geo_lon != null;
  // Jam overlay tetap dipakai walau koordinatnya gagal terbaca OCR — aplikasi
  // kamera Luri/Iqbal sering kehilangan digit koordinat tapi jamnya utuh. Tanpa
  // ini visit_timestamp mereka selalu null dan date_mismatch tak pernah jalan.
  const g = parseGeoTs(row.geo_ts);
  const adaGeo = hasGeo || g.dt != null;
  const geo = adaGeo
    ? { lat: row.geo_lat ?? null, lon: row.geo_lon ?? null, ts: row.geo_ts ?? null, address: row.geo_address ?? null }
    : null;
  const rows = await sql<{ id: string; plan_id: string | null }[]>`
    UPDATE activity_log SET photo_path = ${row.media_path},
      photo_geotag = ${geo ? sql.json(geo as unknown as Parameters<typeof sql.json>[0]) : null}
    WHERE message_id = ${row.message_id} AND photo_path IS NULL
    RETURNING id, plan_id`;
  if (rows.length === 0) return { foto: "tak-ada-baris" };
  let plan = 0;
  if (adaGeo) {
    for (const r of rows) {
      if (!r.plan_id) continue;
      await sql`
        UPDATE sales_plan
           SET visit_lat = COALESCE(${row.geo_lat ?? null}::numeric, visit_lat),
               visit_lon = COALESCE(${row.geo_lon ?? null}::numeric, visit_lon),
               visit_timestamp = COALESCE(${g.dt}::timestamptz, visit_timestamp),
               visit_date_mismatch = COALESCE(${g.iso ? g.iso !== tanggal : null}::boolean, visit_date_mismatch)
         WHERE id = ${Number(r.plan_id)}`;
      plan += 1;
    }
  }
  return { foto_terpasang: rows.length, geo: hasGeo, jam: g.dt != null, plan_geo_diperbarui: plan };
}

// ── Alur AM per-customer ──
// #PLAN AM → sales_plan (per customer). Re-submit: hapus plan belum-direport
// hari itu lalu insert ulang (preserve yg sudah reported). seq lanjut dari max.
async function insertSalesPlan(
  amId: string,
  tanggal: string,
  customers: { customer: string; tujuan: string; goal: string }[],
  role: string | null | undefined,
  submittedAt: string | Date,
): Promise<{ count: number; late: boolean }> {
  const sql = db();
  const late = computeIsLate(tanggal, role, submittedAt);
  await sql`DELETE FROM sales_plan WHERE am_id = ${amId} AND tanggal = ${tanggal} AND reported = false`;
  const [{ maxseq }] = await sql`SELECT COALESCE(max(seq), 0) AS maxseq FROM sales_plan WHERE am_id = ${amId} AND tanggal = ${tanggal}`;
  let seq = Number(maxseq);
  for (const c of customers) {
    seq += 1;
    await sql`
      INSERT INTO sales_plan (am_id, tanggal, customer_name, tujuan, goal, seq, is_late_plan, submitted_at)
      VALUES (${amId}, ${tanggal}, ${c.customer}, ${c.tujuan || null}, ${c.goal || null}, ${seq}, ${late}, ${new Date(submittedAt)})
    `;
  }
  return { count: customers.length, late };
}

// Ambang fuzzy resolusi Account: lebih ketat dari match plan (0.3) karena hasilnya
// nempel permanen ke Account 360 (F62) & feed NPK/insentif, sementara salah-match
// plan cuma mempengaruhi status reported hari itu.
const ACCOUNT_MATCH = 0.45;

// customer_name bebas-teks → account_id (mirror Accurate) + opportunity_id (deal
// terbuka milik AM tsb). Best-effort: gagal resolve = NULL, bukan error — #REPORT
// tak boleh ditolak cuma karena nama faskes belum ada di mirror.
async function resolveActivityLinks(
  amId: string,
  customer: string,
): Promise<{ accountId: number | null; opportunityId: string | null }> {
  const sql = db();
  // Penaut sadar-jenis (akun-faskes.ts). Trigram nama utuh yang dulu dipakai di
  // sini gagal pada 83% laporan (nama Accurate terbalik + awalan "Cust :") dan
  // salah tempel sisanya (PMI → PKM/PLN) — 13 Okt 2026.
  const accountId = await accountIdDariTulisan(customer);

  // Deal terbuka (belum Closing-*) milik AM ini: match by account_id, fallback
  // fuzzy facility_name. Terbaru duluan — aktivitas biasanya untuk deal berjalan.
  const [deal] = await sql`
    SELECT deal_id FROM deal
    WHERE am_id = ${amId}
      AND stage NOT IN ('Closing-Won', 'Closing-Lost')
      AND (
        (${accountId}::bigint IS NOT NULL AND account_id = ${accountId})
        OR similarity(COALESCE(NULLIF(facility_name,''), customer_name, ''), ${customer}) >= ${ACCOUNT_MATCH}
      )
    ORDER BY stage_entered_at DESC NULLS LAST, updated_at DESC
    LIMIT 1
  `;
  return { accountId, opportunityId: deal ? String(deal.deal_id) : null };
}

// #REPORT AM → activity_log (per customer) + fuzzy-match ke sales_plan hari itu
// (pg_trgm > 0.3 + faskes_cocok) → set plan_id + tandai plan reported.
// is_unmatched bila tak match.
// Sekalian resolve Account/Opportunity + simpan tipe aktivitas (F16 CRM Fase 1).
//
// DUA SARINGAN di atas ambang 0,3 — keduanya lahir dari audit prod 10 Sep 2026:
//
// 1. `faskes_cocok` (migrasi 176). Nama faskes Indonesia berbentuk
//    `<kata generik> <pembeda> <tempat>`, jadi dua faskis BERBEDA di kota yang
//    sama sudah lolos 0,3 hanya dari bagian yang mereka bagi bersama —
//    `Puskesmas Peterongan` vs `Puskesmas Jabon` = 0,32, dan `rsu muh babat`
//    vs `Rs nu babat` = 0,44 padahal itu dua rumah sakit berlainan di Babat.
//    Terhitung 34 tautan salah faskes + 41 rencana bertanda reported palsu.
//
// 2. Rencana yang SUDAH diklaim laporan lain tidak boleh direbut. Dulu, saat
//    AM mengunjungi customer di luar rencana, laporannya menyambar rencana
//    tersisa yang kebetulan mirip — sehingga satu rencana dipegang dua laporan
//    (32 kasus rebutan di prod, mis. rencana `Klinik MTA` dipegang laporan
//    `Klinik MTA` DAN `Kimia Klinik`). Pengecualian `>= 0.7` menjaga agar
//    laporan yang dikirim ULANG tetap menemukan rencananya sendiri.
//
// Keduanya hanya MEMPERSEMPIT: laporan yang tak lagi cocok jatuh ke
// `is_unmatched` — jawaban jujur "kunjungan ini di luar rencana", yang memang
// sudah jadi perilaku benar untuk 573 baris lain.
// IDEMPOTEN: kiriman ULANG #REPORT memperbarui baris, tidak menambah baris.
//
// AM rutin mengoreksi laporannya dengan mengirim ulang. Dulu tiap kiriman
// melahirkan baris activity_log baru, jadi satu kunjungan tercatat dua-tiga
// kali. Terhitung di prod: 94 kelompok duplikat / 121 baris berlebih, dan itu
// terus tumbuh — sama seperti sampah over-split dulu, bedanya ini beranak tiap
// hari.
//
// Kunci identitas = (am_id, tanggal, nama customer ternormalisasi).
//
// KENAPA BUKAN "hapus semua lalu tulis ulang" seperti insertSalesPlan:
// AM melapor BERTAHAP, satu pesan satu customer. Dari 63 pasangan (AM,tanggal)
// yang punya >1 pesan #REPORT sejak Agustus, hampir semuanya berisi customer
// yang BERBEDA — mis. 17 pasangan berpesan 5 kali menghasilkan 72 baris untuk
// 72 customer unik. Menghapus set lama akan menghancurkan laporan yang sah.
//
// KENAPA NAMA PERSIS, BUKAN FUZZY: pencocokan longgar (>=0,7) menggabungkan
// faskes yang benar-benar berlainan — 'Dinas Kesehatan Kab Madiun' vs
// 'Dinas Kesehatan Kota Madiun' berskor 0,77, 'RS PKU Muhammadiyah Selogiri'
// vs '... Wonogiri' 0,71. Menyatukannya jauh lebih merusak daripada menyisakan
// satu duplikat. Normalisasi dibatasi pada prefiks `Cust:` + huruf kecil.
//
// FOTO & GEOTAG TIDAK DISENTUH saat memperbarui. Foto menempel BELAKANGAN
// lewat photoFollowup, jadi baris lama sering justru pemegang fotonya —
// terhitung 19 dari 24 baris rintisan di prod. Menimpanya dengan NULL akan
// menghapus bukti kunjungan yang geotagnya susah payah dipulihkan.
//
// BATAS YANG DIPILIH SADAR: dua kunjungan NYATA ke customer yang sama di hari
// yang sama akan tergabung jadi satu baris, isinya dari kiriman terakhir. Itu
// jarang, dan pemeriksaan 94 kelompok duplikat di prod tak menemukan satu pun
// yang meyakinkan sebagai dua kunjungan terpisah — yang ada rintisan "visit"
// lalu laporan asli, atau revisi. AM yang benar-benar berkunjung dua kali bisa
// menuliskannya dalam satu baris hasil.
async function insertAmActivities(
  amId: string,
  tanggal: string,
  items: { customer: string; hasil: string; next_action: string; activity_type?: string | null }[],
  messageId: string | null,
): Promise<{ matched: number; unmatched: number; unmatchedNames: string[]; linked: number }> {
  const sql = db();
  let matched = 0;
  let linked = 0;
  const unmatchedNames: string[] = [];
  for (const it of items) {
    // Cocokkan pakai nama yang sudah dibuang prefiks "Cust :"; yang DISIMPAN
    // tetap apa adanya dari AM (jejak mentah tetap di wa_message.body).
    const namaBersih = bersihkanNamaCustomer(it.customer);
    const cands = await sql`
      SELECT sp.id, similarity(sp.customer_name, ${namaBersih}) AS score
      FROM sales_plan sp
      WHERE sp.am_id = ${amId} AND sp.tanggal = ${tanggal}
        AND similarity(sp.customer_name, ${namaBersih}) > 0.3
        AND faskes_cocok(${namaBersih}, sp.customer_name)
        AND (
          NOT EXISTS (SELECT 1 FROM activity_log a2 WHERE a2.plan_id = sp.id)
          OR EXISTS (
            SELECT 1 FROM activity_log a2
             WHERE a2.plan_id = sp.id
               AND similarity(faskes_bersih(a2.customer_name), ${namaBersih}) >= 0.7)
        )
      ORDER BY score DESC LIMIT 1
    `;
    const planId = cands[0] ? Number(cands[0].id) : null;
    const score = cands[0] ? Number(cands[0].score) : null;
    const links = await resolveActivityLinks(amId, namaBersih).catch(() => ({ accountId: null, opportunityId: null }));
    if (links.accountId !== null) linked += 1;
    // Default 'Fisik' bila AM tak menyebut tipe: #REPORT AM = laporan kunjungan
    // harian (bukan kanal lain) — mempertahankan makna baris lama.
    const actType = it.activity_type ?? "Fisik";

    // Sudah ada baris untuk (AM, tanggal, customer) ini? → PERBARUI, jangan
    // tambah baris baru. Lihat catatan idempotensi di atas fungsi.
    const [ada] = await sql<{ id: string; plan_id: string | null; match_score: string | null }[]>`
      SELECT id, plan_id, match_score
        FROM activity_log
       WHERE am_id = ${amId} AND tanggal = ${tanggal} AND source = 'wa-inbound'
         AND lower(faskes_bersih(customer_name)) = lower(faskes_bersih(${it.customer}))
       -- Yang SUDAH memegang rencana didahulukan, baru yang tertua. Data lama
       -- (sebelum idempotensi) menyisakan pasangan duplikat di mana justru
       -- baris KEDUA yang terikat -- mis. Iqbal 7 Sep: 4977 tak terikat, 4978
       -- memegang rencana 7618. Kalau yang tertua yang dipilih, kiriman ulang
       -- akan mengikat 4977 ke 7618 juga (gerbang anti-rebutan mengizinkannya
       -- karena nama pengklaim lama mirip), lalu dua baris memegang satu
       -- rencana -- persis kerusakan yang hendak dicegah.
       ORDER BY (plan_id IS NULL), id
       LIMIT 1
    `;

    // Rencana yang SUDAH dipegang baris lama menang: baris itu tak muncul di
    // `cands` (gerbang anti-rebutan menyembunyikannya dari dirinya sendiri),
    // jadi tanpa ini kiriman ulang akan melepas ikatannya sendiri.
    const planFinal = ada?.plan_id != null ? Number(ada.plan_id) : planId;
    const scoreFinal = ada?.plan_id != null ? (ada.match_score != null ? Number(ada.match_score) : null) : score;

    let actId: number;
    if (ada) {
      // Foto, geotag, dan tautan Account TIDAK disentuh — foto menempel belakangan
      // lewat photoFollowup, dan menimpanya dengan NULL akan menghapus bukti
      // kunjungan. Yang diperbarui hanya isi laporannya.
      await sql`
        UPDATE activity_log
           SET hasil = ${it.hasil || null},
               next_action = ${it.next_action || null},
               activity_type = ${actType},
               message_id = ${messageId},
               plan_id = ${planFinal},
               match_score = ${scoreFinal},
               is_unmatched = ${planFinal === null},
               account_id = COALESCE(account_id, ${links.accountId}),
               opportunity_id = COALESCE(opportunity_id, ${links.opportunityId})
         WHERE id = ${Number(ada.id)}
      `;
      actId = Number(ada.id);
    } else {
      const rows = await sql`
        INSERT INTO activity_log
          (am_id, plan_id, tanggal, customer_name, hasil, next_action, source, is_unmatched, match_score, message_id,
           activity_type, account_id, opportunity_id)
        VALUES
          (${amId}, ${planFinal}, ${tanggal}, ${it.customer}, ${it.hasil || null}, ${it.next_action || null},
           'wa-inbound', ${planFinal === null}, ${scoreFinal}, ${messageId},
           ${actType}, ${links.accountId}, ${links.opportunityId})
        RETURNING id
      `;
      actId = Number(rows[0].id);
    }

    if (planFinal !== null) {
      matched += 1;
      await sql`UPDATE sales_plan SET reported = true, reported_at = now(), activity_id = ${actId} WHERE id = ${planFinal} AND reported = false`;
    } else {
      unmatchedNames.push(it.customer);
    }
  }
  return { matched, unmatched: unmatchedNames.length, unmatchedNames, linked };
}

// ── Laporan yang masuk lewat tengah malam ──
//
// insertAmActivities mengikat ke rencana dengan `tanggal = ${tanggal}` PERSIS.
// AM yang mengirim #REPORT lewat tengah malam jadi tak pernah terikat: kalau ia
// tak menulis tanggal, `wibDate()` memberi hari yang BARU (jam 00:19 WIB sudah
// hari berikutnya), dan kalau ia menulis tanggal pun sering ditulis hari baru —
// sementara rencananya ada di hari sebelumnya. Hasilnya nol yang cocok, semua
// baris masuk `is_unmatched`, dan `sales_plan.reported` tak pernah ter-set.
//
// Akibatnya bukan kosmetik: kunjungan yang benar-benar dikerjakan (lengkap
// dengan catatan hasil) tidak terhitung di capaian, sehingga KPI menampilkan 0
// untuk orang yang justru melapor. Diukur di produksi: laporan yang masuk
// 00:00–05:59 punya tingkat "tak cocok" jauh di atas laporan jam kerja.
//
// Pergeseran ini SENGAJA dipagari ketat — tiga syarat harus terpenuhi bersama:
//   1. tanggal target benar-benar TAK PUNYA rencana (bukan sekadar tak cocok
//      namanya) — kalau AM memang punya rencana hari itu, tanggalnya dihormati;
//   2. pesan diterima sebelum AM_REPORT_H1_CUTOFF_HOUR WIB (default 06:00);
//   3. H-1 punya minimal satu rencana yang BELUM dilaporkan.
//
// Dan hasilnya TIDAK senyap: balasan WA menyebut pergeserannya, supaya AM bisa
// mengoreksi kalau tebakannya salah. Pergeseran tanggal yang diam-diam adalah
// kelas bug yang sama dengan yang sedang diperbaiki.
//
// Kill switch: AM_REPORT_BIND_H1=false.
const H1_CUTOFF_HOUR = (() => {
  const n = Number(process.env.AM_REPORT_H1_CUTOFF_HOUR);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.trunc(n) : 6;
})();
const bindH1Enabled = (): boolean =>
  (process.env.AM_REPORT_BIND_H1 ?? "true").toLowerCase() !== "false";

async function tanggalIkatLaporan(
  amId: string,
  tglAwal: string,
  receivedAt: string | null | undefined,
): Promise<{ tanggal: string; digeser: boolean; dari: string }> {
  const tetap = { tanggal: tglAwal, digeser: false, dari: tglAwal };
  if (!bindH1Enabled() || !receivedAt) return tetap;
  const sql = db();
  // Jam dihitung di SQL dengan AT TIME ZONE, bukan dengan memotong string:
  // received_at::text membawa offset server yang belum tentu WIB, dan salah
  // zona di sini justru akan menggeser tanggal untuk laporan jam kerja.
  const [q] = await sql<{ jam: number; n_target: number; n_h1_belum: number }[]>`
    SELECT extract(hour FROM (${receivedAt}::timestamptz AT TIME ZONE 'Asia/Jakarta'))::int AS jam,
           (SELECT count(*)::int FROM sales_plan
             WHERE am_id = ${amId} AND tanggal = ${tglAwal}::date) AS n_target,
           (SELECT count(*)::int FROM sales_plan
             WHERE am_id = ${amId} AND tanggal = ${tglAwal}::date - 1 AND NOT reported) AS n_h1_belum
  `;
  if (!q) return tetap;
  if (Number(q.n_target) > 0) return tetap;
  if (Number(q.jam) >= H1_CUTOFF_HOUR) return tetap;
  if (Number(q.n_h1_belum) < 1) return tetap;
  const [{ h1 }] = await sql<{ h1: string }[]>`SELECT (${tglAwal}::date - 1)::text AS h1`;
  return { tanggal: String(h1), digeser: true, dari: tglAwal };
}

/**
 * Ambang selisih (hari) antara tanggal yang DITULIS AM di header `#REPORT` dan
 * tanggal pesannya sendiri, di atas mana AM harus dikonfirmasi.
 *
 * `parsers/tanggal.ts` sudah menjaring salah-TAHUN (>= 365 hari) dan tanggal
 * masa depan (> 7 hari), tapi sengaja memberi ruang 180 hari ke belakang untuk
 * backdate yang sah. Celahnya justru di situ: salah ketik BULAN lolos tanpa
 * suara. Teramati di prod (audit export grup The ALLIANCE vs prod, 9 Sep 2026):
 *
 *   Luri  kirim 22 Jul, tulis "14/7/2026"  -> 4 kunjungan difile ke 14 Jul
 *   Luri  kirim 27 Jul, tulis "26/6/2026"  -> 5 kunjungan difile ke 26 Jun
 *   Luri  kirim 29 Jul, tulis "10/6/2026"  -> 5 kunjungan difile ke 10 Jun
 *   Yugo  kirim  6 Agu, tulis  "6/7/2026"  -> 4 kunjungan difile ke  6 Jul
 *
 * 22 kunjungan tercatat sebulan di belakang tanggal sebenarnya, plus ~76 baris
 * duplikat karena laporan yang sama masuk dua kali. Di rekap harian AM tampak
 * tidak bekerja pada hari yang justru dia bekerja.
 *
 * 3 hari dipilih supaya laporan H-1 dan H-2 (Senin untuk Sabtu) lewat tanpa
 * berisik, sementara seluruh kasus yang teramati (>= 8 hari) tertangkap.
 *
 * Tanggalnya TIDAK diubah paksa — kita tak bisa tahu mana yang benar, dan
 * menebak diam-diam persis kelas bug yang perbaikan ini tutup. Yang berubah:
 * AM diberi tahu, jadi dia bisa mengoreksi malam itu juga.
 */
export const AMBANG_SELISIH_TANGGAL = 3;

// Selisih hari antara tanggal yang ditulis AM dan tanggal pesannya. null kalau
// salah satu tak bisa diurai. Diekspor untuk dipakai kedua pembangun pesan.
function selisihHariTanggal(tanggalDipakai: string, tanggalPesan: string): number | null {
  const a = Date.parse(`${tanggalDipakai}T00:00:00Z`);
  const b = Date.parse(`${tanggalPesan}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// Diekspor untuk diuji tanpa DB (repo/inbound-tanggal.test.ts).
export function buildPeringatanTanggal(tanggalDipakai: string, tanggalPesan: string): string | null {
  const selisih = selisihHariTanggal(tanggalDipakai, tanggalPesan);
  if (selisih === null || Math.abs(selisih) < AMBANG_SELISIH_TANGGAL) return null;
  const arah = selisih > 0 ? "lebih tua" : "di masa depan";
  return (
    `\n\n📅 *Cek tanggal:* kamu menulis *${tanggalDipakai}*, tapi pesan ini masuk *${tanggalPesan}*` +
    ` — selisih ${Math.abs(selisih)} hari (${arah}).` +
    `\nLaporan dicatat ke *${tanggalDipakai}* sesuai yang kamu tulis. Kalau itu salah ketik,` +
    ` kirim ulang #REPORT dengan tanggal yang benar — kalau dibiarkan, kunjungan ini tak terhitung di hari kerjanya.`
  );
}

/**
 * Versi PLAN. Beda dari versi REPORT di dua hal yang penting:
 *
 *  1. Akibatnya lebih parah, jadi dikatakan lebih tegas. Plan yang difile ke
 *     tanggal salah membuat #REPORT malam itu tak menemukan plan untuk
 *     dicocokkan → is_unmatched → kunjungannya tidak terhitung sama sekali.
 *  2. Instruksi kirim-ulangnya WAJIB menyebut "lengkap". insertSalesPlan
 *     menghapus plan yang belum direport lalu insert ulang, jadi kirim ulang
 *     PARSIAL justru menghapus sisa plan hari itu.
 */
export function buildPeringatanTanggalPlan(tanggalDipakai: string, tanggalPesan: string): string | null {
  const selisih = selisihHariTanggal(tanggalDipakai, tanggalPesan);
  if (selisih === null || Math.abs(selisih) < AMBANG_SELISIH_TANGGAL) return null;
  const arah = selisih > 0 ? "lebih tua" : "di masa depan";
  return (
    `\n\n📅 *Cek tanggal:* kamu menulis *${tanggalDipakai}*, tapi pesan ini masuk *${tanggalPesan}*` +
    ` — selisih ${Math.abs(selisih)} hari (${arah}).` +
    `\nPlan dicatat ke *${tanggalDipakai}*. Kalau itu salah ketik, #REPORT nanti malam TIDAK akan` +
    ` menemukan plan ini dan kunjunganmu tak terhitung.` +
    `\nKirim ulang #PLAN *lengkap* (semua customer hari ini) dengan tanggal yang benar.`
  );
}

// ── Foto-followup (Fase 3) ──
const PHOTO_MATCH = 0.3, PHOTO_DUP = 0.5, PHOTO_SILENT = 0.2;

// Cooldown anti-spam balasan foto (in-memory; apps/api single-process via pm2).
// Foto visit sering dikirim BERURUTAN (bukan barengan) → debounce pending_photos
// di bawah sering lihat 0 → tiap foto bales. Tahan balasan kalau baru aja balas
// utk AM yg sama < 90 dtk → cukup 1 balasan ringkas per burst.
const PHOTO_REPLY_COOLDOWN_MS = 90_000;
const lastPhotoReplyAt = new Map<string, number>();

function parseGeoTs(ts?: string | null): { iso: string | null; dt: string | null } {
  if (!ts) return { iso: null, dt: null };
  const m = ts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/);
  if (!m) return { iso: null, dt: null };
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const dt = m[4] != null ? `${iso}T${m[4].padStart(2, "0")}:${m[5]}:00+07:00` : `${iso}T00:00:00+07:00`;
  return { iso, dt };
}

// Foto (caption=nama customer, geo dari OCR) → match ke activity_log customer
// hari itu (≥0.30) → tempel photo_path+geotag + update sales_plan.visit_*.
async function photoFollowup(row: WaRow, am: { am_id: string; nama: string }): Promise<Record<string, unknown>> {
  const sql = db();
  let caption = (row.body ?? "").trim();
  if (caption === "<media:image>") caption = "";
  if (!caption) return { skipped: "no-caption" };
  // Dulu LIMIT 1: hanya baris ber-skor tertinggi dalam jendela 7 hari yang
  // dilihat, TANPA peduli baris itu sudah berfoto. Kalau ternyata sudah, foto
  // baru dibuang sebagai "already-saved" — padahal baris HARI INI untuk faskes
  // yang sama masih kosong. AM yang mengunjungi faskes yang sama berulang
  // paling dirugikan: 209 foto ditolak, 134 di antaranya punya slot kosong di
  // hari yang sama (Angga 41 · Yugo 39 · Iqbal 34 · Luri 28 · Irul 26).
  // Sekarang beberapa kandidat diambil, dan slot KOSONG diutamakan.
  const cands = await sql<{ id: string; customer_name: string; plan_id: string | null; tanggal: string; photo_path: string | null; score: string }[]>`
    SELECT id, customer_name, plan_id, tanggal::text AS tanggal, photo_path,
           similarity(customer_name, ${caption}) AS score
    FROM activity_log
    WHERE am_id = ${am.am_id} AND tanggal >= (CURRENT_DATE - 7)
      AND similarity(customer_name, ${caption}) >= ${PHOTO_SILENT}
    ORDER BY score DESC LIMIT 8
  `;
  // Slot kosong yang layak: lulus ambang match, belum berfoto. Di antara itu,
  // yang tanggalnya SAMA dengan hari foto dikirim diutamakan — foto yang baru
  // dikirim hampir selalu milik kunjungan hari itu; baru kemudian skor.
  const hariFoto = String(row.received_at ?? "").slice(0, 10);
  const kosong = cands
    .filter((c) => !c.photo_path && Number(c.score) >= PHOTO_MATCH)
    .sort((a, b) =>
      (b.tanggal === hariFoto ? 1 : 0) - (a.tanggal === hariFoto ? 1 : 0) ||
      Number(b.score) - Number(a.score));
  const top = kosong[0] ?? cands[0];
  if (!top) return { skipped: "no-match-silent", caption };
  const score = Number(top.score);
  if (score < PHOTO_MATCH) {
    const reply = await sendViaWaGateway(row.group_jid, `⚠️ Foto "${caption}" tak cocok ke customer manapun, ${am.nama}.`);
    return { error: "weak-match", score, reply };
  }
  if (top.photo_path && score >= PHOTO_DUP) {
    const reply = await sendViaWaGateway(row.group_jid, `ℹ️ Foto ${top.customer_name} sudah tersimpan, ${am.nama}.`);
    return { note: "already-saved", reply };
  }
  const hasGeo = row.geo_lat != null && row.geo_lon != null;
  const g = parseGeoTs(row.geo_ts); // jam dipakai walau koordinat gagal — lihat tempelFotoLaporan
  const adaGeo = hasGeo || g.dt != null;
  const geo = adaGeo
    ? { lat: row.geo_lat ?? null, lon: row.geo_lon ?? null, ts: row.geo_ts ?? null, address: row.geo_address ?? null }
    : null;
  await sql`
    UPDATE activity_log SET photo_path = ${row.media_path ?? null},
      photo_geotag = ${geo ? sql.json(geo as unknown as Parameters<typeof sql.json>[0]) : null}
    WHERE id = ${top.id}
  `;
  let mismatch = false;
  if (top.plan_id && adaGeo) {
    mismatch = g.iso ? g.iso !== String(top.tanggal) : false;
    await sql`
      UPDATE sales_plan
         SET visit_lat = COALESCE(${row.geo_lat ?? null}::numeric, visit_lat),
             visit_lon = COALESCE(${row.geo_lon ?? null}::numeric, visit_lon),
             visit_timestamp = COALESCE(${g.dt}::timestamptz, visit_timestamp),
             visit_date_mismatch = COALESCE(${g.iso ? g.iso !== String(top.tanggal) : null}::boolean, visit_date_mismatch)
       WHERE id = ${top.plan_id}
    `;
  }
  // Debounce: kalau masih ada foto lain dari AM/grup yg sama BELUM diproses,
  // tahan balasan — cuma foto TERAKHIR batch yg reply (hindari spam saat foto
  // dikirim barengan). Baris ini sendiri sudah ter-claim (processed_at di-set
  // oleh processUnprocessed sebelum proses) → tak terhitung.
  const [{ pending_photos }] = await sql`
    SELECT count(*)::int AS pending_photos FROM wa_message
    WHERE processed_at IS NULL AND message_type ~* '^image' AND media_path IS NOT NULL
      AND sender_jid = ${row.sender_jid} AND group_jid = ${row.group_jid}
  `;
  if (Number(pending_photos) > 0) {
    return { matched: top.customer_name, score, geo: hasGeo, deferred: true };
  }
  // Foto terakhir batch → 1 reply ringkas. "Sisa" hanya customer asli (ke-match
  // plan, plan_id NOT NULL) — buang baris hasil-parse-jelek tanpa plan_id.
  const remain = await sql`
    SELECT customer_name FROM activity_log
    WHERE am_id = ${am.am_id} AND tanggal = ${String(top.tanggal)} AND photo_path IS NULL AND plan_id IS NOT NULL ORDER BY id
  `;
  const [{ no_geo }] = await sql`
    SELECT count(*)::int AS no_geo FROM activity_log
    WHERE am_id = ${am.am_id} AND tanggal = ${String(top.tanggal)} AND photo_path IS NOT NULL AND photo_geotag IS NULL
  `;
  let msg = `✅ Foto tersimpan, ${am.nama}.${mismatch ? " ⚠️ tanggal foto ≠ tanggal plan." : ""}`;
  if (remain.length > 0) {
    msg += `\nSisa ${remain.length} customer belum ada foto:\n• ${remain.map((r) => String(r.customer_name)).join("\n• ")}`;
  } else {
    msg += `\n✅ Semua foto visit lengkap.`;
  }
  if (Number(no_geo) > 0) {
    msg += `\n⚠️ ${no_geo} foto tanpa geotag — pakai Geo-Tagging Camera supaya koordinat ke-burn di pixel.`;
  }
  // Cooldown per-AM: foto burst yg datang berurutan jangan bales berkali-kali.
  const cdKey = am.am_id;
  const nowMs = Date.now();
  if (nowMs - (lastPhotoReplyAt.get(cdKey) ?? 0) < PHOTO_REPLY_COOLDOWN_MS) {
    return { matched: top.customer_name, score, geo: hasGeo, remaining: remain.length, suppressed: "reply-cooldown" };
  }
  lastPhotoReplyAt.set(cdKey, nowMs);
  const reply = await sendViaWaGateway(row.group_jid, msg);
  return { matched: top.customer_name, score, geo: hasGeo, remaining: remain.length, no_geo: Number(no_geo), reply };
}

// Proses SATU pesan; selalu tandai processed_at (idempoten). Pengirim tak dikenal
// / non-submission → SILENT.
// ── #KORAN: penjodohan hashtag ↔ lampiran (F-CASHIN) ──
//
// WhatsApp memisah dokumen dan teks jadi dua pesan, dan admin Finance memang
// mengetik "#KORAN mandiri 17 sep" lalu melampirkan PDF-nya menyusul. Kedua
// urutan harus jalan:
//   teks dulu  → pesan hashtag mencari lampiran di sekitarnya
//   file dulu  → baris dokumen mencari hashtag di sekitarnya
//
// Jendela ±10 menit: satu setoran harian berisi s/d 10 file yang dikirim
// berurutan, dan admin kadang menyela dengan pesan lain di tengahnya.
//
// Pencocokan sengaja per-GRUP, bukan per-pengirim: di grup, `sender_jid` =
// `group_jid` (jebakan lama yang tercatat di CLAUDE.md), jadi menyaring per
// pengirim justru membuang semua pasangan yang sah.
const KORAN_JENDELA_MENIT = 10;
const KORAN_MAX_LAMPIRAN = 12;

export function adaLampiranDokumen(row: Pick<WaRow, "media_path" | "message_type">): boolean {
  if (!row.media_path) return false;
  const t = String(row.message_type ?? "").toLowerCase();
  // 'application/pdf' (bentuk asli e-banking), 'document*', dan foto layar.
  return t.startsWith("application") || t.startsWith("document") || t.startsWith("image");
}

/** Lampiran di sekitar pesan #KORAN yang belum jadi statement mana pun. */
async function lampiranKoranTerdekat(row: WaRow): Promise<WaRow[]> {
  const rows = await db()`
    SELECT m.id::text, m.group_jid, m.sender_jid, m.sender_name, m.body, m.message_type,
           m.message_id, m.received_at::text, m.media_path
    FROM wa_message m
    WHERE m.group_jid = ${row.group_jid}
      AND m.media_path IS NOT NULL
      AND (m.message_type ~* '^(application|document|image)')
      AND m.received_at BETWEEN ${row.received_at}::timestamptz - ${`${KORAN_JENDELA_MENIT} minutes`}::interval
                            AND ${row.received_at}::timestamptz + ${`${KORAN_JENDELA_MENIT} minutes`}::interval
      -- File yang sudah jadi statement tidak diulang. Ingest-nya sendiri
      -- idempoten (UPSERT per rekening+tanggal), tapi mengulanginya berarti
      -- satu setoran dibalas berkali-kali.
      AND NOT EXISTS (SELECT 1 FROM bank_statement s WHERE s.wa_message_id = m.id)
    ORDER BY m.received_at
    LIMIT ${KORAN_MAX_LAMPIRAN}
  `;
  return rows as unknown as WaRow[];
}

/** Apakah lampiran di sekitar pesan ini SUDAH jadi statement? Dipakai untuk
 *  membedakan "file belum dikirim" (perlu ditegur) dari "file sudah masuk lewat
 *  baris dokumennya" (tak perlu bicara apa-apa). */
async function lampiranKoranSudahJadiStatement(row: WaRow): Promise<boolean> {
  const [r] = await db()`
    SELECT 1 AS ada FROM wa_message m
    JOIN bank_statement s ON s.wa_message_id = m.id
    WHERE m.group_jid = ${row.group_jid}
      AND m.received_at BETWEEN ${row.received_at}::timestamptz - ${`${KORAN_JENDELA_MENIT} minutes`}::interval
                            AND ${row.received_at}::timestamptz + ${`${KORAN_JENDELA_MENIT} minutes`}::interval
    LIMIT 1
  `;
  return Boolean(r);
}

/** Apakah ada pesan #KORAN di sekitar baris dokumen ini? */
async function adaKoranTerdekat(row: WaRow): Promise<boolean> {
  const [r] = await db()`
    SELECT 1 AS ada FROM wa_message m
    WHERE m.group_jid = ${row.group_jid}
      AND m.body ~* '#\\s*koran'
      AND m.received_at BETWEEN ${row.received_at}::timestamptz - ${`${KORAN_JENDELA_MENIT} minutes`}::interval
                            AND ${row.received_at}::timestamptz + ${`${KORAN_JENDELA_MENIT} minutes`}::interval
    LIMIT 1
  `;
  return Boolean(r);
}

/** Ingest satu/beberapa lampiran + susun balasannya. Dipakai dua jalur masuk
 *  (pesan hashtag dan baris dokumen), jadi bunyinya selalu sama. */

/**
 * Tanggal yang DITULIS pengirim di caption #KORAN, mis. "#koran BNI 09/10/2026".
 *
 * Diekspor untuk diuji tanpa DB (repo/inbound-koran-caption.test.ts).
 *
 * Format Indonesia: hari DULU, bulan kedua. "09/10/2026" = 9 Oktober, bukan
 * 10 September. Juga menerima bentuk ISO kalau ada.
 */
export function tanggalDariCaptionKoran(body: string | null): string | null {
  if (!body) return null;
  const teks = body.replace(/\u200e|\u200f/g, "");

  const iso = teks.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const id = teks.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|\d{2})\b/);
  if (!id) return null;
  const hari = Number(id[1]);
  const bulan = Number(id[2]);
  if (hari < 1 || hari > 31 || bulan < 1 || bulan > 12) return null;
  const tahun = id[3].length === 2 ? `20${id[3]}` : id[3];
  return `${tahun}-${String(bulan).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;
}

/**
 * Peringatan saat tanggal di caption BEDA dari tanggal di isi dokumen.
 *
 * Kenapa perlu: sistem menolak keras kalau tanggal tak terbaca atau periodenya
 * lebih dari satu hari, tapi DIAM saja kalau tanggalnya terbaca jelas namun
 * bukan yang dimaksud pengirim. 12 Okt 2026 renika mengirim "#koran NIAGA
 * 09/10/2026" dengan PDF bertanggal 10 Okt; balasannya berbunyi "terverifikasi"
 * dan datanya mendarat di tanggal yang salah tanpa ada yang tahu. Resume 9 Okt
 * tertahan karena NIAGA dianggap belum masuk, sementara 10 Okt (Sabtu) punya
 * satu baris nyasar.
 *
 * Isi dokumen TETAP yang dipakai — itu sumber kebenarannya (lihat catatan
 * migrasi 169). Yang ditambahkan hanya kabar bahwa keduanya tak cocok.
 *
 * Diekspor untuk diuji tanpa DB.
 */
export function buildPeringatanKoranCaption(
  tanggalDokumen: string,
  body: string | null,
): string | null {
  const tglCaption = tanggalDariCaptionKoran(body);
  if (!tglCaption || tglCaption === tanggalDokumen) return null;
  return (
    `⚠️ Tanggal di pesan (*${tglCaption}*) BEDA dari isi dokumen (*${tanggalDokumen}*).` +
    ` Yang dipakai isi dokumen.` +
    `\nKalau yang kamu maksud ${tglCaption}, ekspor ulang untuk tanggal itu —` +
    ` kalau dibiarkan, resume ${tglCaption} tertahan karena rekening ini dianggap belum masuk.`
  );
}

async function ingestKoranDariBaris(row: WaRow, lampiran: WaRow[]): Promise<Record<string, unknown>> {
  const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
  const baris: string[] = [];
  const hasil: Record<string, unknown>[] = [];

  for (const l of lampiran) {
    if (!l.media_path) continue;
    const result = await ingestKoran({
      file_path: l.media_path,
      file_nama: l.media_path.split("/").pop() ?? null,
      sumber: "wa",
      wa_message_id: l.id,
      // Grup asal = tujuan draft konfirmasi Finance nanti (migrasi 178).
      wa_group_jid: row.group_jid,
    });
    if ("ok" in result && result.ok === false) {
      baris.push(`⚠️ Gagal proses #KORAN: ${(result as { error?: string }).error}`);
      hasil.push({ error: (result as { error?: string }).error });
      continue;
    }
    const k = result as IngestKoranResult;
    hasil.push({ statement_id: k.statement_id, status: k.status, label_file: k.label_file });
    if (k.status === "terverifikasi") {
      baris.push(
        [
          `✅ #KORAN ${k.label_file} ${k.tanggal} diterima.`,
          `${k.jumlah_baris} transaksi · masuk ${rp(k.total_kredit)} · keluar ${rp(k.total_debit)}`,
          buildPeringatanKoranCaption(k.tanggal, row.body),
          k.saldo_bersambung_ok === false
            ? "⚠️ Saldo akhir tidak bersambung ke hari berikutnya — mungkin dicetak sebelum tutup hari."
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else {
      baris.push(
        [
          `⚠️ #KORAN ${k.label_file} ${k.tanggal} TERTAHAN — belum masuk resume.`,
          k.parse_error ?? "angka di dalamnya belum bisa diverifikasi",
          "Silakan cetak ulang dari e-banking lalu kirim lagi.",
        ].join("\n"),
      );
    }
    // Status gerbang konfirmasi (migrasi 178) disebut SEKALI di akhir, bukan
    // per file: draftnya memang satu per hari. Draft-nya sendiri dikirim
    // sebagai pesan terpisah oleh buatDraftJikaLengkap.
    if (l === lampiran[lampiran.length - 1]) {
      if (k.draft_kode) baris.push(`📝 Draft resume ${k.draft_kode} menunggu konfirmasi.`);
      else if (k.draft_alasan) baris.push(`⏳ ${k.draft_alasan}`);
    }
  }

  const reply = await sendViaWaGateway(row.group_jid, baris.join("\n\n"));
  return { koran: hasil, lampiran: lampiran.length, reply };
}

export async function processInboundMessage(row: WaRow): Promise<Record<string, unknown>> {
  const sql = db();
  const kind = detectKind(row.body);
  const finish = async (result: Record<string, unknown>, kindOverride?: string): Promise<Record<string, unknown>> => {
    const k = kindOverride ?? kind;
    await sql`
      UPDATE wa_message SET processed_at = now(), processed_kind = ${k},
        processed_result = ${sql.json(result as unknown as Parameters<typeof sql.json>[0])}
      WHERE id = ${row.id}
    `;
    return { id: row.id, kind: k, ...result };
  };

  if (kind === "none") {
    // Lampiran rekening koran yang dikirim sebagai pesan TERPISAH dari
    // hashtagnya. WhatsApp mengirim dokumen + teks sebagai dua pesan, dan admin
    // memang mengetik "#KORAN mandiri 17 sep" lalu melampirkan PDF-nya sesudah
    // itu. Tanpa penjodohan ini, pesan teksnya dibalas "wajib disertai
    // lampiran" dan PDF-nya tak pernah dilihat siapa pun — terbukti 17 Sep 2026
    // di grup uji (23:36:24 teks, 23:36:25 PDF).
    if (adaLampiranDokumen(row) && (await adaKoranTerdekat(row))) {
      return finish(await ingestKoranDariBaris(row, [row]), "koran");
    }
    // Foto tanpa hashtag (caption = customer) → foto-followup ke activity_log.
    if (String(row.message_type ?? "").toLowerCase().startsWith("image") && row.media_path) {
      const amp = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
      if (!amp) return finish({ skipped: "unknown-sender" }, "photo");
      // Foto AM cuma divalidasi di grup AM (The ALLIANCE). Di grup lain (mis. AM
      // forward surat/dokumen ke grup diskusi) → skip diam, jangan balas "tak cocok".
      const AM_PHOTO_GROUP = process.env.COMPLIANCE_AM_GROUP || process.env.REMINDER_WA_TARGET || "";
      if (String(amp.role ?? "").toUpperCase() === "AM" && AM_PHOTO_GROUP && row.group_jid !== AM_PHOTO_GROUP) {
        return finish({ skipped: "am-photo-non-alliance", am_id: amp.am_id }, "photo");
      }
      await sql`UPDATE master_user SET last_active_group = ${row.group_jid}, last_active_at = now() WHERE am_id = ${amp.am_id}`;
      const r = await photoFollowup(row, amp);
      return finish({ via: amp.via, ...r }, "photo");
    }
    return finish({ skipped: "no-hashtag" });
  }
  const target = row.group_jid;

  // #LEADS/#UPDATE — tanpa body-name; resolve by phone/pushname saja.
  // #LEADS <faskes>, <kota>: <kebutuhan> — pengirim ketat (seperti #CEK/
  // #FAKTUR). Sejak 13 Okt 2026 langsung jadi deal Prospecting di Pipeline
  // (menu Leads diabaikan); faskes yang sudah punya deal terbuka → dicatat di
  // Riwayat deal itu. Pengirim ber-peran AM → deal miliknya; selain itu
  // di-routing dari kota (master_territory → AM, area_kota → cabang → HoD).
  if (kind === "leads") {
    const pl = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
    if (!pl) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const p = parseLeads(row.body);
    if (!p.ok) {
      const reply = await sendViaWaGateway(
        target,
        p.alasan === "terlalu-panjang"
          ? `⚠️ #LEADS terlalu panjang, ${pl.nama}. Ringkas kebutuhannya lalu kirim ulang.`
          : `⚠️ #LEADS belum tercatat, ${pl.nama}: nama faskes belum ada.\nContoh: ${contohLeads()}`,
      );
      return finish({ error: `format:${p.alasan}`, via: pl.via, reply });
    }
    // SENGAJA bukan isAmRole() di atas: itu memasukkan Teknisi (alur laporan
    // per-customer), padahal info dari teknisi harus di-routing ke AM wilayah.
    const pengirimAm = /^am$/i.test(String(pl.role ?? "").trim());
    const hasil = await leadsJadiDeal(
      { facility_name: p.facility_name, city: p.city, kebutuhan: p.kebutuhan },
      { oleh: pl.am_id, pengirim: pl.nama, am_pengirim: pengirimAm ? pl.am_id : null },
    );
    const reply = await sendViaWaGateway(target, balasanLeadsDeal(hasil, { pengirim: pl.nama, facility_name: p.facility_name, city: p.city }));
    return finish(
      hasil.jenis === "baru"
        ? { deal: hasil.deal_id, am_id: hasil.am_id, routing: hasil.routing, via: pl.via, reply }
        : { riwayat: hasil.deals.map((d) => d.deal_id), via: pl.via, reply },
    );
  }

  // #DEMO / #TRIAL — F18. Buka: "<faskes>: <alat>" (+ ", N hari" / ", sampai dd/mm"
  // untuk trial). Tutup: "<DM-/TR-xxxx> positif|netral|negatif: alasan". Faskes
  // ambigu → bertanya; tak ketemu di Accurate → tetap dicatat sbg calon
  // pelanggan (demo memang sering ke faskes yang belum beli). Tidak ikut KPI.
  if (kind === "demo" || kind === "trial") {
    const pd = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
    if (!pd) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const p = parseDemoTrial(row.body, kind, wibHariIni());
    if (!p.ok) {
      const reply = await sendViaWaGateway(target, balasanFormatDT(kind, p.alasan, pd.nama));
      return finish({ error: `format:${p.alasan}`, via: pd.via, reply });
    }
    const pengirimAm = /^am$/i.test(String(pd.role ?? "").trim());
    if (p.mode === "tutup") {
      // AM hanya boleh menutup miliknya sendiri; peran lain (HoD/admin) bebas.
      const scope = pengirimAm ? { ...FULL_SCOPE, amOnly: true, amId: pd.am_id } : FULL_SCOPE;
      try {
        const r = await tutupDemoTrial(scope, p.kode, p.hasil, p.alasan, pd.nama);
        const reply = await sendViaWaGateway(target, balasanTutup(r, pd.nama));
        return finish({ kode: r.kode, hasil: r.hasil, via: pd.via, reply });
      } catch (e) {
        const pesan = e instanceof DemoTrialError ? e.message : "gagal diproses, coba lagi sebentar lagi";
        const reply = await sendViaWaGateway(target, `⚠️ ${p.kode}: ${pesan}${e instanceof DemoTrialError && e.status === 404 && pengirimAm ? " (atau bukan milik Anda)" : ""}.`);
        return finish({ error: `tutup:${pesan}`, kode: p.kode, via: pd.via, reply });
      }
    }
    const f = await resolusiFaskes(p.facility);
    if (f.kind === "ambiguous") {
      const reply = await sendViaWaGateway(target, balasanAmbiguDT(kind, p.facility, f.names, p.alat));
      return finish({ error: "customer-ambiguous", query: p.facility, candidates: f.names, via: pd.via, reply });
    }
    // Galat validasi DIBALAS — tanpa ini barisnya cuma ditandai processed_kind
    // 'error' oleh processUnprocessed dan pengirim tak pernah tahu pesannya gagal.
    let r: Awaited<ReturnType<typeof bukaDemoTrial>>;
    try {
      r = await bukaDemoTrial(
        { jenis: kind, facility_name: f.name, account_id: f.kind === "one" ? f.account_id : null, alat: p.alat,
          hari: p.hari, tanggal_selesai: p.sampai, catatan: p.catatan, am_id: pengirimAm ? pd.am_id : null, source: "wa" },
        { created_by: pd.am_id, group_jid: row.group_jid, wa_message_id: row.message_id },
      );
    } catch (e) {
      if (!(e instanceof DemoTrialError)) throw e;
      const reply = await sendViaWaGateway(target, `⚠️ ${kind === "demo" ? "#DEMO" : "#TRIAL"} belum tercatat, ${pd.nama}: ${e.message}.`);
      return finish({ error: `buka:${e.message}`, via: pd.via, reply });
    }
    const reply = await sendViaWaGateway(target, balasanBuka(r.row, pd.nama, kind === "trial" && !p.hari && !p.sampai));
    return finish({ kode: r.row.kode, baru: r.baru, account_id: r.row.account_id, deal_id: r.row.deal_id, via: pd.via, reply });
  }

  if (kind === "update") {
    const amx = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });

    if (!amx) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const reply = await sendViaWaGateway(target, `ℹ️ #${kind.toUpperCase()} belum tersedia di wrg-os (menyusul).`);
    return finish({ note: "not-implemented", via: amx.via, reply });
  }

  if (kind === "koran") {
    // Lampiran boleh menempel di pesan hashtag ini, ATAU datang sebagai pesan
    // terpisah sebelum/sesudahnya — lihat catatan di cabang kind === "none".
    // "#KORAN triage T1 uang masuk" — memutuskan baris yang tertahan langsung
    // dari grup. Dicek paling awal: perintah ini tak berlampiran dan tak boleh
    // tertukar dengan pernyataan nihil maupun penjodohan lampiran.
    const triage = parseTriage(row.body);
    if (triage) {
      const oleh = String(row.sender_name ?? "").trim() || "Finance";
      if (triage.kategori === null) {
        const reply = await sendViaWaGateway(
          target,
          `⚠️ Kategori tidak dikenali. Pakai salah satu: ${kataKategoriTersedia()}.\nContoh: *#KORAN triage ${triage.kode} uang masuk*`,
        );
        return finish({ error: "kategori-tak-dikenal", reply }, "koran");
      }
      const r = await triageDariWa(triage.kode, triage.kategori, oleh);
      const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
      const reply = await sendViaWaGateway(
        target,
        r.ok
          ? [
              `✅ ${triage.kode} (${r.label_file} ${rp(r.nominal ?? 0)}) ditetapkan sebagai *${r.kategori}* oleh ${oleh}. Angka resume sudah disegarkan.`,
              r.dipasangkan_dengan ? `Dipasangkan dengan debit ${r.dipasangkan_dengan}.` : null,
            ]
              .filter(Boolean)
              .join("\n")
          : `⚠️ ${r.error}`,
      );
      return finish({ triage: r, reply }, "koran");
    }

    // Pernyataan "hari ini nihil" — TANPA lampiran, dan itu memang bentuknya:
    // rekening tanpa transaksi tak bisa diunduh dari internet banking sama
    // sekali (dilaporkan Finance 18 Sep 2026). Dicek SEBELUM penjodohan
    // lampiran, kalau tidak pesan ini akan menyambar PDF rekening lain yang
    // kebetulan dikirim beberapa menit sebelumnya.
    const nihil = parseNihil(row.body);
    if (nihil) {
      const oleh = String(row.sender_name ?? "").trim() || "Finance";
      const r = await nyatakanNihil(nihil.label, oleh, {
        tanggal: nihil.tanggal,
        waMessageId: row.id,
        grupJid: row.group_jid,
      });
      // Status draft ikut disebut, sama seperti ekor balasan #KORAN berkas.
      const status = !r.ok || !r.draft
        ? null
        : r.draft.kode
          ? `📝 Draft resume ${r.draft.kode} menunggu konfirmasi.`
          : r.draft.alasan
            ? `⏳ ${r.draft.alasan}`
            : null;
      const reply = await sendViaWaGateway(
        target,
        r.ok
          ? [`✅ ${r.label_file} ${r.tanggal} dicatat NIHIL (tanpa transaksi) atas pernyataan ${oleh}.`, status]
              .filter(Boolean)
              .join("\n\n")
          : `⚠️ Gagal mencatat nihil: ${r.error}`,
      );
      return finish({ nihil: r, reply }, "koran");
    }

    const lampiran = adaLampiranDokumen(row) ? [row] : await lampiranKoranTerdekat(row);
    if (lampiran.length === 0) {
      // Lampirannya bisa sudah diproses duluan: baris dokumen dan baris teks
      // kadang punya received_at yang SAMA (terbukti 18 Sep 2026, dua-duanya
      // 00:42:59), dan yang dokumen menang urutan. Kalau file di sekitarnya
      // sudah jadi statement, pekerjaan sudah beres — diam, jangan menyuruh
      // admin mengirim ulang file yang justru barusan berhasil masuk.
      if (await lampiranKoranSudahJadiStatement(row)) {
        return finish({ skipped: "lampiran-sudah-diproses" }, "koran");
      }
      const reply = await sendViaWaGateway(
        target,
        "⚠️ #KORAN belum ada lampirannya. Kirim file rekening koran (PDF e-banking atau foto) — boleh menyusul di pesan berikutnya.",
      );
      return finish({ error: "no-attachment", reply });
    }
    return finish(await ingestKoranDariBaris(row, lampiran), "koran");
  }

  // F12 — #KIRIM/#TERIMA/#BAST/#BUKTI (SHIPPING). Dulu TANPA gate sender
  // ("kurir tak punya roster") — artinya siapa pun di grup mana pun bisa
  // menutup pengiriman (uji dev 11 Okt 2026). Sekarang: staf roster, ATAU
  // driver SJ itu lewat chat pribadi (pelakuShippingWa). Pengirim lain
  // diabaikan diam. Sejak 13 Okt 2026 SJ dirujuk ke DO Accurate dan record
  // dibuat otomatis saat #KIRIM pertama — tanpa input web.
  if (kind === "kirim" || kind === "terima" || kind === "bast" || kind === "bukti") {
    if (!isShippingWaEnabled()) return finish({ skipped: "shipping-disabled" });
    const roster = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
    const isDm = !String(row.group_jid ?? "").endsWith("@g.us");
    if (!roster && !isDm) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const tag = `#${kind.toUpperCase()}`;
    const arg = extractSjArg(row.body);
    if (!arg) {
      if (!roster) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Format ${tag} tak lengkap — sertakan jenis + nomor SJ, mis. "${tag} SJK 6142" (boleh juga nomor lengkap).`,
      );
      return finish({ error: "missing-sj-number", reply });
    }
    // Record lama dengan nomor persis (dibuat sebelum alur DO Accurate) tetap
    // dikenali; selain itu rujukan diurai lalu dicari di DO Accurate.
    let shipment = await findBySjNumber(arg.split(/\s+/)[0]);
    let dibuat = false;
    if (!shipment) {
      const dos = await cariDoUntukWa(arg);
      if (dos.length !== 1) {
        if (!roster) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
        const reply = await sendViaWaGateway(
          target,
          dos.length === 0
            ? `⚠️ SJ "${arg}" tidak ditemukan di DO Accurate 90 hari terakhir. Cek jenis & nomornya (mis. "${tag} SJK 6142"), atau kirim nomor lengkap.`
            : `⚠️ "${arg}" cocok dengan ${dos.length} SJ:\n${dos.map((d) => `• ${d.number} (${d.customer_name ?? "-"})`).join("\n")}\nKirim ulang ${tag} dengan nomor lengkap salah satunya.`,
        );
        return finish({ error: dos.length === 0 ? "sj-not-found" : "sj-ambiguous", sj: arg, kandidat: dos.length, reply });
      }
      const d = dos[0];
      shipment = await findBySjNumber(d.number);
      if (!shipment) {
        // Hanya #KIRIM yang memulai pengiriman, dan hanya staf roster: driver
        // lewat DM dikenali dari driver_wa_number SJ — yang belum ada sebelum
        // record dibuat.
        if (!roster) return finish({ skipped: "unknown-sender", sender_name: row.sender_name, sj: d.number });
        if (kind !== "kirim") {
          const reply = await sendViaWaGateway(target, `⚠️ SJ ${d.number} belum ditandai KIRIM. Kirim #KIRIM dulu saat berangkat.`);
          return finish({ error: "belum-kirim", sj: d.number, reply });
        }
        shipment = await createShipment({
          sj_number: d.number,
          customer_name: d.customer_name ?? "-",
          cabang: cabangDariNomorSj(d.number),
          created_by: `wa:${roster.nama}`,
        });
        dibuat = true;
      }
    }
    const pelaku = pelakuShippingWa({
      rosterNama: roster?.nama ?? null,
      isDm,
      senderNumber: String(row.sender_jid ?? "").split("@")[0].split(":")[0],
      driverWaNumber: shipment.driver_wa_number,
      driverName: shipment.driver_name,
    });
    if (!pelaku) return finish({ skipped: "unknown-sender", sender_name: row.sender_name, sj: shipment.sj_number });
    const photoPath = String(row.message_type ?? "").toLowerCase().startsWith("image") ? (row.media_path ?? null) : null;
    // Foto ber-geotag (OCR check_photo_geotag.py, sama infra "Geo-Tagging
    // Camera" AM) → row.geo_lat/geo_lon terisi. #KIRIM capture titik AWAL,
    // #BAST capture titik CUSTOMER — dipakai hitung distance_km/eta_days
    // OTOMATIS di markBast() begitu keduanya ada (arahan Direktur 2026-07-30).
    // #TERIMA cuma penanda waktu (tanpa foto/geo). #BUKTI (F93, SETELAH bast)
    // — foto bukti terima + scan tanda tangan, TANPA geo.
    const geo = { lat: row.geo_lat ?? null, lon: row.geo_lon ?? null };
    const action =
      kind === "kirim"
        ? await markKirim(shipment.id, { photo_path: photoPath, by: pelaku, ...geo })
        : kind === "terima"
          ? await markTerima(shipment.id, { by: pelaku })
          : kind === "bast"
            ? await markBast(shipment.id, { photo_path: photoPath, by: pelaku, ...geo })
            : await markBukti(shipment.id, { photo_path: photoPath, by: pelaku });
    const labelDone =
      kind === "kirim" ? "DIKIRIM" : kind === "terima" ? "DITERIMA" : kind === "bast" ? "BAST/SELESAI" : "BUKTI TERSIMPAN";
    const replyMsg = action.ok
      ? `✅ SJ ${shipment.sj_number} (${shipment.customer_name}) ditandai *${labelDone}*.`
      : `⚠️ ${pesanGagalShipping(shipment.sj_number, action.error)}`;
    const reply = await sendViaWaGateway(target, replyMsg);
    return finish({ shipment_id: shipment.id, sj: shipment.sj_number, dibuat, ok: action.ok, error: action.error, reply });
  }

  // #KAMPANYE — F74: progres kampanye non-KSO dalam scope pengirim (AM = dirinya,
  // HoD = timnya, admin = semua). Baca saja; pengirim wajib dikenal (ketat).
  if (kind === "kampanye") {
    const km = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
    if (!km) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    let text: string;
    try {
      text = await balasanKampanye(extractHashtagArg(row.body, KAMPANYE_LINE), { am_id: km.am_id, nama: km.nama ?? null, role: km.role ?? null });
    } catch (e) {
      console.error("[inbound] #KAMPANYE gagal diproses:", (e as Error).message);
      text = "⚠️ #KAMPANYE gagal diproses, coba lagi sebentar lagi.";
    }
    const reply = await sendViaWaGateway(target, text);
    return finish({ kind: "kampanye", via: km.via, reply });
  }

  // #BRIEF <faskes> — F131: briefing pra-kunjungan, fakta saja. Scope pengirim
  // (AM = faskes miliknya + tanpa pemilik; HoD = timnya + tanpa pemilik).
  if (kind === "brief") {
    const br = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
    if (!br) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    let text: string;
    try {
      const sc = await scopeDariPengirim({ am_id: br.am_id, role: br.role ?? null });
      text = await balasanBrief(extractHashtagArg(row.body, BRIEF_LINE), sc);
    } catch (e) {
      console.error("[inbound] #BRIEF gagal diproses:", (e as Error).message);
      text = "⚠️ #BRIEF gagal diproses, coba lagi sebentar lagi.";
    }
    const reply = await sendViaWaGateway(target, text);
    return finish({ kind: "brief", via: br.via, reply });
  }

  // #FAKTUR <no_invoice> — F91: status Open/Paid/Overdue + jatuh tempo +
  // nominal + customer. Sender cukup dikenal & aktif, setara #CEK (keputusan
  // user 2026-09-28) — tanpa scope per-AM.
  if (kind === "faktur") {
    const fk = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name , ketat: true });
    if (!fk) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const arg = extractHashtagArg(row.body, FAKTUR_LINE);
    if (!arg) {
      const reply = await sendViaWaGateway(target, `⚠️ Isi nomor invoice setelah #FAKTUR, ${fk.nama}. Contoh: #FAKTUR SI.2026.09.00123`);
      return finish({ error: "empty-query", via: fk.via, reply });
    }
    const reply = await sendViaWaGateway(target, await buildFakturReply(arg));
    return finish({ kind: "faktur", via: fk.via, reply });
  }

  // #CALL / #NOTE <faskes>: <isi> — F95 Interaction Log. Dicatat ke
  // interaction_log, BUKAN activity_log (keputusan user 2026-10-13: tak ikut KPI
  // aktivitas AM). Pengirim ketat seperti #CEK/#FAKTUR. Faskes ambigu/tak
  // ketemu → TIDAK dicatat, dibalas minta ketik ulang; catatan yang menempel ke
  // faskes yang salah jauh lebih mahal daripada satu pesan ulang.
  if (kind === "call" || kind === "note") {
    const pc = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name, ketat: true });
    if (!pc) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const p = parseInteraksi(row.body, kind);
    if (!p.ok) {
      const reply = await sendViaWaGateway(target, balasanFormat(kind, p.alasan, pc.nama));
      return finish({ error: `format:${p.alasan}`, via: pc.via, reply });
    }
    const akun = await cariAkun(p.customer);
    if (akun.kind === "none") {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Faskes "${p.customer}" tidak ketemu di master customer, ${pc.nama} — ${kind === "call" ? "#CALL" : "#NOTE"} BELUM dicatat. Cek ejaan nama faskesnya lalu kirim ulang.`,
      );
      return finish({ error: "customer-not-found", query: p.customer, via: pc.via, reply });
    }
    if (akun.kind === "ambiguous") {
      const reply = await sendViaWaGateway(target, balasanAmbiguInteraksi(kind, p.customer, akun.names, p.isi));
      return finish({ error: "customer-ambiguous", query: p.customer, candidates: akun.names, via: pc.via, reply });
    }
    const catat = await catatInteraksi({
      account_id: akun.ids[0],
      jenis: kind,
      isi: p.isi,
      am_id: pc.am_id,
      pencatat_nama: pc.nama,
      customer_query: p.customer,
      source: "wa",
      group_jid: row.group_jid,
      wa_message_id: row.message_id,
    });
    const reply = await sendViaWaGateway(target, balasanTercatat(kind, akun.name, pc.nama));
    return finish({ interaction_id: catat.id, baru: catat.baru, account_id: akun.ids[0], customer: akun.name, via: pc.via, reply });
  }


  // #OVERTIME — pengajuan lembur SEBELUM lembur. Format: "#overtime 2 jam 30
  // menit - closing laporan". Identitas lewat resolveSender (master_user),
  // divisi/HoD lewat employee.am_id. Hanya posisi/divisi yang ada di
  // overtime_rule yang boleh mengajukan (dinamis, diatur admin). Pengirim tak
  // dikenal → SILENT (pola sama #SALES); pengirim dikenal tapi tak berhak atau
  // format salah → dibalas jelas, bukan diam.
  if (kind === "overtime") {
    const amo = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name });
    if (!amo) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    const parsedOt = parseOvertimeArg(extractHashtagArg(row.body, OVERTIME_LINE));
    if ("error" in parsedOt) {
      const hint =
        parsedOt.error === "uraian-kosong"
          ? "Tulis juga pekerjaan yang dikerjakan."
          : parsedOt.error === "durasi-terlalu-panjang"
            ? "Estimasi maksimal 12 jam per pengajuan."
            : "Tulis estimasi durasi di depan.";
      const reply = await sendViaWaGateway(
        target,
        `⚠️ #OVERTIME belum lengkap, ${amo.nama}. ${hint}\nFormat: #overtime 2 jam 30 menit - closing laporan bulanan`,
      );
      return finish({ error: parsedOt.error, reply });
    }
    const profile = await getPengajuProfile(amo.am_id, amo.nama);
    const sub = await submitOvertime({
      profile,
      menit: parsedOt.menit,
      uraian: parsedOt.uraian,
      group_jid: row.group_jid,
      wa_message_id: row.id,
    });
    if (!sub.ok) {
      const reply = await sendViaWaGateway(
        target,
        sub.error === "tidak-berhak"
          ? `⚠️ ${amo.nama}, posisi/divisimu belum terdaftar untuk mengajukan lembur lewat #OVERTIME. Hubungi admin bila ini keliru.`
          : `⚠️ #OVERTIME gagal dicatat: ${sub.message ?? "kesalahan sistem"}`,
      );
      return finish({ error: sub.error, am_id: amo.am_id, reply });
    }
    const r = sub.row;
    const menunggu = sub.notify.ok
      ? `Menunggu persetujuan ${r.approver_nama ?? "HoD divisi"}.`
      : `Tercatat, tapi HoD belum bisa dihubungi (${sub.notify.error}). Admin akan menindaklanjuti.`;
    const reply = await sendViaWaGateway(
      target,
      `🕒 Pengajuan lembur ${r.kode} tercatat, ${r.nama}.\n${formatDurasi(r.estimasi_menit)} — ${r.uraian}\n${menunggu}`,
    );
    return finish({ overtime_id: r.id, kode: r.kode, notified: sub.notify.ok, duplicate: sub.duplicate ?? false, reply });
  }

  // #APPROVE/#REJECT OT-xxxx [alasan] — keputusan HoD atas pengajuan lembur,
  // dari WA PRIVAT (di grup sender_jid = group_jid → resolveApprover menolak).
  // Approver = akun app_user (HoD/Direktur), BUKAN master_user/AM. Pengirim
  // tak dikenal → SILENT. Otorisasi akhir di decideOvertime().
  if (kind === "approve" || kind === "reject") {
    const approver = await resolveApprover(row.sender_jid);
    if (!approver) return finish({ skipped: "unknown-approver", sender_name: row.sender_name });
    const line = stripInvisible(row.body ?? "").split(/\r?\n/).find((l) => new RegExp(`^\\s*#\\s*${kind}\\b`, "i").test(l)) ?? "";
    const parsed = parseApprovalMessage(line, kind);
    if (!parsed) {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Format #${kind.toUpperCase()} tak lengkap, ${approver.name}. Sertakan kode, mis. "#${kind.toUpperCase()} OT-0001".`,
      );
      return finish({ error: `${kind}-empty`, reply });
    }
    if ("error" in parsed || !parsed.kode.startsWith("OT-")) {
      const sebab = "error" in parsed ? parsed.error : `kode ${parsed.kode} tidak dikenal, format: OT-0001`;
      const reply = await sendViaWaGateway(target, `⚠️ #${kind.toUpperCase()} gagal diproses, ${approver.name}: ${sebab}`);
      return finish({ error: sebab, reply });
    }
    const od = await decideOvertime(
      { kode: parsed.kode },
      kind,
      { name: approver.name, hodKey: approver.hodKey, privileged: approver.role === "admin" || approver.role === "direktur" },
      parsed.note,
    );
    if (!od.ok) {
      const reply = await sendViaWaGateway(target, `⚠️ ${parsed.kode} gagal diproses, ${approver.name}: ${od.error}`);
      return finish({ ok: false, error: od.error, reply });
    }
    const reply = await sendViaWaGateway(
      target,
      kind === "reject"
        ? `❌ ${parsed.kode} ditolak, tercatat. Terima kasih, ${approver.name}.`
        : `✅ ${parsed.kode} disetujui, tercatat. Terima kasih, ${approver.name}.`,
    );
    return finish({ ok: true, status: od.row.status, overtime_id: od.row.id, reply });
  }

  // #SALES — query analitik on-demand. Resolve pengirim (by phone/pushname),
  // scope AM→self via role, jawab teks ringkas.
  if (kind === "sales") {
    const ams = await resolveSender({ senderJid: row.sender_jid, groupJid: row.group_jid, pushname: row.sender_name , ketat: true });
    if (!ams) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
    let text: string;
    try {
      text = await handleSalesAnalyticsQuery(row.body ?? "", { am_id: ams.am_id, nama: ams.nama ?? null, role: ams.role ?? null });
    } catch (e) {
      text = `⚠️ Query #SALES gagal diproses: ${(e as Error).message}`;
    }
    const reply = await sendViaWaGateway(target, text);
    return finish({ kind: "sales", via: ams.via, reply });
  }

  // #PLAN/#REPORT — parse DULU (body-name dibutuhkan untuk resolusi Tier-A).
  const parsed = parseDaily(row.body ?? "");
  const am = await resolveSender({
    bodyName: parsed?.name ?? null,
    senderJid: row.sender_jid,
    groupJid: row.group_jid,
    pushname: row.sender_name,
  });
  // Pengirim tak dikenal / nonaktif → SILENT (tak balas).
  if (!am) return finish({ skipped: "unknown-sender", sender_name: row.sender_name });
  if (!am.aktif) return finish({ skipped: "inactive", am_id: am.am_id });
  // Track grup terakhir submit (untuk compliance reminder per-grup).
  await sql`UPDATE master_user SET last_active_group = ${row.group_jid}, last_active_at = now() WHERE am_id = ${am.am_id}`;

  if (!parsed || parsed.itemCount === 0) {
    // submission terdeteksi tapi tak ada item → kemungkinan salah format (hint).
    const reply = await sendViaWaGateway(
      target,
      `⚠️ ${kind === "plan" ? "Plan" : "Report"} terdeteksi tapi item kosong, ${am.nama}. Pakai daftar bernomor (1. 2. 3. …).`,
    );
    return finish({ error: "empty-items", via: am.via, reply });
  }
  const tanggal = parsed.tanggal ?? wibDate();

  const amFlow = isAmRole(am.role);

  if (kind === "plan") {
    if (amFlow) {
      const ap = parseAmPlan(row.body ?? "");
      if (ap.customers.length === 0) {
        const reply = await sendViaWaGateway(target, `⚠️ Plan AM tak terbaca, ${am.nama}. Format: 1. Customer | tujuan | goal`);
        return finish({ error: "am-plan-empty", via: am.via, reply });
      }
      const tgl = ap.tanggal ?? wibDate();
      const r = await insertSalesPlan(am.am_id, tgl, ap.customers, am.role, row.received_at);
      let body = `✅ Plan tercatat, ${am.nama}\n\n📅 ${fmtTanggalDisplay(tgl)}\n🗒️ ${r.count} customer visit${r.late ? "\n⚠️ telat (lewat batas)" : ""}`;
      // Peringatan selisih tanggal berlaku di jalur PLAN juga, bukan cuma REPORT.
      // Plan yang difile ke tanggal salah lebih merusak daripada report yang
      // salah tanggal: report malamnya tak menemukan plan untuk dicocokkan →
      // is_unmatched → kunjungannya tak terhitung sama sekali. Audit export grup
      // The ALLIANCE vs prod (9 Sep 2026) menemukan 56 item plan hilang karena
      // ini — mis. "#PLAN Sidqi 16/06/2026" dikirim 17 Jun, "#Plan Vicky
      // 02/06/2026" dikirim 2 Jul, "#PLAN 04/07/2026" dikirim 4 Agu.
      if (row.received_at) {
        const [{ tgl_pesan }] = await sql<{ tgl_pesan: string }[]>`
          SELECT (${row.received_at}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date::text AS tgl_pesan`;
        const peringatan = buildPeringatanTanggalPlan(tgl, String(tgl_pesan));
        if (peringatan) body += peringatan;
      }
      const reply = await sendViaWaGateway(target, body);
      return finish({ am_id: am.am_id, via: am.via, mode: "am", tanggal: tgl, customers: r.count, reply });
    }
    const r = await upsertDailyTodo({
      am_id: am.am_id,
      am_name: am.nama,
      tanggal,
      items: parsed.items,
      raw_body: row.body ?? undefined,
      role: am.role,
      submitted_at: row.received_at,
    });
    const reply = await sendViaWaGateway(
      target,
      `✅ Plan tercatat, ${am.nama} — ${r.total_items} item — ${tanggal}${r.is_late_plan ? " (telat)" : ""}`,
    );
    return finish({ am_id: am.am_id, via: am.via, tanggal, total_items: r.total_items, todo_id: r.id, reply });
  }

  // report
  if (amFlow) {
    const ar = parseAmReport(row.body ?? "");
    if (ar.items.length === 0) {
      const reply = await sendViaWaGateway(
        target,
        `⚠️ Report AM tak terbaca, ${am.nama}.\nFormat: \`Customer — hasil — next step\` (boleh tambah \`— tipe\`: Fisik/Telepon/WA/Demo/Presentasi/Follow-up)\natau: 1. Customer / hasil: … / next: …`,
      );
      return finish({ error: "am-report-empty", via: am.via, reply });
    }
    const ikat = await tanggalIkatLaporan(am.am_id, ar.tanggal ?? wibDate(), row.received_at);
    const tgl = ikat.tanggal;
    const res = await insertAmActivities(am.am_id, tgl, ar.items, row.message_id);
    // Foto yang datang BERSAMA laporan ini dipasang sekarang — sebelum daftar
    // `pend` dihitung, supaya balasan tak menagih foto yang sudah ada.
    const foto = await tempelFotoLaporan(row, tgl);
    const [tot] = await sql`
      SELECT count(*)::int AS plan_total, count(*) FILTER (WHERE reported)::int AS reported
      FROM sales_plan WHERE am_id = ${am.am_id} AND tanggal = ${tgl}
    `;
    const pend = await sql`
      SELECT customer_name FROM activity_log
      WHERE am_id = ${am.am_id} AND tanggal = ${tgl} AND photo_path IS NULL AND plan_id IS NOT NULL ORDER BY id
    `;
    const pendingNames = pend.map((p) => String(p.customer_name));
    // Foto sudah menempel tapi koordinatnya nihil → tak akan pernah lolos filter
    // menu Visits. `photo_geotag IS NULL` = tak ada overlay sama sekali;
    // `->>'lat' IS NULL` = overlay kebaca (jam masuk) tapi koordinatnya gagal OCR
    // (lihat tempelFotoLaporan: geo disimpan walau cuma jamnya yang utuh).
    const tanpaGeoRows = await sql`
      SELECT customer_name, (photo_geotag IS NOT NULL) AS ada_overlay
      FROM activity_log
      WHERE am_id = ${am.am_id} AND tanggal = ${tgl} AND plan_id IS NOT NULL
        AND photo_path IS NOT NULL
        AND (photo_geotag IS NULL OR photo_geotag->>'lat' IS NULL)
      ORDER BY id
    `;
    const tanpaGeo = tanpaGeoRows.map((r) => ({
      customer: String(r.customer_name),
      adaOverlay: r.ada_overlay === true,
    }));
    // note: TGL ket → am_reminder (fired H-1/H oleh scheduler reminder-h/h-1).
    let reminders = 0;
    for (const nt of ar.notes) {
      if (!nt.reminder_date || !nt.keterangan) continue;
      await createReminder({
        am_id: am.am_id,
        am_name: am.nama,
        reminder_date: nt.reminder_date,
        note: nt.keterangan,
        customer_name: nt.customer ?? undefined,
      });
      reminders += 1;
    }
    let body = buildAmReportReply(am.nama, tgl, ar.items.length, res, Number(tot.plan_total), Number(tot.reported), pendingNames, tanpaGeo);
    // Pergeseran tanggal HARUS terlihat oleh AM — kalau tebakannya salah, dia
    // satu-satunya yang bisa mengoreksi. Menggeser diam-diam = mengulang kelas
    // bug yang perbaikan ini justru tutup.
    if (ikat.digeser) {
      body += `\n\n🕛 Laporan masuk lewat tengah malam dan tak ada rencana ${ikat.dari}, jadi dicocokkan ke rencana ${tgl}. Kalau keliru, kirim ulang dengan menulis tanggalnya.`;
    }
    // Selisih tanggal header vs tanggal pesan HARUS terlihat AM — alasan
    // lengkap di AMBANG_SELISIH_TANGGAL. Tak ditampilkan kalau tanggalnya
    // sudah digeser H-1, karena blok di atas sudah menjelaskan pergeseran itu.
    if (!ikat.digeser) {
      const [{ tgl_pesan }] = await sql<{ tgl_pesan: string }[]>`
        SELECT (${row.received_at}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date::text AS tgl_pesan`;
      const peringatan = buildPeringatanTanggal(tgl, String(tgl_pesan));
      if (peringatan) body += peringatan;
    }
    if (reminders > 0) body += `\n\n📌 ${reminders} reminder dijadwalkan.`;
    const reply = await sendViaWaGateway(target, body);
    return finish({ am_id: am.am_id, via: am.via, mode: "am", tanggal: tgl, tanggal_asal: ikat.dari, digeser_h1: ikat.digeser, matched: res.matched, unmatched: res.unmatched, linked: res.linked, reminders, tanpa_geo: tanpaGeo.length, reply, ...(foto ?? {}) });
  }
  // report todo — cocokkan vs plan + balasan kaya (match/baru)
  const rep = await markReported(am.am_id, am.nama, tanggal, parsed.items, row.body ?? "");
  const reply = await sendViaWaGateway(target, buildReportReply(am.nama, tanggal, rep));
  return finish({ am_id: am.am_id, via: am.via, tanggal, items: rep.n, matched: rep.matched, baru: rep.baru, reply });
}

// Proses batch pesan wa_message yang belum diproses & mengandung hashtag.
export async function processUnprocessed(
  limit = 50,
): Promise<{ enabled: boolean; processed: number; replied: number; results: Record<string, unknown>[] }> {
  if (!isInboundEnabled()) {
    return { enabled: false, processed: 0, replied: 0, results: [] };
  }
  const sql = db();
  const rows = await sql`
    SELECT id::text, group_jid, sender_jid, sender_name, body, message_type, message_id, received_at::text,
           media_path, geo_lat, geo_lon, geo_ts, geo_address
    FROM wa_message
    WHERE processed_at IS NULL
      AND (body ~* ${inboundHashtagPattern()}
           OR (message_type ~* '^image' AND media_path IS NOT NULL)
           -- Dokumen (PDF e-banking) TIDAK ber-hashtag: body-nya cuma
           -- '<media:document>'. Tanpa cabang ini, lampiran #KORAN yang dikirim
           -- sebagai pesan terpisah tak pernah terjaring sama sekali.
           -- Sengaja SEMPIT — hanya dokumen yang grupnya memang sedang menyetor
           -- #KORAN — supaya setiap PDF di grup lain tidak ikut diklaim.
           OR (media_path IS NOT NULL
               AND message_type ~* '^(application|document)'
               AND EXISTS (
                 SELECT 1 FROM wa_message k
                 WHERE k.group_jid = wa_message.group_jid
                   AND k.body ~* '#\\s*koran'
                   AND k.received_at BETWEEN wa_message.received_at - interval '10 minutes'
                                         AND wa_message.received_at + interval '10 minutes'
               )))
    ORDER BY received_at ASC LIMIT ${limit}
  `;
  const results: Record<string, unknown>[] = [];
  let processed = 0;
  let replied = 0;
  for (const r of rows) {
    // Klaim atomik sebelum proses: cegah dua invocation konkuren (mis. webhook
    // ke-deliver 2× / overlap webhook+cron) memproses & MEMBALAS baris yang
    // sama. UPDATE …WHERE processed_at IS NULL mengunci baris; hanya pemenang
    // yg dapat RETURNING, yg kalah skip → tidak ada double-reply.
    const claim = await sql`
      UPDATE wa_message SET processed_at = now()
      WHERE id = ${r.id} AND processed_at IS NULL
      RETURNING id
    `;
    if (claim.length === 0) continue;
    if (!groupAllowed(String(r.group_jid))) {
      await sql`UPDATE wa_message SET processed_kind = 'group-skip' WHERE id = ${r.id}`;
      continue;
    }
    const out = await processInboundMessage(r as unknown as WaRow);
    results.push(out);
    processed += 1;
    const reply = out.reply as WaSendResult | undefined;
    if (reply?.sent) replied += 1;
  }
  return { enabled: true, processed, replied, results };
}
