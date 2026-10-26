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

// Semua baris item OUTSTANDING (bertag TUA maupun tidak) — bahan penilaian umur
// QW2: ambang ditentukan di sini, bukan lagi oleh tag LLM (>4 jam untuk semua).
export function extractOutstanding(content: string): string[] {
  const lines = content.split(/\r?\n/);
  let capture = false;
  const out: string[] = [];
  for (const raw of lines) {
    if (/^\s*⏳\s*OUTSTANDING/.test(raw)) {
      capture = true;
      continue;
    }
    if (capture && (/^\s*\d+\.\s/.test(raw) || /^\s*Generated:/.test(raw) || /^\s*={3,}/.test(raw))) break;
    if (!capture) continue;
    const l = raw.trim();
    // baris kosong / "Tidak ada" bukan item
    if (l && /^[•*-]/.test(l)) out.push(l);
  }
  return out;
}

// ── Action items lewat tenggat ───────────────────────────────────────────────
// Section "3. ACTION ITEMS OUTSTANDING": "• PIC → tugas | deadline | status".
// Tugas yang tenggatnya sudah lewat ikut jadi TUA. Tenggat di resume berupa teks
// bebas LLM; yang tak terbaca pasti diabaikan (bukan ditebak).
export function extractActionItems(content: string): string[] {
  const out: string[] = [];
  let capture = false;
  for (const raw of content.split(/\r?\n/)) {
    if (/^\s*\d+\.\s*ACTION\s+ITEM/i.test(raw)) {
      capture = true;
      continue;
    }
    if (capture && (/^\s*\d+\.\s/.test(raw) || /^\s*Generated:/.test(raw) || /^\s*={3,}/.test(raw))) break;
    const l = raw.trim();
    if (capture && /^[•*-]/.test(l)) out.push(l);
  }
  return out;
}

const BULAN_ID: Record<string, number> = {
  jan: 0, januari: 0, feb: 1, februari: 1, mar: 2, maret: 2, apr: 3, april: 3, mei: 4, jun: 5, juni: 5,
  jul: 6, juli: 6, agu: 7, agt: 7, agustus: 7, sep: 8, sept: 8, september: 8, okt: 9, oktober: 9,
  nov: 10, november: 10, des: 11, desember: 11,
};

const DAY = 24 * 60 * 60 * 1000;

