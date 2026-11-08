// F10 bagian 2 — faktur revisi + SLA (migrasi 290, docs/features/F10-finance-ops-resilience.md).
//
// WA `#REVISI <nomor faktur> | alasan` (pengirim ketat) membuka tiket dengan jam permintaan + batas SLA
// (default 8 jam kerja = 1 hari kerja; Sabtu/Minggu + Kalender Libur F14 dilewati). Tiket ditutup OTOMATIS
// oleh sync faktur (scheduler accurate-sync) begitu Accurate menunjukkan revisinya:
//   • nomor sama dengan id berbeda (faktur dihapus lalu diinput ulang), atau
//   • raw->>'optLock' naik pada id yang sama (diedit di tempat).
// Input ulang yang tak pernah di-#REVISI tetap dicatat dari accurate_invoice_hilang (sumber 'deteksi',
// tanpa SLA) supaya pola revisi kelihatan. Lewat SLA → satu pengingat ke grup Finance.
// Saklar F10_REVISI_ENABLED (default mati) untuk hashtag + hook sync. Grup: F10_WA_TARGET, cadangan
// INVOICE_REMINDER_FINANCE_TARGET (sama dengan alarm fakturis diam).

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { jamKerjaDariEnv, parseCreateDate, ymdWib, type JamKerja } from "./fakturis-diam.js";

const WIB_MS = 7 * 3600 * 1000;

export const revisiAktif = (): boolean => (process.env.F10_REVISI_ENABLED ?? "false").toLowerCase() === "true";

