// F61 Tutup Buku Bulanan Countdown (migrasi 292, issue #1774).
//
// Menjelang tutup buku, penjualan bulan berjalan yang BELUM DIFAKTUR akan meleset ke
// bulan berikutnya. Keputusan user 8 Nov 2026:
//   • isi = per AM: SO "Menunggu diproses" (belum ada DO sama sekali — STATUS_SO_TERBUKA
//     F21) + DO terkirim yang belum difaktur (F149, tab Perlu ditagih; DO KSO tak ikut).
//     SO "Sebagian diproses" sengaja tak dihitung: sisanya terwakili DO-nya.
//   • tanggal tutup buku = hari kerja terakhir bulan (Sabtu/Minggu + master_holiday
//     dilewati), kecuali digeser per bulan di tabel tutup_buku_bulan (layar Finance).
//   • pengingat H-7 / H-3 / H-1 hari kerja ke grup sales per region
//     (TUTUP_BUKU_TARGET_EAST / _WEST), H-1 juga eskalasi ke grup HoD
//     (TUTUP_BUKU_ESKALASI_TARGET). WA pribadi ke AM tak dipakai — openclaw prod
//     memblokir DM keluar di luar allowFrom (audit 8 Nov).
//   Saklar job TUTUP_BUKU_COUNTDOWN_ENABLED (default mati), sekali per (bulan, H-n,
//   tujuan) lewat notif_state.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { listDoBelumFaktur } from "./do-belum-faktur.js";
import { cabangRegionMap } from "./sales.js";
import { amLabelSql, cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { STATUS_SO_TERBUKA } from "./so-pacing.js";

export class TutupBukuError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Region = "East" | "West";
export const REGION: Region[] = ["East", "West"];
export const HARI_PENGINGAT = [7, 3, 1] as const;

// ---------------------------------------------------------------- murni (diuji)

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Hari kerja terakhir bulan "YYYY-MM" (Sabtu/Minggu & libur dilewati). */
export function hariKerjaTerakhir(bulan: string, libur: Set<string>): string {
  const [y, m] = bulan.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // hari terakhir bulan
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || libur.has(ymd(d))) d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

/** Jumlah hari kerja SESUDAH `dari` sampai `ke` (termasuk `ke`). Hari yang sama = 0; lewat = negatif-tak-dihitung → -1. */
export function hariKerjaSampai(dari: string, ke: string, libur: Set<string>): number {
  if (ke < dari) return -1;
  let n = 0;
  const d = new Date(`${dari}T00:00:00Z`);
  while (ymd(d) < ke) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6 && !libur.has(ymd(d))) n++;
  }
  return n;
}

export interface BarisAm { am: string; so: number; so_nilai: number; do_: number; do_nilai: number; do_terlambat: number }
export interface RingkasRegion { region: Region | "LAIN"; so: number; so_nilai: number; do_: number; do_nilai: number; per_am: BarisAm[] }

const rpRingkas = (n: number) =>
  n >= 1e6 ? `Rp${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : `Rp${Math.round(n / 1e3).toLocaleString("id-ID")} rb`;
const tglPanjang = (d: string) =>
  new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long" });
const namaBulan = (bulan: string) =>
  new Date(`${bulan}-01T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", month: "long", year: "numeric" });

export const MAKS_AM = 15;

