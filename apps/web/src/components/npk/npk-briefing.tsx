import { ArrowDown, ArrowRight, ArrowUp, ClipboardList, Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmt1, periodLabel, type NpkMatrixRow } from "./npk-format";
import { ASPEK_NAMA, TOTAL_ASPEK, type NpkSummary } from "./npk-status";

function Delta({ v }: { v: number | null }) {
  if (v == null) return <span className="text-xs text-muted-foreground">→ –</span>;
  const up = v > 0, flat = v === 0;
  const Icon = flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", flat ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
      <Icon className="size-3" />{v > 0 ? "+" : ""}{fmt1(v)}
    </span>
  );
}

function Tile({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
      <div className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums text-white">{value}</span>
        {delta !== undefined && <Delta v={delta} />}
      </div>
      {sub && <div className="text-[11px] text-white/60">{sub}</div>}
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <Card className="gap-2 py-3">
      <CardContent className="px-4">
        <div className={cn("mb-1.5 h-1 w-8 rounded-full", accent)} />
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</div>
        <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const nameOf = (r: NpkMatrixRow | null) => (r ? r.subject_name : "–");

// `subjectLabel` = kata untuk subjek yang di-skor ("HoD" di /npk, "AM" di /npk/am).
export function NpkBriefing({
  summary, year, period, computedAt, subjectLabel,
}: {
  summary: NpkSummary; year: number; period: "S1" | "S2"; computedAt: string | null; subjectLabel: string;
}) {
  const s = summary;
  // Nama aspek yang ter-feed, mis. "Revenue, AR" (HoD) / "Revenue, Customer, AR, CRM" (AM).
  const wiredNama = s.wired.map((k) => ASPEK_NAMA[k]).join(", ") || "belum ada";
  const refreshed = computedAt
    ? new Date(computedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "belum di-compute";

  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-700 to-teal-600 text-white shadow-[var(--shadow-card)] dark:from-teal-800 dark:to-teal-700">
        <div className="flex items-center justify-between gap-2 border-b border-white/15 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <ClipboardList className="size-4" /> Executive Briefing · NPK State
          </div>
          <div className="text-xs text-white/70">{periodLabel(period)} {year} · diperbarui {refreshed}</div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm leading-relaxed text-white/90">
            <span className="font-semibold text-white">{subjectLabel} avg NPK = {s.avgNpk == null ? "–" : `${fmt1(s.avgNpk)}/${s.ceiling}`}</span>{" "}
            ({s.measured} dari {s.total} {subjectLabel} terukur).{" "}
            {s.provisional ? (
              <><span className="font-semibold">{s.provisionalCount} berstatus sementara</span> (predikat & tindak lanjut ditahan sampai 7/7 aspek)</>
            ) : (
              <>{s.promote} kandidat promosi · <span className="font-semibold">{s.watchPip} perlu perhatian/tindak lanjut</span></>
            )}{" "}
            · {s.noData} belum ada data.
            {s.top && s.bottom && s.measured > 1 && (
              <> Tertinggi <span className="font-semibold">{nameOf(s.top)}</span> ({fmt1(s.top.npk)}), terendah <span className="font-semibold">{nameOf(s.bottom)}</span> ({fmt1(s.bottom.npk)}).</>
            )}
          </p>
          {s.provisional && (
            <p className="flex items-start gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/85">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Skor SEMENTARA — baru <span className="font-semibold">{s.maxCoverage}/{TOTAL_ASPEK} aspek</span> ({wiredNama}) yang punya feed data live, jadi plafon skor saat ini <span className="font-semibold">{s.ceiling} dari 100</span> (Σ bobot aspek yang ada datanya). Angka rendah = data belum lengkap, BUKAN kinerja buruk — karena itu predikat, kandidat promosi & tindak lanjut ditahan sampai 7/7 aspek ter-feed.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label={`${subjectLabel} Avg NPK`} value={s.avgNpk == null ? "–" : fmt1(s.avgNpk)} delta={s.avgDelta} sub={s.provisional ? `sementara · plafon ${s.ceiling}` : "vs semester lalu"} />
            <Tile label="Terukur" value={`${s.measured}/${s.total}`} sub={`${subjectLabel} punya data`} />
            <Tile label="Perhatian/PIP" value={s.provisional ? "–" : String(s.watchPip)} sub={s.provisional ? "ditahan (data parsial)" : "butuh tindak lanjut"} />
            <Tile label="Kandidat Promosi" value={s.provisional ? "–" : String(s.promote)} sub={s.provisional ? "ditahan (data parsial)" : "predikat sangat baik"} />
            <Tile label="Coverage Aspek" value={`${s.maxCoverage}/${TOTAL_ASPEK}`} sub="aspek terukur" />
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label={`${subjectLabel} Avg NPK`} value={s.avgNpk == null ? "–" : fmt1(s.avgNpk)} sub={`${s.measured} ${subjectLabel} terukur · /${s.ceiling}`} accent="bg-teal-500" />
        <StatCard label="Kandidat Promosi" value={s.provisional ? "–" : String(s.promote)} sub={s.provisional ? "ditahan sampai 7/7 aspek" : "predikat ≥ sangat baik"} accent="bg-emerald-500" />
        <StatCard label="Perlu Perhatian" value={s.provisional ? "–" : String(s.watchPip)} sub={s.provisional ? "ditahan sampai 7/7 aspek" : "watch + tindak lanjut"} accent="bg-amber-500" />
        <StatCard label="Belum Ada Data" value={String(s.noData)} sub={`${subjectLabel} tanpa aspek terukur`} accent="bg-muted-foreground/50" />
        <StatCard label="Coverage Aspek" value={`${s.maxCoverage}/${TOTAL_ASPEK}`} sub={`${wiredNama} live`} accent="bg-sky-500" />
      </div>
    </div>
  );
}