export function slaJamKerjaDariEnv(): number {
  const n = Number(process.env.F10_REVISI_SLA_JAM_KERJA ?? 8);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

// ---------------------------------------------------------------- parser

export type HasilParse = { ok: true; nomor: string; alasan: string } | { ok: false; alasan: "kosong" | "tanpa-alasan" };

/** Argumen sesudah #REVISI: “PJK/1459-2606-JBR | harga item ke-2 salah”. Pemisah `|` atau ` - `/`:` sesudah nomor. */
export function parseRevisi(arg: string): HasilParse {
  const s = arg.trim();
  if (!s) return { ok: false, alasan: "kosong" };
  const m = /^(\S+)\s*(?:\||:|-\s|—)\s*(.*)$/s.exec(s);
  const nomor = (m ? m[1] : s.split(/\s+/)[0]).replace(/[.,;]+$/, "").toUpperCase();
  const alasan = (m ? m[2] : s.slice(s.split(/\s+/)[0].length)).replace(/^\s*[|:—-]\s*/, "").trim();
  if (!alasan) return { ok: false, alasan: "tanpa-alasan" };
  return { ok: true, nomor, alasan: alasan.slice(0, 500) };
}

export const CONTOH_REVISI = "#REVISI PJK/1459-2606-JBR | harga item ke-2 salah, harusnya 1.250.000";

// ---------------------------------------------------------------- SLA jam kerja

const jamWib = (ymd: string, jam: number): number => Date.parse(`${ymd}T00:00:00Z`) + jam * 3600 * 1000 - WIB_MS;
const besok = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const hariKerja = (ymd: string, libur: ReadonlySet<string>) => ![0, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay()) && !libur.has(ymd);

/** Instan sesudah `menit` jam kerja dihitung dari `mulai` (lewat malam, akhir pekan, dan `libur`). */
export function tambahMenitKerja(mulai: Date, menit: number, jk: JamKerja, libur: ReadonlySet<string>): Date {
  let sisa = menit * 60000;
  let ymd = ymdWib(mulai);
  let t = mulai.getTime();
  for (let i = 0; i < 400; i++, ymd = besok(ymd)) {
    if (!hariKerja(ymd, libur)) continue;
    const a = Math.max(t, jamWib(ymd, jk.mulai));
    const b = jamWib(ymd, jk.selesai);
    if (b <= a) continue;
    if (a + sisa <= b) return new Date(a + sisa);
    sisa -= b - a;
  }
  return new Date(t + menit * 60000); // tak terjangkau (data libur aneh) — jatuh ke jam kalender
}

/** Menit jam kerja antara dua instan (lewat akhir pekan + libur). */
export function menitKerjaAntara(dari: Date, sampai: Date, jk: JamKerja, libur: ReadonlySet<string>): number {
  let total = 0;
  for (let ymd = ymdWib(dari); ymd <= ymdWib(sampai); ymd = besok(ymd)) {
    if (!hariKerja(ymd, libur)) continue;
    const a = Math.max(dari.getTime(), jamWib(ymd, jk.mulai));
    const b = Math.min(sampai.getTime(), jamWib(ymd, jk.selesai));
    if (b > a) total += b - a;
  }
  return Math.floor(total / 60000);
}

async function liburSekitar(dari: Date, hari = 60): Promise<Set<string>> {
  const rows = await db()<{ t: string }[]>`
    SELECT tanggal::text t FROM master_holiday WHERE tanggal BETWEEN ${ymdWib(new Date(dari.getTime() - hari * 86400000))} AND ${ymdWib(new Date(dari.getTime() + hari * 86400000))}`;
  return new Set(rows.map((r) => r.t));
}

const tglJam = (d: Date) =>
  new Date(d.getTime() + WIB_MS).toLocaleString("id-ID", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, ":");

// ---------------------------------------------------------------- WA

const waTarget = () => (process.env.F10_WA_TARGET ?? "").trim() || (process.env.INVOICE_REMINDER_FINANCE_TARGET ?? "").trim();

async function kirimFinance(text: string, kecuali?: string): Promise<boolean> {
  const t = waTarget();
  if (!t || t === kecuali) return false;
  const w = await sendViaWaGateway(t, text);
  return w.sent && !w.stub && !w.dryRun;
}

interface FakturMirror { id: string; number: string; opt_lock: number | null; create_date: string | null; customer: string | null }

async function cariFaktur(nomor: string): Promise<FakturMirror[]> {
  return db()<FakturMirror[]>`
    SELECT ai.id::text, ai.number, NULLIF(ai.raw->>'optLock','')::int AS opt_lock, ai.raw->>'createDate' AS create_date,
           COALESCE(NULLIF(ac.name,''), NULLIF(ai.raw->'customer'->>'name',''), NULLIF(ai.raw->>'retailWpName','')) AS customer
      FROM accurate_invoice ai
      LEFT JOIN accurate_customer ac ON ac.id = ai.customer_id
     WHERE upper(ai.number) = ${nomor.toUpperCase()}
     ORDER BY ai.id DESC`;
}

/**
 * Proses satu pesan #REVISI. Mengembalikan teks balasan untuk chat pengirim.
 * `chat` = JID chat asal — notifikasi Finance dilewati bila pesan memang dikirim di grup Finance.
 */
export async function bukaRevisi(arg: string, pengirim: { nama: string }, chat?: string, sekarang = new Date()): Promise<string> {
  const p = parseRevisi(arg);
  if (!p.ok) {
    return p.alasan === "kosong"
      ? `⚠️ Isi nomor faktur dan alasan revisinya, ${pengirim.nama}. Contoh:\n${CONTOH_REVISI}`
      : `⚠️ Alasan revisi wajib diisi sesudah tanda |, ${pengirim.nama}. Contoh:\n${CONTOH_REVISI}`;
  }
  const sql = db();
  const faktur = await cariFaktur(p.nomor);
  if (!faktur.length) {
    const [hilang] = await sql<{ id: string }[]>`SELECT id::text FROM accurate_invoice_hilang WHERE upper(number) = ${p.nomor} LIMIT 1`;
    if (!hilang) {
      return `🔎 Faktur "${p.nomor}" tidak ditemukan di salinan Accurate, ${pengirim.nama} — #REVISI BELUM dicatat. Pastikan nomornya lengkap (mis. PJK/1459-2606-JBR). Faktur yang baru terbit tersalin beberapa kali sehari.`;
    }
    return `ℹ️ Faktur "${p.nomor}" sedang dihapus dari Accurate (kemungkinan sedang direvisi). #REVISI BELUM dicatat — kirim ulang sesudah faktur barunya terbit kalau masih perlu revisi lagi.`;
  }
  const [ada] = await sql<{ id: string; diminta_oleh: string | null; batas_sla: Date | null }[]>`
    SELECT id::text, diminta_oleh, batas_sla FROM faktur_revisi WHERE upper(nomor) = ${p.nomor} AND selesai_at IS NULL LIMIT 1`;
  if (ada) {
    return `ℹ️ Revisi ${p.nomor} sudah tercatat sebagai R${ada.id}${ada.diminta_oleh ? ` (oleh ${ada.diminta_oleh})` : ""}${ada.batas_sla ? `, batas ${tglJam(new Date(ada.batas_sla))}` : ""}. Tidak dibuat tiket baru.`;
  }
  const f = faktur[0];
  const jk = jamKerjaDariEnv();
  const sla = slaJamKerjaDariEnv();
  const batas = tambahMenitKerja(sekarang, sla * 60, jk, await liburSekitar(sekarang));
  const [baru] = await sql<{ id: string }[]>`
    INSERT INTO faktur_revisi (nomor, sumber, invoice_id_awal, opt_lock_awal, customer, alasan, diminta_oleh, diminta_at, batas_sla)
    VALUES (${f.number}, 'wa', ${f.id}, ${f.opt_lock}, ${f.customer}, ${p.alasan}, ${pengirim.nama}, ${sekarang}, ${batas})
    ON CONFLICT DO NOTHING RETURNING id::text`;
  if (!baru) return `ℹ️ Revisi ${p.nomor} baru saja dicatat orang lain. Tidak dibuat tiket baru.`;
  await kirimFinance(
    [`📝 *Permintaan revisi faktur R${baru.id}*`, `${f.number}${f.customer ? ` · ${f.customer}` : ""}`, `Alasan: ${p.alasan}`, `Diminta: ${pengirim.nama} · batas ${tglJam(batas)}`].join("\n"),
    chat,
  );
  return `📝 Revisi R${baru.id} tercatat — ${f.number}${f.customer ? ` (${f.customer})` : ""}.\nBatas SLA: ${tglJam(batas)} (${sla} jam kerja). Tiket tertutup otomatis begitu faktur hasil revisinya muncul di Accurate.`;
}

// ---------------------------------------------------------------- hook sesudah sync

export interface SyncRevisiResult { ditutup: number; dideteksi: number; terlambat_dikirim: number }

/** Dipanggil scheduler sesudah sync faktur sukses: tutup otomatis, deteksi input ulang, pengingat lewat SLA. */
export async function prosesRevisiSesudahSync(sekarang = new Date()): Promise<SyncRevisiResult> {
  const sql = db();
  let ditutup = 0, dideteksi = 0, terlambat = 0;

  // 1. Tutup otomatis tiket WA yang terbuka.
  const buka = await sql<{ id: string; nomor: string; invoice_id_awal: string | null; opt_lock_awal: number | null; diminta_at: Date }[]>`
    SELECT id::text, nomor, invoice_id_awal::text, opt_lock_awal, diminta_at FROM faktur_revisi WHERE selesai_at IS NULL AND sumber = 'wa'`;
  for (const t of buka) {
    const faktur = await cariFaktur(t.nomor);
    const pengganti = faktur.find((f) => f.id !== t.invoice_id_awal);
    const diedit = faktur.find((f) => f.id === t.invoice_id_awal && f.opt_lock != null && t.opt_lock_awal != null && f.opt_lock > t.opt_lock_awal);
    if (!pengganti && !diedit) continue;
    let selesai = sekarang;
    if (pengganti) {
      const c = parseCreateDate(pengganti.create_date);
      if (c && c >= new Date(t.diminta_at) && c <= sekarang) selesai = c;
    }
    await sql`UPDATE faktur_revisi
                 SET selesai_at = ${selesai}, cara_selesai = ${pengganti ? "input_ulang" : "edit"},
                     invoice_id_baru = ${pengganti ? pengganti.id : null}
               WHERE id = ${t.id} AND selesai_at IS NULL`;
    ditutup++;
  }

  // 2. Deteksi input ulang tanpa #REVISI (35 hari terakhir arsip hilang).
  const hilang = await sql<{ id: string; number: string; dihapus_at: Date }[]>`
    SELECT h.id::text, h.number, h.dihapus_at
      FROM accurate_invoice_hilang h
     WHERE h.ada_kembaran AND h.dihapus_at >= now() - interval '35 days'
       AND NOT EXISTS (SELECT 1 FROM faktur_revisi r WHERE r.invoice_id_awal = h.id)`;
  for (const h of hilang) {
    const faktur = await cariFaktur(h.number);
    const pengganti = faktur.find((f) => f.id !== h.id);
    if (!pengganti) continue;
    const c = parseCreateDate(pengganti.create_date);
    const r = await sql`
      INSERT INTO faktur_revisi (nomor, sumber, invoice_id_awal, customer, invoice_id_baru, selesai_at, cara_selesai)
      VALUES (${h.number}, 'deteksi', ${h.id}, ${pengganti.customer}, ${pengganti.id}, ${c ?? new Date(h.dihapus_at)}, 'input_ulang')
      ON CONFLICT DO NOTHING`;
    dideteksi += r.count;
  }

  // 3. Pengingat sekali untuk tiket yang lewat SLA.
  const telat = await sql<{ id: string; nomor: string; customer: string | null; alasan: string | null; diminta_oleh: string | null; batas_sla: Date }[]>`
    SELECT id::text, nomor, customer, alasan, diminta_oleh, batas_sla FROM faktur_revisi
     WHERE selesai_at IS NULL AND batas_sla < ${sekarang} AND NOT terlambat_dikirim ORDER BY batas_sla`;
  if (telat.length) {
    const text = [
      `⏰ *${telat.length} revisi faktur lewat SLA*`,
      ...telat.slice(0, 15).map((t) => `• R${t.id} ${t.nomor}${t.customer ? ` · ${t.customer}` : ""} — batas ${tglJam(new Date(t.batas_sla))}${t.diminta_oleh ? ` · diminta ${t.diminta_oleh}` : ""}`),
      ...(telat.length > 15 ? [`… dan ${telat.length - 15} lainnya.`] : []),
      "",
      "Rincian: menu Finance → Penerbitan Faktur → Faktur Revisi.",
    ].join("\n");
    if (await kirimFinance(text)) {
      await sql`UPDATE faktur_revisi SET terlambat_dikirim = true WHERE id IN ${sql(telat.map((t) => t.id))}`;
      terlambat = telat.length;
    }
  }
  return { ditutup, dideteksi, terlambat_dikirim: terlambat };
}

// ---------------------------------------------------------------- layar

export class RevisiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface BarisRevisi {
  id: number; nomor: string; sumber: "wa" | "deteksi"; customer: string | null; alasan: string | null;
  diminta_oleh: string | null; diminta_at: string | null; batas_sla: string | null; selesai_at: string | null;
  cara_selesai: string | null; ditutup_oleh: string | null; catatan: string | null;
  menit_proses: number | null; status: "terbuka" | "terlambat" | "tepat" | "lewat-sla" | "tanpa-sla" | "manual";
}

export async function daftarRevisi(opts: { hari?: unknown } = {}, sekarang = new Date()) {
  const hari = Math.min(180, Math.max(1, Number(opts.hari) || 60));
  const jk = jamKerjaDariEnv();
  const libur = await liburSekitar(sekarang, hari + 30);
  const rows = await db()<{
    id: string; nomor: string; sumber: "wa" | "deteksi"; customer: string | null; alasan: string | null; diminta_oleh: string | null;
    diminta_at: Date | null; batas_sla: Date | null; selesai_at: Date | null; cara_selesai: string | null; ditutup_oleh: string | null; catatan: string | null;
  }[]>`
    SELECT id::text, nomor, sumber, customer, alasan, diminta_oleh, diminta_at, batas_sla, selesai_at, cara_selesai, ditutup_oleh, catatan
      FROM faktur_revisi
     WHERE selesai_at IS NULL OR COALESCE(diminta_at, selesai_at) >= now() - make_interval(days => ${hari})
     ORDER BY (selesai_at IS NULL) DESC, COALESCE(diminta_at, selesai_at) DESC`;
  const items: BarisRevisi[] = rows.map((r) => {
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    const menit = r.diminta_at && r.selesai_at ? menitKerjaAntara(new Date(r.diminta_at), new Date(r.selesai_at), jk, libur) : null;
    const status: BarisRevisi["status"] = !r.selesai_at
      ? (r.batas_sla && new Date(r.batas_sla) < sekarang ? "terlambat" : "terbuka")
      : r.cara_selesai === "manual" ? "manual" // tak ada revisi yang dikerjakan → di luar hitungan SLA
      : !r.batas_sla ? "tanpa-sla" : new Date(r.selesai_at) <= new Date(r.batas_sla) ? "tepat" : "lewat-sla";
    return {
      id: Number(r.id), nomor: r.nomor, sumber: r.sumber, customer: r.customer, alasan: r.alasan, diminta_oleh: r.diminta_oleh,
      diminta_at: iso(r.diminta_at), batas_sla: iso(r.batas_sla), selesai_at: iso(r.selesai_at), cara_selesai: r.cara_selesai,
      ditutup_oleh: r.ditutup_oleh, catatan: r.catatan, menit_proses: menit, status,
    };
  });
  const selesaiSla = items.filter((x) => x.status === "tepat" || x.status === "lewat-sla");
  const durasi = selesaiSla.map((x) => x.menit_proses ?? 0).sort((a, b) => a - b);
  return {
    hari,
    sla_jam_kerja: slaJamKerjaDariEnv(),
    ringkasan: {
      terbuka: items.filter((x) => x.status === "terbuka" || x.status === "terlambat").length,
      terlambat: items.filter((x) => x.status === "terlambat").length,
      selesai_sla: selesaiSla.length,
      tepat_sla_pct: selesaiSla.length ? Math.round((selesaiSla.filter((x) => x.status === "tepat").length / selesaiSla.length) * 100) : null,
      median_menit: durasi.length ? durasi[Math.floor((durasi.length - 1) / 2)] : null,
      tanpa_sla: items.filter((x) => x.status === "tanpa-sla").length,
    },
    items,
  };
}

/** Tutup manual (mis. “tidak perlu revisi”). Catatan wajib. `oleh` dari sesi BFF. */
export async function tutupManual(id: unknown, input: { catatan?: unknown; oleh?: unknown }) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new RevisiError(400, "id tidak sah");
  const catatan = String(input.catatan ?? "").trim();
  if (!catatan) throw new RevisiError(400, "catatan wajib diisi");
  const oleh = String(input.oleh ?? "").trim() || null;
  const r = await db()`UPDATE faktur_revisi SET selesai_at = now(), cara_selesai = 'manual', ditutup_oleh = ${oleh}, catatan = ${catatan.slice(0, 500)}
                        WHERE id = ${n} AND selesai_at IS NULL`;
  if (!r.count) throw new RevisiError(404, "tiket tidak ada atau sudah selesai");
  return { id: n, ok: true };
}