/** Teks pengingat satu region (murni, diuji). */
export function buildPengingat(r: RingkasRegion, bulan: string, tanggal: string, sisa: number, maks = MAKS_AM): string {
  const kapan = sisa === 1 ? "BESOK" : `${sisa} hari kerja lagi`;
  const baris = r.per_am.slice(0, maks).map((a, i) => {
    const bag = [
      a.so && `${a.so} SO belum dikirim (${rpRingkas(a.so_nilai)})`,
      a.do_ && `${a.do_} DO belum difaktur (${rpRingkas(a.do_nilai)})`,
    ].filter(Boolean).join(" · ");
    return `${i + 1}. ${a.am} — ${bag}`;
  });
  return [
    `⏳ *Tutup buku ${namaBulan(bulan)} — ${tglPanjang(tanggal)} (${kapan})*${r.region === "LAIN" ? "" : ` · Sales ${r.region}`}`,
    `Penjualan yang belum jadi faktur: ${r.so} SO belum dikirim (${rpRingkas(r.so_nilai)}) dan ${r.do_} DO terkirim belum difaktur (${rpRingkas(r.do_nilai)}). Yang belum difaktur sampai tutup buku masuk ke bulan berikutnya.`,
    "",
    "Per AM:",
    ...baris,
    ...(r.per_am.length > maks ? [`… dan ${r.per_am.length - maks} AM lainnya.`] : []),
    "",
    "SO belum dikirim → koordinasi pengiriman dengan gudang/Admin Sales; DO belum difaktur → minta Fakturis menerbitkan faktur. Rincian DO: menu Finance → DO Belum Difaktur. DO KSO tidak ikut (ditagih bulanan).",
  ].join("\n");
}

/** Teks eskalasi H-1 ke grup HoD (murni, diuji) — ringkas per region. */
export function buildEskalasi(regions: RingkasRegion[], bulan: string, tanggal: string): string {
  const baris = regions.filter((r) => r.so + r.do_ > 0).map((r) =>
    `• ${r.region === "LAIN" ? "Tanpa region" : `Sales ${r.region}`}: ${r.so} SO belum dikirim (${rpRingkas(r.so_nilai)}) · ${r.do_} DO belum difaktur (${rpRingkas(r.do_nilai)}) — AM terbanyak: ${r.per_am.slice(0, 3).map((a) => a.am).join(", ") || "—"}`);
  return [
    `🔔 *Eskalasi tutup buku ${namaBulan(bulan)} — BESOK (${tglPanjang(tanggal)})*`,
    "Penjualan berikut belum jadi faktur dan akan masuk ke bulan berikutnya bila tidak selesai besok:",
    ...baris,
    "",
    "Rincian per AM sudah dikirim ke grup sales masing-masing region.",
  ].join("\n");
}

// ---------------------------------------------------------------- data

export const hariIniWib = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

async function liburSekitar(bulan: string): Promise<Set<string>> {
  const rows = await db()`
    SELECT tanggal::text AS t FROM master_holiday
    WHERE tanggal BETWEEN (${bulan + "-01"}::date - interval '1 month') AND (${bulan + "-01"}::date + interval '2 month')`;
  return new Set(rows.map((r) => String(r.t)));
}

/** Tanggal tutup buku bulan ini: geseran di tabel, atau hari kerja terakhir bulan. */
export async function tanggalTutupBuku(bulan: string): Promise<{ tanggal: string; digeser: boolean; catatan: string | null; libur: Set<string> }> {
  const libur = await liburSekitar(bulan);
  const [r] = await db()`SELECT tanggal::text AS t, catatan FROM tutup_buku_bulan WHERE bulan = ${bulan}`;
  if (r) return { tanggal: String(r.t), digeser: true, catatan: r.catatan ? String(r.catatan) : null, libur };
  return { tanggal: hariKerjaTerakhir(bulan, libur), digeser: false, catatan: null, libur };
}

export async function geserTutupBuku(bulan: string, b: Record<string, unknown>, oleh: string | null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(bulan)) throw new TutupBukuError(400, "bulan harus YYYY-MM");
  if (b.tanggal === null || b.tanggal === "") {
    await db()`DELETE FROM tutup_buku_bulan WHERE bulan = ${bulan}`; // kembali ke hari kerja terakhir
    return tanggalTutupBukuRingkas(bulan);
  }
  const t = typeof b.tanggal === "string" ? b.tanggal : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || t.slice(0, 7) !== bulan) throw new TutupBukuError(400, `tanggal harus di bulan ${bulan} (YYYY-MM-DD)`);
  const catatan = typeof b.catatan === "string" && b.catatan.trim() ? b.catatan.trim().slice(0, 200) : null;
  await db()`
    INSERT INTO tutup_buku_bulan (bulan, tanggal, catatan, diubah_oleh, diubah_at) VALUES (${bulan}, ${t}, ${catatan}, ${oleh}, now())
    ON CONFLICT (bulan) DO UPDATE SET tanggal = EXCLUDED.tanggal, catatan = EXCLUDED.catatan, diubah_oleh = EXCLUDED.diubah_oleh, diubah_at = now()`;
  return tanggalTutupBukuRingkas(bulan);
}

