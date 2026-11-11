// F63 — angka nyata untuk Briefing Mingguan (PDF + bahan narasi AI + ringkasan WA).
//
// Sumber = papan WatchPoint Weekly minggu DASAR (minggu yang baru tutup), lewat
// getWeeklyBoard — jadi angka di PDF sama persis dengan tab Weekly WatchPoint dan
// tak dihitung ulang di sini. Riwayat 8 minggu dibaca dari watchpoint_weekly
// (snapshot tersimpan) untuk garis tren kecil per metrik.
//
// Semua formatter di sini murni (diuji). Nama orang & angka hanya datang dari data.

import { db } from "../db.js";
import type { WatchStatus } from "./watchpoint.js";
import type { WeeklyBoard, WeeklyMetric } from "./watchpoint-weekly.js";
import { previousWeek } from "./watchpoint-week.js";

export interface RingkasStatus {
  GREEN: number;
  YELLOW: number;
  RED: number;
  NA: number;
  total: number;
}

/** Hitung metrik per status di seluruh HoD. NA = belum ada angka/target. */
export function ringkasStatus(board: Pick<WeeklyBoard, "hods">): RingkasStatus {
  const r: RingkasStatus = { GREEN: 0, YELLOW: 0, RED: 0, NA: 0, total: 0 };
  for (const h of board.hods) for (const m of h.metrics) { r[m.status] += 1; r.total += 1; }
  return r;
}

/** Hitung HoD per status (status HoD = metrik terburuknya). */
export function ringkasHod(board: Pick<WeeklyBoard, "hods">): Record<WatchStatus, number> {
  const r: Record<WatchStatus, number> = { GREEN: 0, YELLOW: 0, RED: 0, NA: 0 };
  for (const h of board.hods) r[h.status] += 1;
  return r;
}

