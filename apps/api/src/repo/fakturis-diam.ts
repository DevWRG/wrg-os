// F10 bagian 1 — alarm fakturis diam (migrasi 289, docs/features/F10-finance-ops-resilience.md).
//
// Prod 7 Nov 2026: semua faktur 60 hari terakhir dibuat oleh 2 akun Accurate. Komputer/orang
// fakturis berhalangan = penerbitan faktur berhenti tanpa ada yang tahu (briefing 24 Mei: 11+ jam).
//
// Sumber = cermin Accurate: raw->>'createDate' (“dd/mm/yyyy HH:MM:SS”, WIB) + raw->>'createdBy'.
// Dicek SESUDAH sync faktur (scheduler accurate-sync, 2 jam-an Sen–Jum, libur sudah dilewati di
// sana) → tanpa panggilan Accurate tambahan; resolusi deteksi ≈ jadwal sync.
//   • diam = menit jam kerja (default 08–17 WIB) sejak faktur terakhir, atau sejak jam mulai bila
//     faktur terakhir dari hari sebelumnya. ≥ F10_SPOF_JAM (default 3) jam → satu alarm.
//   • faktur pertama sesudah diam → kejadian ditutup + pesan pulih (hanya bila alarmnya terkirim).
// Satu kejadian terbuka paling banyak (indeks unik parsial di 289). Nama akun dari fakturis_akun
// (diisi lewat UI), tidak di kode.
// Saklar F10_SPOF_ENABLED (default mati). Grup: F10_WA_TARGET, cadangan INVOICE_REMINDER_FINANCE_TARGET.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { isoWeek } from "./faktur.js";

const WIB_MS = 7 * 3600 * 1000;