async function tanggalTutupBukuRingkas(bulan: string) {
  const t = await tanggalTutupBuku(bulan);
  const hari = hariIniWib();
  return { bulan, tanggal: t.tanggal, digeser: t.digeser, catatan: t.catatan, sisa_hari_kerja: hariKerjaSampai(hari, t.tanggal, t.libur) };
}

/** SO terbuka + DO belum difaktur per AM per region. */
export async function ringkasPerRegion(): Promise<RingkasRegion[]> {
  const sql = db();
  const peta = Object.fromEntries(Object.entries(await cabangRegionMap(sql)).map(([c, r]) => [c.trim().toUpperCase(), r]));
  const regionDari = (cabang: string | null): Region | "LAIN" => {
    const r = cabang ? peta[cabang.trim().toUpperCase()] : undefined;
    return r === "East" || r === "West" ? r : "LAIN";
  };
  const so = await sql<{ am: string; cabang: string | null; nilai: number }[]>`
    WITH so AS (
      SELECT so.id, so.trans_date AS tanggal, so.customer_id, it.netto, it.sid
      FROM accurate_sales_order so
      JOIN LATERAL (
        SELECT sum((i.raw->>'dppAmount')::numeric) AS netto,
               (array_agg(NULLIF(i.raw->>'salesman1Id','')::bigint ORDER BY i.line_no))[1] AS sid
        FROM accurate_sales_order_item i WHERE i.order_id = so.id
      ) it ON true
      WHERE so.status = ${STATUS_SO_TERBUKA}
    )
    SELECT ${amLabelSql(sql)} AS am, ${cabangEffSql(sql)} AS cabang, COALESCE(ai.netto, 0)::float8 AS nilai
    FROM (SELECT id, tanggal, customer_id, netto, sid AS salesman_id, NULL::text AS salesman_name FROM so) ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}`;
  const dob = await listDoBelumFaktur({ tab: "tagih", limit: 1000 });

  const peg = new Map<string, RingkasRegion>();
  const ambil = (region: Region | "LAIN") => {
    if (!peg.has(region)) peg.set(region, { region, so: 0, so_nilai: 0, do_: 0, do_nilai: 0, per_am: [] });
    return peg.get(region)!;
  };
  const amDi = (r: RingkasRegion, am: string) => {
    let a = r.per_am.find((x) => x.am === am);
    if (!a) { a = { am, so: 0, so_nilai: 0, do_: 0, do_nilai: 0, do_terlambat: 0 }; r.per_am.push(a); }
    return a;
  };
  for (const s of so) {
    const r = ambil(regionDari(s.cabang)); const a = amDi(r, String(s.am));
    r.so++; r.so_nilai += Number(s.nilai); a.so++; a.so_nilai += Number(s.nilai);
  }
  for (const d of dob.items) {
    const r = ambil(regionDari(d.cabang)); const a = amDi(r, d.am);
    r.do_++; r.do_nilai += d.nilai ?? 0; a.do_++; a.do_nilai += d.nilai ?? 0; if (d.terlambat) a.do_terlambat++;
  }
  for (const r of peg.values()) r.per_am.sort((x, y) => (y.so_nilai + y.do_nilai) - (x.so_nilai + x.do_nilai) || x.am.localeCompare(y.am));
  return [...peg.values()].sort((a, b) => a.region.localeCompare(b.region));
}

