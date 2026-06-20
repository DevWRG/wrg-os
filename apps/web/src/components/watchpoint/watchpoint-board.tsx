"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Tipe sengaja di-mirror dari apps/api/src/repo/watchpoint.ts (shared types
// @wrg/types menyusul saat F76 keluar dari fase scaffold).
type WatchPointStatus = "MERAH" | "SIAP" | "PERLU_KLARIFIKASI" | "BREAKTHROUGH";
type WatchPointTrend = "improving" | "stable" | "declining";
type BscPerspective = "financial" | "customer" | "internal_process" | "learning_growth";

interface PerspectiveScore {
  perspective: BscPerspective;
  status: WatchPointStatus | null;
  note?: string;
}
interface HodWatchPoint {
  key: string;
  name: string;
  role: string;
  status: WatchPointStatus;
  trend: WatchPointTrend;
  concern?: string;
  achievement?: string;
  history: number[];
  perspectives: PerspectiveScore[];
}
export interface WatchPointBoard {
  source: "seed" | "computed";
  generatedFor: string;
  asOf: string;
  hods: HodWatchPoint[];
  meta: {
    statusLegend: Record<WatchPointStatus, string>;
    pending: string[];
  };
}

const STATUS_LABEL: Record<WatchPointStatus, string> = {
  MERAH: "Merah",
  SIAP: "Siap",
  PERLU_KLARIFIKASI: "Perlu Klarifikasi",
  BREAKTHROUGH: "Breakthrough",
};

// Warna status (bg + text). Index [0] = kelas bg, dipakai juga buat dot.
const STATUS_TONE: Record<WatchPointStatus, string> = {
  MERAH: "bg-destructive/10 text-destructive",
  SIAP: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  PERLU_KLARIFIKASI: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  BREAKTHROUGH: "bg-blue-500/10 text-blue-600 dark:text-blue-500",
};
const STATUS_STROKE: Record<WatchPointStatus, string> = {
  MERAH: "stroke-destructive",
  SIAP: "stroke-emerald-500",
  PERLU_KLARIFIKASI: "stroke-amber-500",
  BREAKTHROUGH: "stroke-blue-500",
};

// Urutan keparahan: paling kritis di atas.
const SEVERITY: Record<WatchPointStatus, number> = {
  MERAH: 0,
  PERLU_KLARIFIKASI: 1,
  SIAP: 2,
  BREAKTHROUGH: 3,
};
const STATUS_ORDER: WatchPointStatus[] = ["MERAH", "PERLU_KLARIFIKASI", "SIAP", "BREAKTHROUGH"];

const TREND_META: Record<WatchPointTrend, { icon: LucideIcon; label: string; tone: string }> = {
  improving: { icon: TrendingUp, label: "Membaik", tone: "text-emerald-600 dark:text-emerald-500" },
  stable: { icon: Minus, label: "Stabil", tone: "text-muted-foreground" },
  declining: { icon: TrendingDown, label: "Menurun", tone: "text-destructive" },
};

const PERSPECTIVE_LABEL: Record<BscPerspective, string> = {
  financial: "Financial",
  customer: "Customer",
  internal_process: "Internal Process",
  learning_growth: "Learning & Growth",
};

// Sparkline SVG kecil dari deret skor 0-100 (dummy). Warna ikut status HoD.
function Sparkline({ data, status }: { data: number[]; status: WatchPointStatus }) {
  if (!data || data.length < 2) return null;
  const w = 72;
  const h = 22;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={STATUS_STROKE[status]}
      />
    </svg>
  );
}

function HodCard({ hod }: { hod: HodWatchPoint }) {
  const trend = TREND_META[hod.trend];
  const TrendIcon = trend.icon;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-semibold tracking-tight">{hod.name}</CardTitle>
          <p className="text-muted-foreground text-xs">{hod.role}</p>
        </div>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium",
            STATUS_TONE[hod.status],
          )}
        >
          {STATUS_LABEL[hod.status]}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-1 text-xs", trend.tone)}>
            <TrendIcon className="size-3.5" />
            <span>{trend.label}</span>
          </div>
          <Sparkline data={hod.history} status={hod.status} />
        </div>

        {/* Grid perspektif BSC — placeholder sampai KPI mapping turun (spec). */}
        <div className="grid grid-cols-2 gap-1.5">
          {hod.perspectives.map((p) => (
            <div
              key={p.perspective}
              className="bg-muted/40 rounded-md border border-dashed px-2 py-1.5"
              title={p.note}
            >
              <p className="text-muted-foreground text-[11px] leading-tight">
                {PERSPECTIVE_LABEL[p.perspective]}
              </p>
              <p className="text-xs font-medium">
                {p.status ? STATUS_LABEL[p.status] : "—"}
              </p>
            </div>
          ))}
        </div>

        {hod.concern ? (
          <p className="text-muted-foreground flex items-start gap-1 text-xs">
            <AlertTriangle className="text-amber-600 dark:text-amber-500 mt-0.5 size-3.5 shrink-0" />
            <span>{hod.concern}</span>
          </p>
        ) : null}
        {hod.achievement ? (
          <p className="text-xs text-blue-600 dark:text-blue-500">⭐ {hod.achievement}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function WatchPointBoardView({ initial }: { initial: WatchPointBoard | null }) {
  const [filter, setFilter] = useState<WatchPointStatus | "ALL">("ALL");

  // Hitung jumlah per status (selalu dari data penuh, bukan hasil filter).
  const counts = useMemo(() => {
    const c: Record<WatchPointStatus, number> = {
      MERAH: 0,
      PERLU_KLARIFIKASI: 0,
      SIAP: 0,
      BREAKTHROUGH: 0,
    };
    for (const h of initial?.hods ?? []) c[h.status]++;
    return c;
  }, [initial]);

  // Urutkan berdasarkan keparahan, lalu filter.
  const visible = useMemo(() => {
    const sorted = [...(initial?.hods ?? [])].sort(
      (a, b) => SEVERITY[a.status] - SEVERITY[b.status],
    );
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
      {/* Banner scaffold — data masih SEED/manual */}
      {initial.source === "seed" ? (
        <div className="bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-start gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Scaffold (data SEED).</strong> Status per-HoD disalin manual dari{" "}
            <code>state/current-sprint.json</code>; sparkline pakai skor dummy. Perspektif BSC
            &amp; auto-compute KPI menunggu spec. Pending: {initial.meta.pending.join(" · ")}
          </span>
        </div>
      ) : null}

      {/* Summary strip — jumlah HoD per status, sekaligus chip filter. */}
      <div className="flex flex-wrap gap-2">
        <FilterChip
          active={filter === "ALL"}
          onClick={() => setFilter("ALL")}
          label="Semua"
          count={initial.hods.length}
        />
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(filter === s ? "ALL" : s)}
            label={STATUS_LABEL[s]}
            count={counts[s]}
            dotClass={STATUS_TONE[s].split(" ")[0]}
            title={initial.meta.statusLegend[s]}
          />
        ))}
      </div>

      {/* Grid HoD */}
      {visible.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
  active,
  onClick,
  label,
  count,
  dotClass,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClass?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border text-foreground hover:bg-muted",
      )}
    >
      {dotClass ? <span className={cn("size-2 rounded-full", dotClass)} /> : null}
      {label}
      <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>
        {count}
      </span>
    </button>
  );
}
