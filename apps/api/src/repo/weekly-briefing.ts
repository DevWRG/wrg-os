// F63 — Weekly Briefing Direktur Auto-Generator.
//
// Tiap Senin 07:00: baca rekap + resume (monitor_digest) minggu ISO yang BARU TUTUP
// → services/ai /weekend-briefing (mode "senin") menyusun briefing untuk minggu yang
// baru mulai → simpan di briefing_mingguan (UPSERT per minggu, migrasi 245) → WA ke
// Direktur berupa RINGKASAN singkat + LINK unduh PDF (isi lengkap ada di PDF; keputusan
// user 11 Nov 2026: isi di pesan WA terlalu panjang). Angka nyata dari papan WatchPoint
// minggu dasar ikut dikirim ke AI sebagai bahan, dan dicetak sendiri di PDF.
//
// Beda dari weekendbriefing.ts (Sabtu/Minggu, kind='briefing', generate-only): job itu
// tetap jalan; ini punya tabel, jendela minggu ISO, rekap sebagai input, dan WA link.
// Status LLM tak pernah "diperhalus": bila narasi gagal, yang tersimpan hanya catatan
// dan WA TIDAK dikirim (link ke briefing kosong tak berguna bagi Direktur).

import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { memberGroupMaps } from "./monitor.js";
import { direkturTarget } from "./senin-brief.js";
import { currentWeek, periodeLabel, previousWeek, weekRange, wibToday } from "./watchpoint-week.js";
import { getWeeklyBoard, type WeeklyBoard } from "./watchpoint-weekly.js";
import { formatWaRingkas, metrikMerah, ringkasHod, teksAngka } from "./weekly-briefing-angka.js";

// Satu dokumen digest dipotong supaya prompt tak meledak (rekap bisa banyak per hari).
export const MAKS_DOK = 6000;

// Bahan minimum. DB dev menyimpan digest yang DISAMARKAN ("[digest disamarkan]");
// uji 11 Nov 2026 memberi LLM 41 dokumen begitu dan ia mengarang seluruh narasi
// (prospek, customer, isu). Dokumen samaran/kosong tak dihitung bahan, dan tanpa
// bahan cukup briefing TIDAK disusun — lebih baik tak ada daripada cerita karangan.
export const MIN_BAHAN = 1500;

/** Murni (diuji): isi digest yang benar-benar bahan — bukan samaran/placeholder. */
export function bahanNyata(content: string): boolean {
  const t = content.trim();
  return t.length > 0 && !/^\[[^\]]*disamarkan[^\]]*\]$/i.test(t);
}

export interface Jendela {
  /** Minggu yang briefing-nya dibuat (minggu berjalan pada `now`, kecuali dioverride). */
  target: { isoYear: number; isoWeek: number; from: string; to: string };
  /** Minggu yang rekap/resume-nya dibaca (minggu sebelum target). */
  dasar: { isoYear: number; isoWeek: number; from: string; to: string };
}

/** Murni (diuji). `target` default = minggu ISO berjalan menurut WIB. */
export function jendelaBriefing(now: Date = new Date(), target?: { isoYear: number; isoWeek: number }): Jendela {
  const t = target ?? currentWeek(now);
  const d = previousWeek(t.isoYear, t.isoWeek);
  return {
    target: { ...t, ...weekRange(t.isoYear, t.isoWeek) },
    dasar: { ...d, ...weekRange(d.isoYear, d.isoWeek) },
  };
}

export function labelBriefing(j: Jendela): string {
  return `Briefing Minggu Depan: ${periodeLabel(j.target.from, j.target.to)} (dasar: rekap & resume ${periodeLabel(j.dasar.from, j.dasar.to)})`;
}

export function potongDok(teks: string, maks = MAKS_DOK): string {
  return teks.length <= maks ? teks : `${teks.slice(0, maks)}\n[…dipotong, ${teks.length - maks} karakter lagi]`;
}

/** Link ke halaman unduh PDF (halaman, bukan file: yang belum login diarahkan ke /login lalu kembali). */
export function linkPdf(base: string, isoYear: number, isoWeek: number): string | null {
  const b = base.replace(/\/$/, "");
  return b ? `${b}/briefings/unduh/${isoYear}/${isoWeek}` : null;
}

/** Papan WatchPoint minggu dasar; null bila gagal (briefing tetap jalan tanpa angka). */
export async function papanDasar(isoYear: number, isoWeek: number): Promise<WeeklyBoard | null> {
  try {
    return await getWeeklyBoard(isoYear, isoWeek);
  } catch (e) {
    console.error("[weekly-briefing] papan WatchPoint gagal dibaca:", (e as Error).message);
    return null;
  }
}

export interface WeeklyBriefingResult {
  iso_year: number;
  iso_week: number;
  n_rekap: number;
  n_resume: number;
  stored: boolean;
  narasi_ok: boolean;
  model?: string | null;
  error?: string;
  wa_preview?: string | null;
  wa?: { target: string | null; sent: boolean; error?: string; skipped?: string };
}

