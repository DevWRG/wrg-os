"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Database, PencilLine, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Tipe di-mirror dari apps/api/src/repo/watchpoint.ts.
type WatchStatus = "GREEN" | "YELLOW" | "RED" | "NA";
type WatchTrend = "improving" | "stable" | "declining";

interface WatchMetric {
  key: string;
  label: string;
  target: number | null;
  actual: number | null;
  unit: string;
  direction: "higher" | "lower";
  source: "db" | "manual";
  pct: number | null;
  status: WatchStatus;
  trend: WatchTrend;
  note?: string;
}
interface HodWatch {
  key: string;
  name: string;
  role: string;
  status: WatchStatus;
  metrics: WatchMetric[];
}
export interface WatchBoard {
  source: "computed";
  generatedFor: string;
  asOf: string;
  hods: HodWatch[];
  meta: { gate: string; legend: Record<WatchStatus, string>; pending: string[] };
}

const STATUS_LABEL: Record<WatchStatus, string> = { GREEN: "Hijau", YELLOW: "Kuning", RED: "Merah", NA: "N/A" };
const STATUS_DOT: Record<WatchStatus, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-500",
  RED: "bg-destructive",
  NA: "bg-muted-foreground/40",
};
const STATUS_TONE: Record<WatchStatus, string> = {
  GREEN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  YELLOW: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  RED: "bg-destructive/10 text-destructive",
  NA: "bg-muted text-muted-foreground",
};
const SEVERITY: Record<WatchStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2, NA: 3 };
const STATUS_ORDER: WatchStatus[] = ["RED", "YELLOW", "GREEN", "NA"];

const TREND: Record<WatchTrend, { icon: LucideIcon; tone: string }> = {
  improving: { icon: TrendingUp, tone: "text-emerald-600 dark:text-emerald-500" },
  stable: { icon: Minus, tone: "text-muted-foreground" },
  declining: { icon: TrendingDown, tone: "text-destructive" },
};

// Metric milestone (target null) tak punya angka — nilainya = state dari status.
const MILESTONE_VALUE: Record<WatchStatus, string> = {
  GREEN: "Live", YELLOW: "WIP", RED: "Off", NA: "—",
};

// Kelas warna teks dari STATUS_TONE (buang bg, sisakan text-*).
function statusText(status: WatchStatus): string {
  return STATUS_TONE[status].split(" ").slice(1).join(" ");
}

// Format nilai metric sesuai unit.
function fmt(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "Rp") {
    return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v)}${unit ? " " + unit : ""}`;
}

function MetricRow({ m }: { m: WatchMetric }) {
  const t = TREND[m.trend];
  const TrendIcon = t.icon;
  const SourceIcon = m.source === "db" ? Database : PencilLine;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[m.status])} />
        <span className="truncate text-xs" title={m.note}>{m.label}</span>
        <SourceIcon className="text-muted-foreground/50 size-3 shrink-0" aria-label={m.source} />
      </div>
      <div className="flex items-center gap-2 text-xs tabular-nums">
        {m.target === null ? (
          // Milestone: tampilkan state (Live/WIP/Off) ganti angka actual/target.
          <span className={cn("font-medium", statusText(m.status))}>{MILESTONE_VALUE[m.status]}</span>
        ) : (
          <>
            <span className="font-medium">{fmt(m.actual, m.unit)}</span>
            <span className="text-muted-foreground">/ {fmt(m.target, m.unit)}</span>
            {m.pct !== null ? (
              <span className={cn("w-10 text-right", statusText(m.status))}>{Math.round(m.pct)}%</span>
            ) : (
              <span className="w-10 text-right">—</span>
            )}
          </>
        )}
        <TrendIcon className={cn("size-3.5 shrink-0", t.tone)} />
      </div>
    </div>
  );
}

function HodCard({ hod }: { hod: HodWatch }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base font-semibold tracking-tight">{hod.name}</CardTitle>
          <p className="text-muted-foreground text-xs">{hod.role}</p>
        </div>
        <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", STATUS_TONE[hod.status])}>
          {STATUS_LABEL[hod.status]}
        </span>
      </CardHeader>
      <CardContent className="divide-border/60 divide-y pt-0">
        {hod.metrics.map((m) => (
          <MetricRow key={m.key} m={m} />
        ))}
      </CardContent>
    </Card>
  );
}

export function WatchPointBoardView({ initial }: { initial: WatchBoard | null }) {
  const [filter, setFilter] = useState<WatchStatus | "ALL">("ALL");

  const counts = useMemo(() => {
    const c: Record<WatchStatus, number> = { RED: 0, YELLOW: 0, GREEN: 0, NA: 0 };
    for (const h of initial?.hods ?? []) c[h.status]++;
    return c;
  }, [initial]);

  const visible = useMemo(() => {
    const sorted = [...(initial?.hods ?? [])].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
    return filter === "ALL" ? sorted : sorted.filter((h) => h.status === filter);
  }, [initial, filter]);

  if (!initial) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-10 text-center text-sm">
          Data WatchPoint tidak tersedia (backend tak terjangkau).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>Gate: {initial.meta.gate}</span>
        <span className="flex items-center gap-1"><Database className="size-3" /> = dari DB</span>
        <span className="flex items-center gap-1"><PencilLine className="size-3" /> = manual</span>
      </div>

      {initial.meta.pending.length ? (
        <div className="bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-start gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><strong>Catatan:</strong> {initial.meta.pending.join(" · ")}</span>
        </div>
      ) : null}

      {/* Summary strip + filter */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label="Semua" count={initial.hods.length} />
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(filter === s ? "ALL" : s)}
            label={STATUS_LABEL[s]}
            count={counts[s]}
            dotClass={STATUS_DOT[s]}
            title={initial.meta.legend[s]}
          />
        ))}
      </div>

      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((h) => (
            <HodCard key={h.key} hod={h} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Tidak ada HoD berstatus {filter !== "ALL" ? STATUS_LABEL[filter] : ""}.
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        {initial.generatedFor} · diperbarui {new Date(initial.asOf).toLocaleString("id-ID")}
      </p>
    </div>
  );
}

function FilterChip({
  active, onClick, label, count, dotClass, title,
}: {
  active: boolean; onClick: () => void; label: string; count: number; dotClass?: string; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-foreground/20 bg-foreground text-background" : "border-border text-foreground hover:bg-muted",
      )}
    >
      {dotClass ? <span className={cn("size-2 rounded-full", dotClass)} /> : null}
      {label}
      <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}