/** Rupiah ringkas: 512.345.678 → "Rp 512 jt"; 1.250.000.000 → "Rp 1,25 M". */
export function rupiahRingkas(n: number): string {
  const a = Math.abs(n);
  const tanda = n < 0 ? "-" : "";
  if (a >= 1e9) return `${tanda}Rp ${(a / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `${tanda}Rp ${Math.round(a / 1e6).toLocaleString("id-ID")} jt`;
  if (a >= 1e3) return `${tanda}Rp ${Math.round(a / 1e3).toLocaleString("id-ID")} rb`;
  return `${tanda}Rp ${Math.round(a).toLocaleString("id-ID")}`;
}

/** Nilai metrik sesuai satuannya. null → "-". */
export function nilai(v: number | null, unit: string): string {
  if (v === null || !Number.isFinite(v)) return "-";
  if (unit === "Rp") return rupiahRingkas(v);
  const angka = Math.abs(v) >= 100 || Number.isInteger(v)
    ? Math.round(v).toLocaleString("id-ID")
    : v.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (!unit) return angka;
  return unit === "%" ? `${angka}%` : `${angka} ${unit}`;
}

/** Perubahan vs minggu sebelumnya dalam persen (null bila tak bisa dihitung). */
export function ubahPersen(m: Pick<WeeklyMetric, "actual" | "prevActual">): number | null {
  if (m.actual === null || m.prevActual === null || m.prevActual === 0) return null;
  return ((m.actual - m.prevActual) / Math.abs(m.prevActual)) * 100;
}

export interface Pergerakan {
  hod: string;
  peran: string;
  label: string;
  unit: string;
  actual: number;
  prevActual: number;
  ubah: number; // persen
  membaik: boolean; // sadar arah metrik (lower = lebih baik → turun itu membaik)
}

/** Pergerakan terbesar minggu ini (|perubahan| terbesar), dipisah membaik/memburuk. */
export function pergerakanTerbesar(board: Pick<WeeklyBoard, "hods">, n = 5): { membaik: Pergerakan[]; memburuk: Pergerakan[] } {
  const semua: Pergerakan[] = [];
  for (const h of board.hods) {
    for (const m of h.metrics) {
      const u = ubahPersen(m);
      if (u === null || Math.abs(u) < 1) continue;
      semua.push({
        hod: h.name, peran: h.role, label: m.label, unit: m.unit,
        actual: m.actual as number, prevActual: m.prevActual as number, ubah: u,
        membaik: m.direction === "lower" ? u < 0 : u > 0,
      });
    }
  }
  const urut = (a: Pergerakan, b: Pergerakan) => Math.abs(b.ubah) - Math.abs(a.ubah);
  return {
    membaik: semua.filter((p) => p.membaik).sort(urut).slice(0, n),
    memburuk: semua.filter((p) => !p.membaik).sort(urut).slice(0, n),
  };
}

/** Metrik merah, urut capaian terendah — untuk ringkasan WA & sorotan PDF. */
export function metrikMerah(board: Pick<WeeklyBoard, "hods">, n = 3): { hod: string; label: string; teks: string }[] {
  const out: { hod: string; label: string; teks: string; skor: number }[] = [];
  for (const h of board.hods) {
    for (const m of h.metrics) {
      if (m.status !== "RED") continue;
      out.push({
        hod: h.name, label: m.label,
        teks: `${nilai(m.actual, m.unit)} vs target ${nilai(m.target, m.unit)}`,
        skor: m.pct ?? 0,
      });
    }
  }
  return out.sort((a, b) => a.skor - b.skor).slice(0, n).map(({ hod, label, teks }) => ({ hod, label, teks }));
}

const LABEL_STATUS: Record<WatchStatus, string> = { GREEN: "hijau", YELLOW: "kuning", RED: "merah", NA: "belum ada data" };
const LABEL_TREN = { improving: "membaik", stable: "tetap", declining: "memburuk" } as const;

/**
 * Blok angka untuk prompt AI. Hanya angka dari papan — AI diminta mengutipnya
 * apa adanya, bukan menghitung ulang.
 */
export function teksAngka(board: WeeklyBoard): string {
  const r = ringkasStatus(board);
  const baris = [
    `Papan WatchPoint ${board.label} (${board.periode}). Status metrik: ${r.GREEN} hijau, ${r.YELLOW} kuning, ${r.RED} merah, ${r.NA} belum ada data.`,
  ];
  for (const h of board.hods) {
    const isi = h.metrics
      .filter((m) => m.status !== "NA")
      .map((m) => {
        const u = ubahPersen(m);
        const ubah = u === null ? "" : `, ${u >= 0 ? "+" : ""}${Math.round(u)}% vs minggu sebelumnya`;
        return `${m.label}: ${nilai(m.actual, m.unit)} (target ${nilai(m.target, m.unit)}, ${LABEL_STATUS[m.status]}, ${LABEL_TREN[m.trend]}${ubah})`;
      });
    baris.push(`- ${h.name} (${h.role}) status ${LABEL_STATUS[h.status]}${isi.length ? `: ${isi.join("; ")}` : ": belum ada metrik berangka"}`);
  }
  return baris.join("\n");
}

/**
 * Pesan WA ringkas: judul, hitungan status HoD, maksimal 3 metrik merah, link PDF.
 * Tanpa link → null (tak ada yang bisa dikirim). Tanpa papan → baris angka dilewati.
 */
export function formatWaRingkas(opts: {
  isoWeek: number;
  periode: string;
  dasar: string;
  hod?: Record<WatchStatus, number> | null;
  merah?: { hod: string; label: string; teks: string }[];
  link: string | null;
}): string | null {
  if (!opts.link) return null;
  const baris = [`📋 *Briefing Mingguan W${opts.isoWeek}* · ${opts.periode}`, `Dasar: rekap, resume & WatchPoint ${opts.dasar}.`];
  if (opts.hod) {
    baris.push("", `Status HoD: 🟢 ${opts.hod.GREEN} · 🟡 ${opts.hod.YELLOW} · 🔴 ${opts.hod.RED} · ⚪ ${opts.hod.NA} belum lapor`);
  }
  if (opts.merah && opts.merah.length) {
    baris.push("Perlu perhatian:");
    for (const m of opts.merah) baris.push(`• ${m.hod} — ${m.label}: ${m.teks}`);
  }
  baris.push("", `📄 Unduh PDF lengkap: ${opts.link}`);
  return baris.join("\n");
}

export type Riwayat = Map<string, (number | null)[]>; // key `${hod_key}:${metric_key}`, urut lama → baru

/** Minggu ISO `n` terakhir s/d (termasuk) minggu dasar, urut lama → baru. Murni. */
export function deretMinggu(isoYear: number, isoWeek: number, n: number): { isoYear: number; isoWeek: number }[] {
  const out = [{ isoYear, isoWeek }];
  while (out.length < n) out.unshift(previousWeek(out[0].isoYear, out[0].isoWeek));
  return out;
}

/** Riwayat aktual per metrik dari snapshot tersimpan (watchpoint_weekly). */
export async function riwayatMetrik(isoYear: number, isoWeek: number, n = 8): Promise<Riwayat> {
  const minggu = deretMinggu(isoYear, isoWeek, n);
  const kunciMinggu = minggu.map((m) => m.isoYear * 100 + m.isoWeek);
  const rows = await db()`
    SELECT hod_key, metric_key, iso_year, iso_week, actual
    FROM watchpoint_weekly
    WHERE (iso_year * 100 + iso_week) = ANY(${kunciMinggu})
  `;
  const out: Riwayat = new Map();
  for (const r of rows) {
    const key = `${r.hod_key}:${r.metric_key}`;
    if (!out.has(key)) out.set(key, Array(n).fill(null));
    const i = kunciMinggu.indexOf(Number(r.iso_year) * 100 + Number(r.iso_week));
    const v = r.actual === null ? null : Number(r.actual);
    if (i >= 0) out.get(key)![i] = Number.isFinite(v as number) ? v : null;
  }
  return out;
}