/** “06/11/2026 15:13:00” (WIB) → Date. Format lain → null. */
export function parseCreateDate(s: string | null | undefined): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec((s ?? "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const t = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +(ss ?? 0)) - WIB_MS;
  return Number.isNaN(t) ? null : new Date(t);
}

/** Tanggal WIB (YYYY-MM-DD) dari sebuah instan. */
export const ymdWib = (d: Date): string => new Date(d.getTime() + WIB_MS).toISOString().slice(0, 10);

/** Instan jam `jam`:00 WIB pada tanggal WIB `ymd`. */
const jamWib = (ymd: string, jam: number): Date => new Date(Date.parse(`${ymd}T00:00:00Z`) + jam * 3600 * 1000 - WIB_MS);

export interface JamKerja { mulai: number; selesai: number }

export function jamKerjaDariEnv(): JamKerja {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec((process.env.F10_JAM_KERJA ?? "").trim());
  const mulai = m ? +m[1] : 8;
  const selesai = m ? +m[2] : 17;
  return mulai < selesai && selesai <= 24 ? { mulai, selesai } : { mulai: 8, selesai: 17 };
}

export function ambangJamDariEnv(): number {
  const n = Number(process.env.F10_SPOF_JAM ?? 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * Titik mulai hitung diam pada hari `sekarang`: faktur terakhir bila hari itu sesudah jam mulai,
 * selain itu jam mulai kerja hari itu (faktur kemarin / dini hari tak menghitung malam).
 */
export function awalDiam(terakhir: Date | null, sekarang: Date, jk: JamKerja): Date {
  const mulai = jamWib(ymdWib(sekarang), jk.mulai);
  return terakhir && terakhir > mulai ? terakhir : mulai;
}

/**
 * Menit jam kerja antara `dari` dan `sampai`, dijumlah per hari WIB dan dipotong ke jendela kerja.
 * Sabtu/Minggu dilewati; libur nasional tidak (kejadian lintas libur jarang, dan penghitung hanya
 * dipakai untuk teks durasi — keputusan alarm tetap per hari kerja dari scheduler).
 */
export function menitJamKerja(dari: Date, sampai: Date, jk: JamKerja): number {
  let total = 0;
  for (let ymd = ymdWib(dari); ymd <= ymdWib(sampai); ymd = new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const a = Math.max(dari.getTime(), jamWib(ymd, jk.mulai).getTime());
    const b = Math.min(sampai.getTime(), jamWib(ymd, jk.selesai).getTime());
    if (b > a) total += b - a;
  }
  return Math.floor(total / 60000);
}

export const durasiTeks = (menit: number): string => {
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return j && m ? `${j} jam ${m} mnt` : j ? `${j} jam` : `${m} mnt`;
};

const jamTeks = (d: Date): string => new Date(d.getTime() + WIB_MS).toISOString().slice(11, 16);
const tglJamTeks = (d: Date, acuan: Date): string =>
  ymdWib(d) === ymdWib(acuan)
    ? `${jamTeks(d)} WIB`
    : `${new Date(d.getTime() + WIB_MS).toLocaleDateString("id-ID", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })} ${jamTeks(d)} WIB`;

export interface FakturTerakhir { nomor: string; akun: string | null; label: string | null; at: Date }

const namaAkun = (f: FakturTerakhir): string => f.label ?? (f.akun ? `akun Accurate ${f.akun}` : "akun tak diketahui");

export function buildAlarmWa(terakhir: FakturTerakhir | null, sejak: Date, menit: number, sekarang: Date): string {
  return [
    `⚠️ *Faktur berhenti terbit* — ${durasiTeks(menit)} jam kerja tanpa faktur baru di Accurate.`,
    terakhir
      ? `Faktur terakhir: ${terakhir.nomor} · ${tglJamTeks(terakhir.at, sekarang)} · ${namaAkun(terakhir)}.`
      : `Belum ada faktur sejak ${tglJamTeks(sejak, sekarang)}.`,
    "",
    "Mohon cek komputer/akun fakturis. Kalau memang sedang tidak ada faktur yang perlu dibuat, abaikan pesan ini.",
  ].join("\n");
}

export function buildPulihWa(baru: FakturTerakhir, sejak: Date, menit: number): string {
  return `✅ *Faktur terbit lagi* — ${baru.nomor} · ${jamTeks(baru.at)} WIB · ${namaAkun(baru)}. Diam ${durasiTeks(menit)} jam kerja sejak ${jamTeks(sejak)} WIB.`;
}

// ---------------------------------------------------------------- data

/** Faktur dengan createDate paling akhir. Dibatasi 10 hari tanggal faktur supaya tak memindai raw seluruh mirror. */
export async function fakturTerakhir(): Promise<FakturTerakhir | null> {
  const rows = await db()<{ number: string; created_by: string | null; create_date: string | null; label: string | null }[]>`
    SELECT i.number, i.raw->>'createdBy' AS created_by, i.raw->>'createDate' AS create_date, a.label
      FROM accurate_invoice i
      LEFT JOIN fakturis_akun a ON a.created_by = i.raw->>'createdBy'
     WHERE i.tanggal >= current_date - 10 AND i.raw ? 'createDate'`;
  let best: FakturTerakhir | null = null;
  for (const r of rows) {
    const at = parseCreateDate(r.create_date);
    if (at && (!best || at > best.at)) best = { nomor: r.number, akun: r.created_by, label: r.label, at };
  }
  return best;
}

const waTarget = () => (process.env.F10_WA_TARGET ?? "").trim() || (process.env.INVOICE_REMINDER_FINANCE_TARGET ?? "").trim();

async function kirim(text: string): Promise<{ sent: boolean; error?: string }> {
  const target = waTarget();
  if (!target) return { sent: false, error: "F10_WA_TARGET / INVOICE_REMINDER_FINANCE_TARGET kosong" };
  const w = await sendViaWaGateway(target, text);
  return { sent: w.sent && !w.stub && !w.dryRun, error: w.error }; // stub & dry-run gateway juga sent=true
}

export interface CekDiamResult {
  aksi: "alarm" | "pulih" | "normal" | "masih-diam";
  menit: number;
  ambang_jam: number;
  terakhir: string | null;
  sent?: boolean;
  dryRun: boolean;
  payload?: string;
  error?: string;
}

/** Dipanggil scheduler sesudah sync faktur sukses di hari kerja. `sekarang` untuk uji. */
export async function runCekFakturisDiam(opts: { dryRun?: boolean; sekarang?: Date } = {}): Promise<CekDiamResult> {
  const sekarang = opts.sekarang ?? new Date();
  const dryRun = Boolean(opts.dryRun);
  const jk = jamKerjaDariEnv();
  const ambang = ambangJamDariEnv();
  const sql = db();
  const terakhir = await fakturTerakhir();
  const [buka] = await sql<{ id: string; sejak_at: Date; alarm_terkirim: boolean }[]>`
    SELECT id::text, sejak_at, alarm_terkirim FROM fakturis_diam WHERE pulih_at IS NULL LIMIT 1`;
  const base = { ambang_jam: ambang, terakhir: terakhir?.nomor ?? null, dryRun };

  if (buka) {
    const sejak = new Date(buka.sejak_at);
    if (terakhir && terakhir.at > sejak) {
      const menit = menitJamKerja(sejak, terakhir.at, jk);
      const text = buildPulihWa(terakhir, sejak, menit);
      if (dryRun) return { ...base, aksi: "pulih", menit, payload: text };
      const w = buka.alarm_terkirim ? await kirim(text) : { sent: false };
      await sql`UPDATE fakturis_diam SET pulih_at = ${terakhir.at}, pulih_faktur = ${terakhir.nomor}, pulih_terkirim = ${w.sent}
                 WHERE id = ${buka.id}`;
      return { ...base, aksi: "pulih", menit, sent: w.sent, error: w.error };
    }
    return { ...base, aksi: "masih-diam", menit: menitJamKerja(sejak, sekarang, jk) };
  }

  const sejak = awalDiam(terakhir?.at ?? null, sekarang, jk);
  const menit = menitJamKerja(sejak, sekarang, jk);
  if (menit < ambang * 60) return { ...base, aksi: "normal", menit };
  const text = buildAlarmWa(terakhir, sejak, menit, sekarang);
  if (dryRun) return { ...base, aksi: "alarm", menit, payload: text };
  const w = await kirim(text);
  await sql`INSERT INTO fakturis_diam (sejak_at, alarm_terkirim, faktur_terakhir)
            VALUES (${sejak}, ${w.sent}, ${terakhir?.nomor ?? null}) ON CONFLICT DO NOTHING`;
  return { ...base, aksi: "alarm", menit, sent: w.sent, error: w.error };
}

// ---------------------------------------------------------------- rekap mingguan

export interface BebanAkun { akun: string | null; label: string | null; faktur: number }

export function buildRekapFakturisWa(minggu: string, beban: BebanAkun[], diam: { kejadian: number; menit: number }): string {
  const total = beban.reduce((s, b) => s + b.faktur, 0);
  const urut = [...beban].sort((a, b) => b.faktur - a.faktur);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return [
    `🧾 *Penerbitan faktur minggu ${minggu}* — ${total} faktur oleh ${urut.length} akun.`,
    ...urut.map((b) => `• ${b.label ?? (b.akun ? `akun Accurate ${b.akun}` : "akun tak diketahui")}: ${b.faktur} (${pct(b.faktur)}%)`),
    diam.kejadian
      ? `Fakturis diam: ${diam.kejadian} kali, total ${durasiTeks(diam.menit)} jam kerja.`
      : "Tidak ada kejadian fakturis diam.",
    ...(urut.length && pct(urut[0].faktur) >= 70
      ? ["", `Satu akun memegang ${pct(urut[0].faktur)}% faktur — siapkan cadangan kalau orangnya berhalangan.`]
      : []),
  ].join("\n");
}

/** Rekap minggu ISO sebelumnya, sekali per minggu (notif_state). Dipanggil scheduler di hari kerja. */
export async function runRekapFakturis(opts: { dryRun?: boolean; sekarang?: Date } = {}) {
  const sekarang = opts.sekarang ?? new Date();
  const dryRun = Boolean(opts.dryRun);
  const hariIni = ymdWib(sekarang);
  const dow = (new Date(`${hariIni}T00:00:00Z`).getUTCDay() + 6) % 7; // Senin = 0
  const seninIni = new Date(Date.parse(`${hariIni}T00:00:00Z`) - dow * 86400000).toISOString().slice(0, 10);
  const seninLalu = new Date(Date.parse(`${seninIni}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const minggu = isoWeek(seninLalu);
  const key = `f10-fakturis-rekap:${minggu}`;
  const sql = db();
  if (!dryRun) {
    const [done] = await sql`SELECT 1 FROM notif_state WHERE key = ${key}`;
    if (done) return { minggu, sent: false, dryRun, skipped: `sudah terkirim minggu ${minggu}` };
  }
  const dari = jamWib(seninLalu, 0);
  const sampai = jamWib(seninIni, 0);
  const rows = await sql<{ created_by: string | null; create_date: string | null; label: string | null }[]>`
    SELECT i.raw->>'createdBy' AS created_by, i.raw->>'createDate' AS create_date, a.label
      FROM accurate_invoice i
      LEFT JOIN fakturis_akun a ON a.created_by = i.raw->>'createdBy'
     WHERE i.tanggal >= ${seninLalu}::date - 10 AND i.raw ? 'createDate'`;
  const per = new Map<string, BebanAkun>();
  for (const r of rows) {
    const at = parseCreateDate(r.create_date);
    if (!at || at < dari || at >= sampai) continue;
    const k = r.created_by ?? "";
    const b = per.get(k) ?? { akun: r.created_by, label: r.label, faktur: 0 };
    b.faktur += 1;
    per.set(k, b);
  }
  const jk = jamKerjaDariEnv();
  const kejadian = await sql<{ sejak_at: Date; pulih_at: Date | null }[]>`
    SELECT sejak_at, pulih_at FROM fakturis_diam WHERE sejak_at >= ${dari} AND sejak_at < ${sampai}`;
  const menit = kejadian.reduce((s, k) => s + (k.pulih_at ? menitJamKerja(new Date(k.sejak_at), new Date(k.pulih_at), jk) : 0), 0);
  const text = buildRekapFakturisWa(minggu, [...per.values()], { kejadian: kejadian.length, menit });
  if (dryRun) return { minggu, sent: false, dryRun, payload: text };
  const w = await kirim(text);
  if (w.sent) {
    await sql`INSERT INTO notif_state (key, signature, count, sent_at) VALUES (${key}, ${hariIni}, 1, now())
      ON CONFLICT (key) DO UPDATE SET signature = EXCLUDED.signature, count = notif_state.count + 1, sent_at = now()`;
  }
  return { minggu, sent: w.sent, dryRun, error: w.error };
}
