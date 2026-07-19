// F66 NPK — turunan status/zona + ringkasan eksekutif dari data SK (0-100). Layout
// meniru mockup s3_npk_dashboard (executive briefing, action queue, status) TAPI angka
// & aspek tetap SK Pasal 3. Kejujuran: HoD tanpa data (coverage 0) → "Belum ada data"
// (bukan di-cap PIP); skor dianggap SEMENTARA selama belum semua 7 aspek ter-feed.

import type { NpkMatrixRow, Predikat } from "./npk-format";

export type ZoneKey = "promote" | "meet" | "watch" | "pip" | "no_data";

export interface Zone {
  key: ZoneKey;
  label: string;
  // kelas warna badge (putih-lembut, jangan kontras — selaras standar UI)
  cls: string;
  border: string; // border kiri utk action queue
}

const ZONE: Record<ZoneKey, Zone> = {
  promote: { key: "promote", label: "Kandidat Promosi", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400", border: "bg-emerald-500" },
  meet: { key: "meet", label: "Sesuai Target", cls: "bg-teal-500/12 text-teal-700 dark:text-teal-400", border: "bg-teal-500" },
  watch: { key: "watch", label: "Perlu Perhatian", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400", border: "bg-amber-500" },
  pip: { key: "pip", label: "Tindak Lanjut", cls: "bg-red-500/12 text-red-700 dark:text-red-400", border: "bg-red-500" },
  no_data: { key: "no_data", label: "Belum ada data", cls: "bg-muted text-muted-foreground", border: "bg-muted-foreground/40" },
};

// Zona dari predikat + coverage. coverage 0 → no_data (tak dinilai). Selain itu peta
// predikat SK → zona ala mockup.
export function zoneOf(row: Pick<NpkMatrixRow, "predikat" | "available_count">): Zone {
  if (row.available_count === 0) return ZONE.no_data;
  const byPredikat: Record<Predikat, ZoneKey> = {
    sangat_baik: "promote", baik: "meet", cukup: "meet", kurang: "watch", buruk: "pip",
  };
  return ZONE[byPredikat[row.predikat]];
}

export const TOTAL_ASPEK = 7;
// Aspek yang sudah punya feed data live hari ini (revenue+AR). Sisanya menyusul.
export const WIRED_ASPEK = 2;

export interface NpkSummary {
  measured: number;        // jumlah HoD dgn coverage ≥ 1
  total: number;           // total HoD
  avgNpk: number | null;   // rata-rata NPK HoD terukur
  avgDelta: number | null; // Δ vs periode sebelumnya (null bila tak ada)
  promote: number;
  watchPip: number;        // watch + pip
  noData: number;
  maxCoverage: number;     // coverage tertinggi (utk banner "baru X/7")
  top: NpkMatrixRow | null;
  bottom: NpkMatrixRow | null;
  provisional: boolean;    // true bila belum semua aspek ter-feed
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeSummary(rows: NpkMatrixRow[], prevRows?: NpkMatrixRow[] | null): NpkSummary {
  const measured = rows.filter((r) => r.available_count > 0);
  const avgNpk = avg(measured.map((r) => r.npk));
  let avgDelta: number | null = null;
  if (prevRows && prevRows.length) {
    const prevMeasured = prevRows.filter((r) => r.available_count > 0);
    const prevAvg = avg(prevMeasured.map((r) => r.npk));
    if (avgNpk != null && prevAvg != null) avgDelta = Math.round((avgNpk - prevAvg) * 100) / 100;
  }
  let promote = 0, watchPip = 0, noData = 0;
  for (const r of rows) {
    const z = zoneOf(r).key;
    if (z === "promote") promote += 1;
    else if (z === "watch" || z === "pip") watchPip += 1;
    else if (z === "no_data") noData += 1;
  }
  const sortedMeasured = [...measured].sort((a, b) => b.npk - a.npk);
  const maxCoverage = rows.reduce((m, r) => Math.max(m, r.available_count), 0);
  return {
    measured: measured.length,
    total: rows.length,
    avgNpk: avgNpk == null ? null : Math.round(avgNpk * 100) / 100,
    avgDelta,
    promote,
    watchPip,
    noData,
    maxCoverage,
    top: sortedMeasured[0] ?? null,
    bottom: sortedMeasured[sortedMeasured.length - 1] ?? null,
    provisional: maxCoverage < TOTAL_ASPEK,
  };
}