/** Target WA: env eksplisit (mis. grup riset saat uji), jika kosong → akun Direktur. */
export async function targetBriefing(): Promise<string | null> {
  const env = process.env.WEEKLY_BRIEFING_TARGET?.trim();
  return env || direkturTarget();
}

export async function runWeeklyBriefing(opts: {
  dryRun?: boolean;
  /** true = kirim link WA setelah tersimpan (job Senin). Default false (generate ulang manual). */
  kirimWa?: boolean;
  isoYear?: number;
  isoWeek?: number;
  now?: Date;
} = {}): Promise<WeeklyBriefingResult> {
  const now = opts.now ?? new Date();
  const j = jendelaBriefing(now, opts.isoYear && opts.isoWeek ? { isoYear: opts.isoYear, isoWeek: opts.isoWeek } : undefined);
  const hasil: WeeklyBriefingResult = {
    iso_year: j.target.isoYear, iso_week: j.target.isoWeek, n_rekap: 0, n_resume: 0, stored: false, narasi_ok: false,
  };
  const sql = db();

  const docs = await sql`
    SELECT kind, tanggal::text AS tanggal, waktu, content
    FROM monitor_digest
    WHERE kind IN ('rekap', 'resume')
      AND tanggal BETWEEN ${j.dasar.from}::date AND ${j.dasar.to}::date
      AND content IS NOT NULL AND content <> ''
    ORDER BY tanggal, waktu, kind
  `;
  const nyata = docs.filter((d) => bahanNyata(String(d.content)));
  hasil.n_rekap = nyata.filter((d) => d.kind === "rekap").length;
  hasil.n_resume = nyata.filter((d) => d.kind === "resume").length;
  if (docs.length === 0) {
    return { ...hasil, error: `tak ada rekap/resume ${j.dasar.from} s/d ${j.dasar.to}` };
  }
  const panjangBahan = nyata.reduce((a, d) => a + String(d.content).length, 0);
  if (panjangBahan < MIN_BAHAN) {
    return {
      ...hasil,
      error: `bahan rekap/resume ${j.dasar.from} s/d ${j.dasar.to} terlalu sedikit (${panjangBahan} karakter dari ${docs.length} dokumen; ` +
        `${docs.length - nyata.length} disamarkan/kosong) — briefing tidak disusun supaya narasi tak dikarang`,
    };
  }

  const label = labelBriefing(j);
  const board = await papanDasar(j.dasar.isoYear, j.dasar.isoWeek);
  const { members, groups } = await memberGroupMaps();
  const pola = await sql`SELECT group_jid, content FROM monitor_pola WHERE content IS NOT NULL AND content <> ''`;
  const { status, data } = await callAi("/weekend-briefing", {
    mode: "senin",
    tanggal: wibToday(now).toISOString().slice(0, 10),
    minggu_label: label,
    resumes: nyata.map((d) => ({
      label: `${String(d.kind).toUpperCase()} ${d.tanggal} ${d.waktu ?? ""}`.trim(),
      text: potongDok(String(d.content)),
    })),
    members,
    groups,
    pola: pola.map((p) => ({ jid: String(p.group_jid), content: String(p.content) })),
    angka: board ? teksAngka(board) : null,
    dry_run: aiDryRun(),
  }).catch((e) => ({
    status: 503,
    data: { error: `services/ai tak terjangkau: ${e instanceof Error ? e.message : String(e)}` } as Record<string, unknown>,
  }));

  let briefing = status === 200 ? String(data.briefing ?? "").trim() : "";
  const narasiOk = briefing.length >= 50 && !data.dry_run;
  if (narasiOk) {
    // Layer-2 anti-halusinasi (pelajaran weekendbriefing): paksa label periode kanonik.
    briefing = briefing.replace(/\*\*Briefing[^\n*]*\*\*/, `**${label}**`);
  } else {
    const sebab = status !== 200 ? String(data.error ?? `services/ai ${status}`) : data.dry_run ? "mode dry-run" : "narasi kosong";
    briefing = `> ⚠️ Briefing mingguan tidak berhasil disusun (${sebab}). Dasar: ${hasil.n_rekap} rekap + ${hasil.n_resume} resume ${periodeLabel(j.dasar.from, j.dasar.to)}.\n`;
    hasil.error = sebab;
  }
  hasil.narasi_ok = narasiOk;
  hasil.model = data.model ? String(data.model) : null;

  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  const waText = formatWaRingkas({
    isoWeek: j.target.isoWeek,
    periode: periodeLabel(j.target.from, j.target.to),
    dasar: periodeLabel(j.dasar.from, j.dasar.to),
    hod: board ? ringkasHod(board) : null,
    merah: board ? metrikMerah(board, 3) : [],
    link: linkPdf(base, j.target.isoYear, j.target.isoWeek),
  });
  if (opts.dryRun) return { ...hasil, wa_preview: waText };

  const [row] = await sql`
    INSERT INTO briefing_mingguan (iso_year, iso_week, periode, dasar_dari, dasar_sampai, n_rekap, n_resume, content, narasi_ok, model_used)
    VALUES (${j.target.isoYear}, ${j.target.isoWeek}, ${periodeLabel(j.target.from, j.target.to)},
            ${j.dasar.from}, ${j.dasar.to}, ${hasil.n_rekap}, ${hasil.n_resume}, ${briefing}, ${narasiOk}, ${hasil.model ?? null})
    ON CONFLICT (iso_year, iso_week) DO UPDATE SET
      periode = EXCLUDED.periode, dasar_dari = EXCLUDED.dasar_dari, dasar_sampai = EXCLUDED.dasar_sampai,
      n_rekap = EXCLUDED.n_rekap, n_resume = EXCLUDED.n_resume, content = EXCLUDED.content,
      narasi_ok = EXCLUDED.narasi_ok, model_used = EXCLUDED.model_used, generated_at = now()
    RETURNING id
  `;
  hasil.stored = true;

  if (opts.kirimWa !== true) {
    hasil.wa = { target: null, sent: false, skipped: "kirimWa=false" };
    return hasil;
  }
  // Tiap percobaan kirim menimpa SEMUA kolom wa_* (sisa sukses lama tak boleh bersanding dgn error baru).
  const catat = (target: string | null, sent: boolean, error: string | null) =>
    sql`UPDATE briefing_mingguan SET wa_target = ${target}, wa_sent_at = ${sent ? sql`now()` : null}, wa_error = ${error} WHERE id = ${row.id}`;
  if (!narasiOk) {
    hasil.wa = { target: null, sent: false, skipped: "narasi gagal — ringkasan tidak dikirim" };
    await catat(null, false, "narasi gagal — ringkasan tidak dikirim");
    return hasil;
  }
  if (!waText) {
    hasil.wa = { target: null, sent: false, error: "WEB_PUBLIC_URL kosong — tak ada link untuk dikirim" };
    await catat(null, false, hasil.wa.error!);
    return hasil;
  }
  const target = await targetBriefing();
  if (!target) {
    hasil.wa = { target: null, sent: false, error: "target WA tak ditemukan (WEEKLY_BRIEFING_TARGET / nomor akun direktur)" };
    await catat(null, false, hasil.wa.error!);
    return hasil;
  }
  const r = await sendViaWaGateway(target, waText);
  hasil.wa = { target, sent: r.sent, error: r.error };
  await catat(target, r.sent, r.error ?? null);
  return hasil;
}

