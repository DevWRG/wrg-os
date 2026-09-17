import { createHash } from "node:crypto";

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";

// Notifikasi item TUA — port wrg-monitor/scripts/notif_tua.sh.
// Baca resume eksekutif terbaru (monitor_digest kind='resume') hari ini,
// ekstrak section "⏳ OUTSTANDING" yang ber-tag TUA (umur >4 jam), lalu kirim
// top-5 ke grup tujuan (NOTIF_TUA_TARGET). Idempotent via tabel notif_state:
// signature topic-only → skip bila set item sama dgn notif sebelumnya (anti-spam).

const STATE_KEY = "tua";

// WIB (UTC+7) — selaras dgn scheduler & monitor.
const wibNow = (): Date => new Date(Date.now() + 7 * 3600 * 1000);
const wibDate = (): string => wibNow().toISOString().slice(0, 10);
const wibJam = (): string => wibNow().toISOString().slice(11, 16);

// Ekstrak baris item OUTSTANDING ber-tag TUA dari teks resume.
// Mirror awk legacy: capture dari header "⏳ OUTSTANDING" sampai section
// bernomor berikutnya / "Generated:" / garis "=====", lalu filter tag TUA.
export function extractTua(content: string): string[] {
  const lines = content.split(/\r?\n/);
  let capture = false;
  const block: string[] = [];
  for (const raw of lines) {
    if (/^\s*⏳\s*OUTSTANDING/.test(raw)) {
      capture = true;
      continue;
    }
    if (capture && (/^\s*\d+\.\s/.test(raw) || /^\s*Generated:/.test(raw) || /^\s*={3,}/.test(raw))) break;
    if (capture) block.push(raw);
  }
  // tag TUA = uppercase (template: "[TUA jika >4 jam]"); hindari "paling tua" (lowercase).
  return block
    .filter((l) => /TUA/.test(l))
    .map((l) => l.trim())
    .filter(Boolean);
}