/** Ringkasan untuk layar: tanggal tutup buku, sisa hari kerja, total per region. */
export async function ringkasTutupBuku() {
  const hari = hariIniWib();
  const bulan = hari.slice(0, 7);
  const t = await tanggalTutupBuku(bulan);
  const regions = await ringkasPerRegion();
  return {
    bulan, tanggal: t.tanggal, digeser: t.digeser, catatan: t.catatan,
    sisa_hari_kerja: hariKerjaSampai(hari, t.tanggal, t.libur),
    regions: regions.map((r) => ({ region: r.region, so: r.so, so_nilai: r.so_nilai, do: r.do_, do_nilai: r.do_nilai, am: r.per_am.length })),
  };
}

// ---------------------------------------------------------------- job

export const targetRegion = (region: Region, env: NodeJS.ProcessEnv = process.env): string | null =>
  (env[`TUTUP_BUKU_TARGET_${region.toUpperCase()}`] ?? "").trim() || null;
export const targetEskalasi = (env: NodeJS.ProcessEnv = process.env): string | null =>
  (env.TUTUP_BUKU_ESKALASI_TARGET ?? "").trim() || null;

export interface HasilKirim { tujuan: string; sent: boolean; skipped?: string; error?: string; payload?: string }

/**
 * Dicek tiap hari kerja; kirim hanya bila sisa hari kerja ke tutup buku ∈ {7,3,1}.
 * `paksaSisa` (pratinjau) mengabaikan jadwal dan memakai angka itu untuk teks.
 */
export async function runTutupBukuCountdown(opts: { dryRun?: boolean; paksaSisa?: number; region?: Region } = {}) {
  const sql = db();
  const hari = hariIniWib();
  const bulan = hari.slice(0, 7);
  const t = await tanggalTutupBuku(bulan);
  const sisaNyata = hariKerjaSampai(hari, t.tanggal, t.libur);
  const sisa = opts.paksaSisa ?? sisaNyata;
  const base = { bulan, tanggal: t.tanggal, sisa_hari_kerja: sisaNyata, dryRun: Boolean(opts.dryRun) };
  if (opts.paksaSisa == null && !(HARI_PENGINGAT as readonly number[]).includes(sisaNyata)) {
    return { ...base, hasil: [] as HasilKirim[], skipped: `bukan hari pengingat (sisa ${sisaNyata} hari kerja)` };
  }
  const regions = await ringkasPerRegion();
  const hasil: HasilKirim[] = [];
  const kirim = async (tujuanLabel: string, to: string | null, key: string, text: string) => {
    if (opts.dryRun) { hasil.push({ tujuan: tujuanLabel, sent: false, payload: text }); return; }
    if (!to) { hasil.push({ tujuan: tujuanLabel, sent: false, skipped: "tujuan grup belum diatur" }); return; }
    const [done] = await sql`SELECT 1 FROM notif_state WHERE key = ${key}`;
    if (done) { hasil.push({ tujuan: tujuanLabel, sent: false, skipped: "sudah terkirim" }); return; }
    const w = await sendViaWaGateway(to, text);
    const real = w.sent && !w.stub && !w.dryRun; // stub & dry-run gateway juga sent=true
    if (real) {
      await sql`INSERT INTO notif_state (key, signature, count, sent_at) VALUES (${key}, ${hari}, 1, now())
        ON CONFLICT (key) DO UPDATE SET signature = EXCLUDED.signature, count = notif_state.count + 1, sent_at = now()`;
    }
    hasil.push({ tujuan: tujuanLabel, sent: real, error: w.sent ? undefined : (w.error ?? "gagal kirim") });
  };
  for (const region of opts.region ? [opts.region] : REGION) {
    const r = regions.find((x) => x.region === region);
    if (!r || r.so + r.do_ === 0) { hasil.push({ tujuan: `Sales ${region}`, sent: false, skipped: "tak ada penjualan belum difaktur" }); continue; }
    await kirim(`Sales ${region}`, targetRegion(region), `tutup-buku:${bulan}:H${sisa}:${region}`, buildPengingat(r, bulan, t.tanggal, sisa));
  }
  if (sisa === 1 && !opts.region) {
    await kirim("Eskalasi HoD", targetEskalasi(), `tutup-buku:${bulan}:H1:eskalasi`, buildEskalasi(regions, bulan, t.tanggal));
  }
  return { ...base, hasil };
}