export interface BriefingMingguanRow {
  id: string;
  iso_year: number;
  iso_week: number;
  periode: string;
  dasar_dari: string;
  dasar_sampai: string;
  n_rekap: number;
  n_resume: number;
  content: string;
  narasi_ok: boolean;
  model_used: string | null;
  /** Nomor tujuan TIDAK diekspos ke web (dibaca semua pemegang menu /briefings). */
  wa_terkirim: boolean;
  wa_sent_at: string | null;
  wa_error: string | null;
  generated_at: string;
}

function mapRow(r: Record<string, unknown>): BriefingMingguanRow {
  return {
    id: String(r.id), iso_year: Number(r.iso_year), iso_week: Number(r.iso_week), periode: String(r.periode),
    dasar_dari: String(r.dasar_dari), dasar_sampai: String(r.dasar_sampai),
    n_rekap: Number(r.n_rekap), n_resume: Number(r.n_resume),
    content: String(r.content), narasi_ok: Boolean(r.narasi_ok),
    model_used: r.model_used ? String(r.model_used) : null,
    wa_terkirim: r.wa_sent_at !== null,
    wa_sent_at: r.wa_sent_at ? String(r.wa_sent_at) : null,
    wa_error: r.wa_error ? String(r.wa_error) : null,
    generated_at: String(r.generated_at),
  };
}

export async function getBriefingMingguan(isoYear: number, isoWeek: number): Promise<BriefingMingguanRow | null> {
  const [r] = await db()`
    SELECT id::text, iso_year, iso_week, periode, dasar_dari::text, dasar_sampai::text, n_rekap, n_resume,
           content, narasi_ok, model_used, wa_sent_at::text, wa_error, generated_at::text
    FROM briefing_mingguan WHERE iso_year = ${isoYear} AND iso_week = ${isoWeek}
  `;
  return r ? mapRow(r) : null;
}

export async function listBriefingMingguan(limit = 12): Promise<BriefingMingguanRow[]> {
  const rows = await db()`
    SELECT id::text, iso_year, iso_week, periode, dasar_dari::text, dasar_sampai::text, n_rekap, n_resume,
           content, narasi_ok, model_used, wa_sent_at::text, wa_error, generated_at::text
    FROM briefing_mingguan ORDER BY iso_year DESC, iso_week DESC LIMIT ${limit}
  `;
  return rows.map(mapRow);
}