// Tenggat → ms (pseudo-UTC, jam dinding WIB). Tanpa jam = akhir hari itu.
// `nowWibMs` = Date.now()+7 jam, selaras wibNow(). Tak terbaca → null.
export function parseTenggat(teks: string, nowWibMs: number): number | null {
  const s = teks.toLowerCase().replace(/^\s*(?:deadline|tenggat|due)\s*[:=-]?\s*/, "").trim();
  const now = new Date(nowWibMs);
  const hariIni = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let tgl: number | null = null;
  let m: RegExpExecArray | null;
  if (/\bhari ini\b/.test(s)) tgl = hariIni;
  else if (/\bkemarin\b/.test(s)) tgl = hariIni - DAY;
  else if (/\bbesok\b/.test(s)) tgl = hariIni + DAY;
  else if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s))) tgl = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  else if ((m = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(s)) && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
    tgl = Date.UTC(tahun(m[3], +m[2] - 1, +m[1], now), +m[2] - 1, +m[1]);
  } else if ((m = /\b(\d{1,2})\s+([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/.exec(s)) && BULAN_ID[m[2]] != null) {
    tgl = Date.UTC(tahun(m[3], BULAN_ID[m[2]], +m[1], now), BULAN_ID[m[2]], +m[1]);
  }
  if (tgl == null || Number.isNaN(tgl)) return null;
  const jam = /\b(?:jam\s*)?([01]?\d|2[0-3])[.:]([0-5]\d)\b/.exec(s);
  return jam ? tgl + (+jam[1] * 60 + +jam[2]) * 60000 : tgl + DAY - 60000;
}

// Tahun eksplisit dipakai; tanpa tahun: tahun berjalan, kecuali tanggalnya >6 bulan
// ke depan (berarti maksudnya tahun lalu, mis. "28 Des" dibaca di bulan Januari).
function tahun(y: string | undefined, bulan: number, tgl: number, now: Date): number {
  if (y) return y.length === 2 ? 2000 + +y : +y;
  const th = now.getUTCFullYear();
  return Date.UTC(th, bulan, tgl) - now.getTime() > 183 * DAY ? th - 1 : th;
}

export interface AksiLewat {
  raw: string; // baris sintetis berformat TUA, siap untuk formatTuaItem
  it: TuaItem;
  lewatMenit: number;
}

// Satu baris action item → item TUA bila tenggatnya lewat; selain itu null.
export function aksiLewatTenggat(line: string, nowWibMs: number): AksiLewat | null {
  const segmen = bersihkan(line.replace(/^\s*[•*-]\s*/, ""))
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
  if (segmen.length < 2) return null;
  const [kepala, ...sisa] = segmen;
  const bagi = kepala.split(/\s*(?:→|->)\s*/);
  const pic = bagi.length > 1 ? bagi[0] : "";
  const tugas = (bagi.length > 1 ? bagi.slice(1).join(" → ") : kepala).trim();
  let tenggat: number | null = null;
  let tenggatTeks = "";
  const lain: string[] = [];
  for (const seg of sisa) {
    const t: number | null = tenggat == null ? parseTenggat(seg, nowWibMs) : null;
    if (t != null) {
      tenggat = t;
      tenggatTeks = seg.replace(/^\s*(?:deadline|tenggat|due)\s*[:=-]?\s*/i, "");
    } else lain.push(seg);
  }
  if (!tugas || tenggat == null || nowWibMs <= tenggat) return null;
  const lewatMenit = Math.round((nowWibMs - tenggat) / 60000);
  const status = lain.map((x) => x.replace(/^status\s*:?\s*/i, "")).join("; ");
  const raw = [
    `• ${tugas.charAt(0).toUpperCase()}${tugas.slice(1)}`,
    pic ? `dari ${pic}` : "",
    `lewat tenggat ${tenggatTeks} (${umurTeks(lewatMenit)} lewat)`,
    status ? `status: ${status}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  return { raw, it: parseTuaLine(raw), lewatMenit };
}

// Signature topic-only: buang bullet & segala setelah '|', sort-unik, sha256.
// `eskalasi` = topik yang baru naik ke eskalasi Direktur; masuk signature supaya
// eskalasi baru tetap terkirim walau himpunan item TUA-nya sama.
function signature(tua: string[], eskalasi: string[] = []): string {
  const topics = Array.from(
    new Set(tua.map((l) => l.replace(/^•\s*/, "").replace(/\s*\|.*$/, "").trim())),
  ).sort();
  const esk = eskalasi.slice().sort().map((k) => `!${k}`);
  return createHash("sha256").update([...topics, ...esk].join("\n")).digest("hex");
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

// ── QW2: ambang bertingkat + eskalasi Harga ──────────────────────────────────
// Direktur (rapat 2026-10-19): konfirmasi yang belum clear = TUA bila jeda >8 jam;
// untuk komunikasi soal Harga ambangnya >4 jam, dan >2 hari dieskalasi ke Direktur.
export type KategoriTua = "harga" | "umum";

export const AMBANG_TUA_MENIT: Record<KategoriTua, number> = { harga: 4 * 60, umum: 8 * 60 };
export const ESKALASI_MENIT = 2 * 24 * 60;

const KATA_HARGA = /\b(harga|price(?:\s*list)?|pricelist|quote|quotation|penawaran|sph|diskon|discount|nett?|launching)\b/i;

export function kategoriItem(it: TuaItem): KategoriTua {
  return KATA_HARGA.test([it.topik, it.status ?? "", ...it.lain].join(" ")) ? "harga" : "umum";
}

// "10 jam", "1 jam 20 menit", "2 hari", "45 menit" → menit; tak terbaca → null.
export function umurMenit(umur?: string): number | null {
  if (!umur) return null;
  let total = 0;
  let ada = false;
  for (const m of umur.matchAll(/(\d+(?:[.,]\d+)?)\s*(hari|jam|menit)\b/gi)) {
    const n = Number(m[1].replace(",", "."));
    const u = m[2].toLowerCase();
    total += n * (u === "hari" ? 1440 : u === "jam" ? 60 : 1);
    ada = true;
  }
  return ada ? Math.round(total) : null;
}

// Kunci stabil per topik (huruf kecil, tanpa tanda baca) untuk tabel tua_item.
export function topikKey(topik: string): string {
  const norm = topik.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export interface NilaiTua {
  kategori: KategoriTua;
  umur: number | null; // menit efektif = max(umur di resume, sejak pertama terlihat)
  tua: boolean;
  eskalasi: boolean;
}

// `bertag` = baris sudah ditandai TUA oleh LLM (>4 jam): dipakai hanya bila umur
// tak terbaca sama sekali, supaya item tak hilang diam-diam.
export function nilaiItem(it: TuaItem, bertag: boolean, firstSeenMs: number | null, nowMs: number): NilaiTua {
  const kategori = kategoriItem(it);
  const dariResume = umurMenit(it.umur);
  const dariTracking = firstSeenMs == null ? null : Math.max(0, Math.round((nowMs - firstSeenMs) / 60000));
  const umur = dariResume == null && dariTracking == null ? null : Math.max(dariResume ?? 0, dariTracking ?? 0);
  const tua = umur == null ? bertag : umur >= AMBANG_TUA_MENIT[kategori];
  return { kategori, umur, tua, eskalasi: kategori === "harga" && umur != null && umur > ESKALASI_MENIT };
}

export function umurTeks(menit: number): string {
  if (menit >= 2 * 1440) return `${Math.floor(menit / 1440)} hari`;
  if (menit >= 60) return `${Math.floor(menit / 60)} jam`;
  return `${menit} menit`;
}

export interface EskalasiItem {
  topik: string;
  umur: number;
}

// ── Piutang lewat jatuh tempo (perpanjangan AR Watch) ────────────────────────
// Sumbernya ar_aging_mv (bukan resume). Yang dihitung hanya yang kritis menurut
// AR Watch (bucket 90+ atau anomali) dan lewat ambang TUA; eskalasi ke Direktur
// bila lewat ambang eskalasi. Ambang bisa diubah lewat AR_TUA_HARI / AR_ESKALASI_HARI.
export interface PiutangRow {
  customer_name: string | null;
  invoice_no: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  is_anomaly: boolean;
}

export interface PiutangItem extends PiutangRow {
  key: string;
  eskalasi: boolean; // lewat ambang eskalasi
  eskBaru: boolean; // eskalasi yang belum pernah terkirim
}

export function ambangPiutang(): { tua: number; eskalasi: number } {
  const n = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
  return { tua: n(process.env.AR_TUA_HARI, 30), eskalasi: n(process.env.AR_ESKALASI_HARI, 60) };
}

export function pilihPiutang(
  rows: PiutangRow[],
  sudahEskalasi: Set<string>,
  ambang = ambangPiutang(),
): PiutangItem[] {
  return rows
    .filter((r) => (r.bucket === "90+" || r.is_anomaly) && r.days_overdue > ambang.tua)
    .map((r) => {
      const key = topikKey(`piutang ${r.invoice_no}`);
      const eskalasi = r.days_overdue > ambang.eskalasi;
      return { ...r, key, eskalasi, eskBaru: eskalasi && !sudahEskalasi.has(key) };
    })
    .sort((a, b) => b.days_overdue - a.days_overdue || b.amount - a.amount);
}

const rupiah = (n: number): string => `Rp ${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const barisPiutang = (p: PiutangItem): string =>
  `• ${p.invoice_no} — ${p.customer_name || "(tanpa nama)"} — ${rupiah(p.amount)} — ${p.days_overdue} hari`;

// Link dashboard: WEB_PUBLIC_URL (domain publik) didahulukan — selaras dgn
// weeklyreport.ts. NOTIF_TUA_DASHBOARD_URL cuma cadangan: nilainya di prod
// pernah menunjuk host tailnet yang tak bisa dibuka penerima di luar tailnet.
export function dashboardLink(): string {
  const base = (process.env.WEB_PUBLIC_URL || process.env.NOTIF_TUA_DASHBOARD_URL || "").replace(/\/+$/, "");
  return base ? `${base}/monitor/resume` : "";
}

export function buildMessage(
  tua: string[],
  tanggal: string,
  jam: string,
  eskalasi: EskalasiItem[] = [],
  piutang: PiutangItem[] = [],
): string {
  const count = tua.length;
  const judul = count ? `🚨 *${count} Item TUA — Perlu Follow-Up*` : `🚨 *Piutang Lewat Jatuh Tempo — Perlu Follow-Up*`;
  const sumber = count ? "dari Resume Eksekutif" : "dari AR Aging";
  let msg = `${judul}\n_${tanggalPendek(tanggal)} · ${jam} WIB · ${sumber}_`;
  if (count) msg += `\n\n${tua.slice(0, 5).map((l, i) => formatTuaItem(l, i + 1)).join("\n\n")}`;
  if (eskalasi.length) {
    const baris = eskalasi.slice(0, 5).map((e) => `• ${e.topik} — ${umurTeks(e.umur)}`).join("\n");
    msg += `\n\n🔺 *Eskalasi ke Direktur — Harga belum clear >2 hari*\n${baris}`;
  }
  if (count > 5) msg += `\n\n_…+${count - 5} item lainnya._`;
  if (piutang.length) {
    msg += `\n\n💸 *${piutang.length} Piutang Kritis Lewat Jatuh Tempo*\n${piutang.slice(0, 5).map(barisPiutang).join("\n")}`;
    if (piutang.length > 5) msg += `\n_…+${piutang.length - 5} faktur lainnya._`;
    const esk = piutang.filter((p) => p.eskBaru);
    if (esk.length) {
      msg += `\n\n🔺 *Eskalasi ke Direktur — piutang lewat jatuh tempo >${ambangPiutang().eskalasi} hari*\n${esk.slice(0, 5).map(barisPiutang).join("\n")}`;
      if (esk.length > 5) msg += `\n_…+${esk.length - 5} faktur lainnya._`;
    }
  }
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
  // Piutang (AR Aging) tak bergantung pada resume, jadi tak adanya resume hanya
  // mematikan bagian TUA-nya; "no-resume" dikembalikan bila piutang juga kosong.
  const isiResume = row ? String(row.content) : "";

  // Item yang tak terlihat >3 hari dianggap selesai (LLM kadang melewatkan satu
  // run, jadi tidak langsung dihapus saat absen).
  if (!opts.dryRun) await sql`DELETE FROM tua_item WHERE last_seen < now() - interval '3 days'`;

  const baris = extractOutstanding(isiResume);
  const parsed = baris.map((l) => {
    const it = parseTuaLine(l);
    return { raw: l, it, key: topikKey(it.topik || l), bertag: /TUA/.test(l) };
  });
  const keys = parsed.map((p) => p.key);
  const tercatat = new Map<string, { first: number; eskalasi: boolean }>();
  if (keys.length) {
    const rows = await sql`SELECT topik_key, first_seen, eskalasi_at FROM tua_item WHERE topik_key = ANY(${keys}::text[])`;
    for (const r of rows) tercatat.set(String(r.topik_key), { first: new Date(r.first_seen as string).getTime(), eskalasi: r.eskalasi_at != null });
  }
  const nowMs = Date.now();
  const nilai = parsed.map((p) => ({ ...p, n: nilaiItem(p.it, p.bertag, tercatat.get(p.key)?.first ?? null, nowMs) }));

  // Action items yang lewat tenggat: selalu TUA; Harga lewat >2 hari ikut eskalasi.
  // Topik yang sama dengan item OUTSTANDING tidak dihitung dua kali.
  const nowWib = nowMs + 7 * 3600 * 1000;
  const sudahAda = new Set(nilai.map((p) => p.key));
  const aksi = extractActionItems(isiResume)
    .map((l) => aksiLewatTenggat(l, nowWib))
    .filter((a): a is AksiLewat => a !== null)
    .map((a) => ({ raw: a.raw, it: a.it, key: topikKey(`aksi ${a.it.topik}`), bertag: true, lewat: a.lewatMenit }))
    .filter((a) => !sudahAda.has(a.key) && !sudahAda.has(topikKey(a.it.topik)));
  if (aksi.length) {
    const aksiKeys = aksi.map((a) => a.key);
    const rows = await sql`SELECT topik_key, first_seen, eskalasi_at FROM tua_item WHERE topik_key = ANY(${aksiKeys}::text[])`;
    for (const r of rows) tercatat.set(String(r.topik_key), { first: new Date(r.first_seen as string).getTime(), eskalasi: r.eskalasi_at != null });
    for (const a of aksi) {
      const kategori = kategoriItem(a.it);
      nilai.push({
        raw: a.raw,
        it: a.it,
        key: a.key,
        bertag: true,
        n: { kategori, umur: a.lewat, tua: true, eskalasi: kategori === "harga" && a.lewat > ESKALASI_MENIT },
      });
    }
  }

  if (!opts.dryRun) {
    for (const p of nilai) {
      await sql`
        INSERT INTO tua_item (topik_key, topik, kategori)
        VALUES (${p.key}, ${(p.it.topik || p.raw).slice(0, 300)}, ${p.n.kategori})
        ON CONFLICT (topik_key) DO UPDATE SET last_seen = now(), kategori = EXCLUDED.kategori
      `;
    }
  }

  const tuaItems = nilai.filter((p) => p.n.tua);
  const tua = tuaItems.map((p) => p.raw);

  const amb = ambangPiutang();
  const arRows = await sql`
    SELECT customer_name, invoice_no, amount, days_overdue, bucket, is_anomaly
    FROM ar_aging_mv
    WHERE days_overdue > ${amb.tua}
  `;
  const arKeys = arRows.map((r) => topikKey(`piutang ${String(r.invoice_no)}`));
  const arSudah = new Set<string>();
  if (arKeys.length) {
    const rows = await sql`SELECT topik_key FROM tua_item WHERE topik_key = ANY(${arKeys}::text[]) AND eskalasi_at IS NOT NULL`;
    for (const r of rows) arSudah.add(String(r.topik_key));
  }
  const piutang = pilihPiutang(
    arRows.map((r) => ({
      customer_name: r.customer_name ? String(r.customer_name) : null,
      invoice_no: String(r.invoice_no),
      amount: Number(r.amount),
      days_overdue: Number(r.days_overdue),
      bucket: String(r.bucket),
      is_anomaly: Boolean(r.is_anomaly),
    })),
    arSudah,
    amb,
  );
  if (!opts.dryRun) {
    for (const p of piutang) {
      await sql`
        INSERT INTO tua_item (topik_key, topik, kategori)
        VALUES (${p.key}, ${`Piutang ${p.invoice_no} ${p.customer_name ?? ""}`.trim().slice(0, 300)}, 'umum')
        ON CONFLICT (topik_key) DO UPDATE SET last_seen = now()
      `;
    }
  }

  if (!row && piutang.length === 0) return { sent: false, count: 0, skipped: "no-resume" };
  if (tua.length === 0 && piutang.length === 0) {
    // tidak ada item TUA → reset state (item sebelumnya dianggap selesai).
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, '', 0, now())
      ON CONFLICT (key) DO UPDATE SET signature = '', count = 0, sent_at = now()
    `;
    return { sent: false, count: 0, skipped: "no-tua" };
  }

  // eskalasi hanya sekali per item: yang sudah pernah terkirim (eskalasi_at) dilewati.
  const eskBaru = tuaItems.filter((p) => p.n.eskalasi && !tercatat.get(p.key)?.eskalasi);
  const sig = signature(tua, [
    ...eskBaru.map((p) => p.key),
    ...piutang.map((p) => `${p.key}${p.eskBaru ? "!" : ""}`),
  ]);
  const [prev] = await sql`SELECT signature FROM notif_state WHERE key = ${STATE_KEY}`;
  if (!opts.dryRun && prev && String(prev.signature) === sig) {
    return { sent: false, count: tua.length + piutang.length, skipped: "anti-spam" };
  }

  const payload = buildMessage(
    tua,
    tanggal,
    wibJam(),
    eskBaru.map((p) => ({ topik: p.it.topik || p.raw, umur: p.n.umur ?? 0 })),
    piutang,
  );
  if (opts.dryRun) {
    return { sent: false, count: tua.length + piutang.length, dryRun: true, to: target, payload };
  }

  const g = await sendViaWaGateway(target, payload);
  if (g.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at)
      VALUES (${STATE_KEY}, ${sig}, ${tua.length + piutang.length}, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${sig}, count = ${tua.length + piutang.length}, sent_at = now()
    `;
    const eskKeys = [...eskBaru.map((p) => p.key), ...piutang.filter((p) => p.eskBaru).map((p) => p.key)];
    if (eskKeys.length && !g.dryRun) {
      await sql`UPDATE tua_item SET eskalasi_at = now() WHERE topik_key = ANY(${eskKeys}::text[])`;
    }
  }
  return { sent: g.sent, count: tua.length + piutang.length, dryRun: Boolean(g.dryRun), to: target };
}
