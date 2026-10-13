import { cn } from "@/lib/utils";

import { BAR_CLS, PACING_CLS, persen, type Pacing } from "./types";

// Bilah capaian vs target + penanda "harapan hari ini" (pacing linier per hari).
export function BilahProgres({ pacing, className }: { pacing: Pacing; className?: string }) {
  const capai = Math.min(pacing.capai_pct ?? 0, 100);
  const harapan = Math.min(pacing.harapan_pct, 100);
  return (
    <div className={cn("relative h-2.5 w-full overflow-visible rounded-full bg-slate-200 dark:bg-slate-700", className)}>
      <div className={cn("h-full rounded-full", BAR_CLS[pacing.status ?? "none"])} style={{ width: `${capai}%` }} />
      {pacing.hari_ke > 0 && pacing.capai_pct != null && (
        <div className="absolute -top-1 h-4.5 w-0.5 bg-foreground/70" style={{ left: `calc(${harapan}% - 1px)` }}
          title={`Harapan hari ini ${persen(pacing.harapan_pct)}`} />
      )}
    </div>
  );
}

export function LabelPacing({ pacing }: { pacing: Pacing }) {
  if (!pacing.status) return <span className="text-muted-foreground text-xs">{pacing.capai_pct == null ? "tanpa target" : "belum mulai"}</span>;
  return (
    <span className={cn("text-xs font-semibold", PACING_CLS[pacing.status])}>
      {pacing.status} · harapan {persen(pacing.harapan_pct)}
    </span>
  );
}