// Signature topic-only: buang bullet & segala setelah '|', sort-unik, sha256.
function signature(tua: string[]): string {
  const topics = Array.from(
    new Set(tua.map((l) => l.replace(/^•\s*/, "").replace(/\s*\|.*$/, "").trim())),
  ).sort();
  return createHash("sha256").update(topics.join("\n")).digest("hex");
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// "2026-09-16" → "16 Sep 2026". Bentuk lain dibiarkan apa adanya.
function tanggalPendek(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}`;
}

// Bersihkan artefak resume LLM yang tak berguna di WA:
// - tag [TUA] / [TUA jika >4 jam] (judul pesan sudah bilang TUA — redundan)
// - JID mentah (@138435419455601, @6281...@s.whatsapp.net): tanpa metadata
//   mention, WA merendernya sebagai angka telanjang
// - '@' di depan nama orang: bukan mention beneran, cuma bikin ramai
// - sisa kurung/koma kosong setelah pembersihan di atas
function bersihkan(s: string): string {
  return s
    .replace(/\[\s*TUA[^\]]*\]/gi, "")
    .replace(/@\d[\d\s-]{6,}(?:@[\w.]+)?/g, "")
    .replace(/@(?=\p{L})/gu, "")
    .replace(/\(\s*[,;]*\s*\)/g, "")
    .replace(/\(\s*,\s*/g, "(")
    .replace(/\s*,\s*\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/[\s,;|]+$/, "")
    .trim();
}

// Huruf depan tiap kata dibesarkan, sisanya DIBIARKAN — supaya "Sigit purnomo"
// jadi "Sigit Purnomo" tanpa merusak akronim ("MEP" tetap "MEP").
function kapitalNama(s: string): string {
  return s.replace(/(^|[\s(/-])(\p{Ll})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export interface TuaItem {
  topik: string;
  dari?: string;
  ke?: string;
  sejak?: string;
  umur?: string;
  status?: string;
  lain: string[];
}

// Pecah satu baris OUTSTANDING resume (format prompt services/ai/app/resume.py:
// "• topik | dari X | ke Y | sejak jam HH:MM WIB (umur) [TUA] | status: Z")
// jadi bagian-bagian. Label boleh hilang/berubah urutan — segmen yang tak
// dikenali disimpan di `lain` supaya tak ada informasi yang menguap diam-diam.
export function parseTuaLine(raw: string): TuaItem {
  const segmen = bersihkan(raw.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, ""))
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const item: TuaItem = { topik: segmen.shift() ?? "", lain: [] };
  for (const seg of segmen) {
    const m = /^(dari|ke|kepada|sejak|status|kendala)\b\s*:?\s*(.*)$/i.exec(seg);
    if (!m || !m[2]) {
      item.lain.push(seg);
      continue;
    }
    const label = m[1].toLowerCase();
    const isi = m[2].trim();
    if (label === "dari") item.dari = kapitalNama(isi);
    else if (label === "ke" || label === "kepada") item.ke = kapitalNama(isi);
    else if (label === "sejak") {
      // "jam 12:00 WIB (10 jam)" → sejak "12:00 WIB", umur "10 jam"
      const jam = /(\d{1,2}[.:]\d{2})/.exec(isi);
      const umur = /\(([^)]*\b(?:jam|menit|hari)\b[^)]*)\)/i.exec(isi);
      item.sejak = jam ? `${jam[1].replace(".", ":")} WIB` : isi;
      if (umur) item.umur = umur[1].trim();
    } else item.status = isi.charAt(0).toUpperCase() + isi.slice(1);
  }
  return item;
}

// Satu item → blok multi-baris. Baris judul dibuat tebal utuh (penanda tebal WA
// tak boleh melintasi newline, jadi topik wajib satu baris logis).
export function formatTuaItem(raw: string, nomor: number): string {
  const it = parseTuaLine(raw);
  const baris = [`*${nomor}. ${it.topik || raw.trim()}*`];
  const alur = [it.dari, it.ke].filter(Boolean).join(" → ");
  if (alur) baris.push(`   ${alur}`);
  const waktu = [it.sejak ? `Sejak ${it.sejak}` : "", it.umur].filter(Boolean).join(" · ");
  if (waktu) baris.push(`   ⏱ ${waktu}`);
  if (it.status) baris.push(`   📌 ${it.status}`);
  for (const l of it.lain) baris.push(`   ${l}`);
  return baris.join("\n");
}

// Link dashboard: WEB_PUBLIC_URL (domain publik) didahulukan — selaras dgn
// weeklyreport.ts. NOTIF_TUA_DASHBOARD_URL cuma cadangan: nilainya di prod
// pernah menunjuk host tailnet yang tak bisa dibuka penerima di luar tailnet.
export function dashboardLink(): string {
  const base = (process.env.WEB_PUBLIC_URL || process.env.NOTIF_TUA_DASHBOARD_URL || "").replace(/\/+$/, "");
  return base ? `${base}/monitor/resume` : "";
}

export function buildMessage(tua: string[], tanggal: string, jam: string): string {
  const count = tua.length;
  const items = tua.slice(0, 5).map((l, i) => formatTuaItem(l, i + 1)).join("\n\n");
  let msg = `🚨 *${count} Item TUA — Perlu Follow-Up*\n_${tanggalPendek(tanggal)} · ${jam} WIB · dari Resume Eksekutif_\n\n${items}`;
  if (count > 5) msg += `\n\n_…+${count - 5} item lainnya._`;
  const link = dashboardLink();
  if (link) msg += `\n\n🔗 Detail: ${link}`;
  return msg;
}

export interface NotifTuaResult {
  sent: boolean;
  count: number;
  skipped?: "no-target" | "no-resume" | "no-tua" | "anti-spam";
  dryRun?: boolean;
  to?: string;
  payload?: string;
}

export async function runNotifTua(opts: { dryRun?: boolean; target?: string } = {}): Promise<NotifTuaResult> {
  const target = opts.target || process.env.NOTIF_TUA_TARGET || "";
  if (!target) return { sent: false, count: 0, skipped: "no-target" };

  const sql = db();
  const tanggal = wibDate();
  const [row] = await sql`
    SELECT content FROM monitor_digest
    WHERE kind = 'resume' AND tanggal = ${tanggal}
    ORDER BY waktu DESC NULLS LAST, id DESC
    LIMIT 1
  `;
  if (!row) return { sent: false, count: 0, skipped: "no-resume" };

  const tua = extractTua(String(row.content));
  if (tua.length === 0) {
    // tidak ada item TUA → reset state (item sebelumnya dianggap selesai).
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, '', 0, now())
      ON CONFLICT (key) DO UPDATE SET signature = '', count = 0, sent_at = now()
    `;
    return { sent: false, count: 0, skipped: "no-tua" };
  }

  const sig = signature(tua);
  const [prev] = await sql`SELECT signature FROM notif_state WHERE key = ${STATE_KEY}`;
  if (!opts.dryRun && prev && String(prev.signature) === sig) {
    return { sent: false, count: tua.length, skipped: "anti-spam" };
  }

  const payload = buildMessage(tua, tanggal, wibJam());
  if (opts.dryRun) {
    return { sent: false, count: tua.length, dryRun: true, to: target, payload };
  }

  const g = await sendViaWaGateway(target, payload);
  if (g.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, ${sig}, ${tua.length}, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${sig}, count = ${tua.length}, sent_at = now()
    `;
  }
  return { sent: g.sent, count: tua.length, dryRun: Boolean(g.dryRun), to: target };
}
