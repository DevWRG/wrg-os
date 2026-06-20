// F76 — WatchPoint HoD Dashboard (SCAFFOLD)
//
// Status: SEED/manual. Data per-HoD masih disalin dari
// state/current-sprint.json (watchPointStatus). Self-contained — tidak query
// DB, jadi tetap jalan walau DATABASE_URL off.
//
// TODO(spec — blocked): ganti SEED dengan auto-compute per-perspektif BSC dari DB
// setelah unblock:
//   - akses Drive "Presentasi HoD WRG" → definisi perspektif + KPI per HoD
//   - ADR-033 (framework BSC-OKR-KPI-PDCA-RACI) sign-off → struktur perspektif
//   - ADR-034 (RACI struktur org) sign-off → mapping HoD → master_user
//   - keputusan threshold: per-perspective standard ATAU per-HoD
// (lihat F76 di state/current-sprint.json)

export type WatchPointStatus =
  | "MERAH"
  | "SIAP"
  | "PERLU_KLARIFIKASI"
  | "BREAKTHROUGH";

export type WatchPointTrend = "improving" | "stable" | "declining";

export type BscPerspective =
  | "financial"
  | "customer"
  | "internal_process"
  | "learning_growth";

export const BSC_PERSPECTIVES: { key: BscPerspective; label: string }[] = [
  { key: "financial", label: "Financial" },
  { key: "customer", label: "Customer" },
  { key: "internal_process", label: "Internal Process" },
  { key: "learning_growth", label: "Learning & Growth" },
];

export interface PerspectiveScore {
  perspective: BscPerspective;
  // null = belum ada KPI mapping (menunggu spec). UI render sel placeholder.
  status: WatchPointStatus | null;
  note?: string;
}

export interface HodWatchPoint {
  key: string;
  name: string; // panggilan HoD
  role: string; // jabatan / area tanggung jawab
  status: WatchPointStatus; // status agregat minggu lalu
  trend: WatchPointTrend;
  concern?: string;
  achievement?: string;
  // Skor kesehatan mingguan DUMMY (0-100, oldest→newest) untuk sparkline trend.
  // TODO(spec): ganti dengan skor historis nyata dari snapshot WatchPoint.
  history: number[];
  perspectives: PerspectiveScore[]; // SEED: 4 perspektif, status null
}

export interface WatchPointBoard {
  source: "seed" | "computed";
  generatedFor: string; // label sprint / minggu
  asOf: string; // ISO timestamp
  hods: HodWatchPoint[];
  meta: {
    statusLegend: Record<WatchPointStatus, string>;
    pending: string[]; // blocker & keputusan yang menggantung
  };
}

const STATUS_LEGEND: Record<WatchPointStatus, string> = {
  MERAH: "Bermasalah — perlu intervensi",
  SIAP: "On-track / siap",
  PERLU_KLARIFIKASI: "Perlu klarifikasi data/konteks",
  BREAKTHROUGH: "Terobosan / di atas target",
};

const PENDING: string[] = [
  "Akses Drive 'Presentasi HoD WRG' (definisi perspektif BSC + KPI per HoD)",
  "ADR-033 sign-off (framework BSC-OKR-KPI-PDCA-RACI)",
  "ADR-034 sign-off (RACI struktur organisasi)",
  "Keputusan threshold: per-perspective standard atau per-HoD",
];

// Semua HoD diberi 4 perspektif BSC standar dengan status null sampai KPI
// mapping turun (spec). Ini menjaga struktur UI grid tetap konsisten.
function blankPerspectives(): PerspectiveScore[] {
  return BSC_PERSPECTIVES.map((p) => ({
    perspective: p.key,
    status: null,
    note: "Menunggu KPI mapping (spec)",
  }));
}

// SEED — mirror state/current-sprint.json (watchPointStatus W24/W25).
// history = skor kesehatan mingguan DUMMY (4 minggu, oldest→newest).
const SEED_HODS: Omit<HodWatchPoint, "perspectives">[] = [
  { key: "rocky", name: "Rocky", role: "Sales East", status: "MERAH", trend: "improving", history: [28, 35, 41, 48] },
  { key: "yogi", name: "Yogi", role: "Sales West", status: "MERAH", trend: "stable", history: [33, 31, 34, 32] },
  { key: "pakMuhid", name: "Pak Muhid", role: "Aftersales", status: "SIAP", trend: "stable", history: [70, 68, 71, 70] },
  { key: "ika", name: "Ika", role: "Finance & SC", status: "SIAP", trend: "stable", concern: "Defisit Rp 4.62M W23", history: [66, 64, 67, 65] },
  { key: "mufid", name: "Mufid", role: "Business IVD", status: "PERLU_KLARIFIKASI", trend: "stable", concern: "CLIA 0 site aktif 2 minggu berturut", history: [50, 48, 51, 49] },
  { key: "arman", name: "Arman", role: "Business Medical", status: "PERLU_KLARIFIKASI", trend: "stable", concern: "0/3 survei co-location CLIA", history: [47, 49, 46, 48] },
  { key: "fafa", name: "Fafa", role: "Accounting & Tax", status: "PERLU_KLARIFIKASI", trend: "improving", concern: "OPEX 45.4% target ≤35%", history: [38, 44, 49, 55] },
  { key: "husni", name: "Husni", role: "BD & GA", status: "BREAKTHROUGH", trend: "improving", achievement: "Data Spine MVP HIJAU/GO Monday-ready", history: [72, 80, 88, 95] },
];

/** Papan WatchPoint per HoD. SEED sampai KPI compute siap (lihat TODO atas). */
export function getWatchPointBoard(): WatchPointBoard {
  return {
    source: "seed",
    generatedFor: "Sprint B1! / W25 (2026-06-22 — 2026-06-28)",
    asOf: new Date().toISOString(),
    hods: SEED_HODS.map((h) => ({ ...h, perspectives: blankPerspectives() })),
    meta: { statusLegend: STATUS_LEGEND, pending: PENDING },
  };
}
