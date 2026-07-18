// F66 NPK — tipe respons API + helper format bersama (warna band, label predikat).

export type AspectKey = "revenue" | "customer" | "ar" | "kso" | "gp" | "crm" | "coaching";
export type Predikat = "sangat_baik" | "baik" | "cukup" | "kurang" | "buruk";

export interface NpkMatrixRow {
  hod_key: string;
  hod_name: string;
  role: string;
  user_id: string | null;
  npk: number;
  predikat: Predikat;
  available_count: number;
  aspects: Record<AspectKey, { capped: number | null; available: boolean }>;
  computed_at: string | null;
}
export interface NpkMatrixResult {
  year: number;
  period: "S1" | "S2";
  scope: "all" | "self";
  computed: boolean;
  aspect_order: AspectKey[];
  aspect_label: Record<AspectKey, string>;
  rows: NpkMatrixRow[];
}

export interface NpkAspectDetail {
  key: AspectKey;
  label: string;
  weight: number;
  raw: number | null;
  capped: number | null;
  contribution: number | null;
  available: boolean;
}
export interface NpkDetailResult {
  hod_key: string;
  hod_name: string;
  role: string;
  year: number;
  period: "S1" | "S2";
  npk: number;
  predikat: Predikat;
  available_count: number;
  computed: boolean;
  computed_at: string | null;
  computed_from: Record<string, unknown> | null;
  aspects: NpkAspectDetail[];
}

export const PREDIKAT_LABEL: Record<Predikat, string> = {
  sangat_baik: "Sangat Baik",
  baik: "Baik",
  cukup: "Cukup",
  kurang: "Kurang",
  buruk: "Buruk",
};

// Warna band skor (0-120) — konsisten predikat: ≥90 hijau /≥75 teal /≥60 amber /≥50 orange /<50 merah.
export interface Band { text: string; bg: string; dot: string; hex: string }
export function scoreBand(v: number): Band {
  if (v >= 90) return { text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-500/12", dot: "bg-emerald-500", hex: "#10b981" };
  if (v >= 75) return { text: "text-teal-700 dark:text-teal-400", bg: "bg-teal-500/12", dot: "bg-teal-500", hex: "#14b8a6" };
  if (v >= 60) return { text: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500/12", dot: "bg-amber-500", hex: "#f59e0b" };
  if (v >= 50) return { text: "text-orange-700 dark:text-orange-400", bg: "bg-orange-500/12", dot: "bg-orange-500", hex: "#f97316" };
  return { text: "text-red-700 dark:text-red-400", bg: "bg-red-500/12", dot: "bg-red-500", hex: "#ef4444" };
}

export const fmt1 = (n: number | null | undefined): string =>
  n == null ? "–" : (Math.round(n * 10) / 10).toLocaleString("id-ID");

export const periodLabel = (p: "S1" | "S2"): string => (p === "S1" ? "Semester 1 (Jan–Jun)" : "Semester 2 (Jul–Des)");
