import { cn } from "@/lib/utils";

// F17 — Customer Health Cards. Label dihitung di apps/api
// (lib/customer-health.ts) dari faktur Accurate, bukan oleh AI; alasan tiap
// label ikut dikirim dan ditampilkan sebagai tooltip supaya bisa ditelusuri.

export type KelasHealth = "HOT" | "WARM" | "COLD";
export type StatusKso = "PERFECT_RUTIN" | "SESEKALI" | "TIDAK_BELI";
export interface KsoHealth { status: StatusKso; label: string; alasan: string }

export const HEALTH_LABEL: Record<KelasHealth, string> = { HOT: "Hot", WARM: "Warm", COLD: "Cold" };
// Urutan sort: yang paling sehat di atas.
export const HEALTH_RANK: Record<KelasHealth, number> = { HOT: 0, WARM: 1, COLD: 2 };
export const KSO_RANK: Record<StatusKso, number> = { PERFECT_RUTIN: 0, SESEKALI: 1, TIDAK_BELI: 2 };

// Token warna sama dengan chip status WatchPoint (…/10 + teks 600), BUKAN
// bg-muted — itu nyaris tak terlihat di mode terang.
const HEALTH_CLS: Record<KelasHealth, string> = {
  HOT: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  WARM: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  COLD: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};
const KSO_CLS: Record<StatusKso, string> = {
  PERFECT_RUTIN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  SESEKALI: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  TIDAK_BELI: "bg-destructive/10 text-destructive",
};

const chip = "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

export function HealthBadge({ kelas, alasan }: { kelas: KelasHealth; alasan?: string }) {
  return <span className={cn(chip, HEALTH_CLS[kelas])} title={alasan}>{HEALTH_LABEL[kelas]}</span>;
}

export function KsoBadge({ kso }: { kso: KsoHealth | null }) {
  if (!kso) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className={cn(chip, KSO_CLS[kso.status])} title={kso.alasan}>{kso.label}</span>;
}
