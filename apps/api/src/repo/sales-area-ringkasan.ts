// Ringkasan WA "Sales Area Performance" — angka yang sama dengan kartu Sales
// Performance (tab Executive Sales Analytics): YTD, bulan, minggu, hari ini per
// region + % target, lalu top sales hari ini dan link ke halamannya.
//
// Penerima = grup (Koord HoD), bukan DM. Kirim lewat job `sales-area-ringkasan`
// (saklar SALES_AREA_RINGKASAN_ENABLED, default mati) atau manual lewat
// POST /sales/performance/ringkasan (service token, default pratinjau).
// Hanya omzet (netto tanpa PPN) — tak ada margin/HPP di pesan ini.

import { db } from "../db.js";
import { sendViaWaGateway } from "../wasend.js";
import { reportSalesPerformance } from "./sales.js";
import { analyticsPerAm } from "./sales-analytics.js";

type Performa = Awaited<ReturnType<typeof reportSalesPerformance>>;
type Periode = Performa["periods"][number];
export interface TopSales { nama: string; total: number }

const koma = (n: number, d: number) => n.toFixed(d).replace(".", ",");

/** Rupiah ringkas: ≥ 1 M → "Rp 39,96 M", ≥ 1 jt → "Rp 171,3 jt", selebihnya penuh. */
export function rpRingkas(n: number): string {
  if (Math.abs(n) >= 1e9) return `Rp ${koma(n / 1e9, 2)} M`;
  if (Math.abs(n) >= 1e6) return `Rp ${koma(n / 1e6, 1)} jt`;
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

const persen = (v: number | null) => (v == null ? "target belum diisi" : `${koma(v, 1)}%`);

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const tgl = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
export function labelTanggal(iso: string): string {
  const { y, m, d } = tgl(iso);
  return `${HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${BULAN[m - 1]} ${y}`;
}
const rentangPendek = (from: string, to: string) => {
  const a = tgl(from), b = tgl(to);
  if (from === to) return `${b.d} ${BULAN[b.m - 1]}`;
  return a.m === b.m ? `${a.d}–${b.d} ${BULAN[b.m - 1]}` : `${a.d} ${BULAN[a.m - 1]} – ${b.d} ${BULAN[b.m - 1]}`;
};

const JUDUL: Partial<Record<Periode["key"], string>> = { year: "YTD", month: "Bulan ini", week: "Minggu ini", day: "Hari ini" };

function blokPeriode(p: Periode): string[] {
  const reg = Object.fromEntries(p.regions.map((r) => [r.region, r.total])) as Record<string, number>;
  const rentang = p.key === "week" ? ` (${rentangPendek(p.from, p.to)})` : "";
  const target = p.target.total == null ? "target belum diisi" : `${persen(p.pct.total)} dari target ${rpRingkas(p.target.total)}`;
  const baris = [`*${JUDUL[p.key]}*${rentang}: ${rpRingkas(p.total)} · ${target}`];
  const sub = [`East ${rpRingkas(reg.East ?? 0)} (${persen(p.pct.east)})`, `West ${rpRingkas(reg.West ?? 0)} (${persen(p.pct.west)})`];
  if ((reg.OFFICE ?? 0) !== 0) sub.push(`OFFICE ${rpRingkas(reg.OFFICE)}`);
  baris.push(sub.join(" · "));
  return baris;
}

/** Teks WA. Murni — angka dari reportSalesPerformance + top sales hari as-of. */
export function formatRingkasanSalesArea(perf: Performa, top: TopSales[], link: string | null): string {
  const out = [`*Sales Area Performance* · ${labelTanggal(perf.as_of)}`, "_Omzet netto tanpa PPN, data faktur Accurate_", ""];
  for (const key of ["year", "month", "week", "day"] as const) {
    const p = perf.periods.find((x) => x.key === key);
    if (p) out.push(...blokPeriode(p), "");
  }
  const ada = top.filter((t) => t.total !== 0);
  if (ada.length) {
    out.push("*Top sales hari ini*");
    ada.forEach((t, i) => out.push(`${i + 1}. ${t.nama.replace(/[<>]/g, "")} ${rpRingkas(t.total)}`));
    out.push("");
  } else {
    out.push("_Belum ada faktur hari ini._", "");
  }
  out.push("Target minggu = tahunan ÷ 52, hari = tahunan ÷ 260 hari kerja.");
  if (link) out.push(`Detail: ${link}`);
  return out.join("\n");
}

export interface HasilRingkasan {
  as_of: string;
  preview: string;
  wa: { target: string | null; sent: boolean; error?: string; skipped?: string };
}

/**
 * Susun (dan kirim) ringkasan. `dryRun` = pratinjau saja. `paksa` mengabaikan
 * anti-dobel (sekali per hari per target, notif_state) — untuk uji manual.
 */
export async function runRingkasanSalesArea(opts: { dryRun?: boolean; target?: string; asOf?: string; paksa?: boolean } = {}): Promise<HasilRingkasan> {
  const perf = await reportSalesPerformance(opts.asOf);
  const per = await analyticsPerAm(perf.as_of, perf.as_of);
  const top = per.rows.slice(0, 5).map((r) => ({ nama: r.nama ?? "OFFICE", total: r.total }));
  const base = (process.env.WEB_PUBLIC_URL || "").replace(/\/$/, "");
  const preview = formatRingkasanSalesArea(perf, top, base ? `${base}/sales-analytics` : null);
  const target = opts.target?.trim() || process.env.SALES_AREA_RINGKASAN_TARGET?.trim() || null;
  if (opts.dryRun) return { as_of: perf.as_of, preview, wa: { target, sent: false, skipped: "dry-run" } };
  if (!target) return { as_of: perf.as_of, preview, wa: { target: null, sent: false, error: "SALES_AREA_RINGKASAN_TARGET belum diisi" } };

  const sql = db();
  const key = `sales-area-ringkasan:${target}`;
  if (!opts.paksa) {
    const [prev] = await sql`SELECT signature FROM notif_state WHERE key = ${key}`;
    if (prev && String(prev.signature) === perf.as_of) return { as_of: perf.as_of, preview, wa: { target, sent: false, skipped: "sudah terkirim hari ini" } };
  }
  const r = await sendViaWaGateway(target, preview);
  if (r.sent) {
    await sql`
      INSERT INTO notif_state (key, signature, count, sent_at) VALUES (${key}, ${perf.as_of}, 1, now())
      ON CONFLICT (key) DO UPDATE SET signature = ${perf.as_of}, count = 1, sent_at = now()
    `;
  }
  return { as_of: perf.as_of, preview, wa: { target, sent: r.sent, error: r.error } };
}
