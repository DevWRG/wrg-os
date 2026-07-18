"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// F127 tab "Pipeline" — 3 report baca data `deal` (F1 SPT): Funnel per Tahap,
// Perkiraan (Nilai × Peluang) per kategori forecast, dan Menang-Kalah.
export interface PipelineFunnelRow { stage: string; count: number; value: number; weighted: number }
export interface PipelineForecastRow { category: string; count: number; value: number; weighted: number }
export interface PipelineWinLoss {
  won: number; lost: number; open: number; win_rate: number;
  by_reason: { reason: string; count: number }[];
}
export interface PipelineGroupRow { key: string; count: number; value: number; weighted: number }
export interface PipelineReportData {
  funnel: PipelineFunnelRow[];
  forecast: PipelineForecastRow[];
  by_category: PipelineGroupRow[];
  by_brand: PipelineGroupRow[];
  winloss: PipelineWinLoss;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)}M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)}jt`;
  return rpFull.format(v);
};
const pct1 = (n: number) => `${Math.round(n * 1000) / 10}%`;

// Palet per tahap (urut funnel, dingin→hangat). Sama di light & dark (fill chart).
const STAGE_COLOR: Record<string, string> = {
  "Prospecting": "#94a3b8",
  "First Contact": "#60a5fa",
  "Presentation": "#38bdf8",
  "Quotation": "#22d3ee",
  "Offering": "#818cf8",
  "Negotiation": "#f59e0b",
  "Closing-Won": "#10b981",
  "Closing-Lost": "#ef4444",
};
const stageColor = (s: string) => STAGE_COLOR[s] ?? "#2563a8";

// Label tahap → Bahasa Indonesia ringkas.
const STAGE_LABEL: Record<string, string> = {
  "Prospecting": "Prospek",
  "First Contact": "Kontak Awal",
  "Presentation": "Presentasi",
  "Quotation": "Penawaran Harga",
  "Offering": "Offering Letter",
  "Negotiation": "Negosiasi",
  "Closing-Won": "Menang",
  "Closing-Lost": "Kalah",
};
const stageLabel = (s: string) => STAGE_LABEL[s] ?? s;

// Palet kategori forecast (A Commit paling "panas" → D Omit dingin; Won/Lost tegas).
const FORECAST_COLOR: Record<string, string> = {
  "A - Commit": "#10b981",
  "B - Best Case": "#22c55e",
  "C - Pipeline": "#38bdf8",
  "D - Omit": "#94a3b8",
  "Won": "#059669",
  "Lost": "#ef4444",
};
const forecastColor = (c: string) => FORECAST_COLOR[c] ?? "#2563a8";

const LOSS_LABEL: Record<string, string> = {
  "harga": "Harga",
  "kompetitor": "Kompetitor",
  "no-budget": "Tak Ada Budget",
  "kalah-tender": "Kalah Tender",
  "internal-RS": "Internal RS",
};
const lossLabel = (r: string) => LOSS_LABEL[r] ?? r;

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "won" | "lost" | "rate" }) {
  const valTone =
    tone === "won" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "lost" ? "text-rose-600 dark:text-rose-400"
    : tone === "rate" ? "text-primary"
    : "";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{label}</div>
        <div className={`mt-1 text-2xl font-bold ${valTone}`}>{value}</div>
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// Tooltip: tampil count + nilai + weighted (dipakai funnel & forecast).
function ValueTooltip({ active, payload, label }: {
  active?: boolean;
  label?: string | number;
  payload?: { payload: { count: number; value: number; weighted: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-card border-border rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold">{label}</div>
      <div>Jumlah deal: <span className="font-medium">{p.count}</span></div>
      <div>Nilai: <span className="font-medium">{rpC(p.value)}</span></div>
      <div>Perkiraan (×peluang): <span className="font-medium">{rpC(p.weighted)}</span></div>
    </div>
  );
}

// Palet siklik untuk grup (kategori/brand) — konsisten light & dark.
const GROUP_PALETTE = ["#2563a8", "#0d9488", "#7c3aed", "#d97706", "#dc2626", "#0891b2", "#65a30d", "#db2777", "#4f46e5", "#0ea5e9", "#ca8a04", "#059669", "#e11d48", "#8b5cf6", "#f97316"];

// Section bar horizontal per grup (weighted per kategori/brand). Reuse ValueTooltip.
function GroupBarSection({ title, rows, hint }: { title: string; rows: PipelineGroupRow[]; hint?: string }) {
  const data = rows.map((r) => ({ ...r, label: r.key }));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-muted-foreground text-sm">Belum ada data.</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={Math.max(200, data.length * 34)}>
              <BarChart data={data} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => rpC(Number(v))} fontSize={11} />
                <YAxis type="category" dataKey="label" fontSize={11} width={130} />
                <Tooltip content={<ValueTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                <Bar dataKey="weighted" radius={[0, 4, 4, 0]}>
                  {data.map((r, i) => <Cell key={r.key} fill={GROUP_PALETTE[i % GROUP_PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {hint && <div className="text-muted-foreground mt-2 text-xs">{hint}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PipelineReportView({ data }: { data: PipelineReportData }) {
  const funnel = data.funnel.map((r) => ({ ...r, label: stageLabel(r.stage) }));
  const forecast = data.forecast.map((r) => ({ ...r, label: r.category }));
  const wl = data.winloss;
  const totalDeals = funnel.reduce((a, r) => a + r.count, 0);
  const weightedTotal = funnel.reduce((a, r) => a + r.weighted, 0);
  const maxLoss = Math.max(1, ...wl.by_reason.map((r) => r.count));

  return (
    <div className="space-y-4">
      {/* Ringkas */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total Deal Aktif" value={String(totalDeals)} sub={`${wl.open} masih berjalan`} />
        <StatCard label="Perkiraan Tertimbang" value={rpC(weightedTotal)} sub="Nilai × peluang seluruh pipeline" tone="rate" />
        <StatCard label="Win Rate" value={pct1(wl.win_rate)} sub={`${wl.won} menang / ${wl.lost} kalah`} tone="rate" />
      </div>

      {/* Funnel per Tahap */}
      <Card>
        <CardHeader><CardTitle className="text-base">Funnel per Tahap</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={Math.max(240, funnel.length * 40)}>
            <BarChart data={funnel} layout="vertical" margin={{ left: 24, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
              <XAxis type="number" fontSize={11} allowDecimals={false} />
              <YAxis type="category" dataKey="label" fontSize={11} width={110} />
              <Tooltip content={<ValueTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {funnel.map((r) => <Cell key={r.stage} fill={stageColor(r.stage)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="text-muted-foreground mt-2 text-xs">Panjang bar = jumlah deal per tahap. Arahkan kursor untuk nilai & perkiraan tertimbang.</div>
        </CardContent>
      </Card>

      {/* Perkiraan (Nilai × Peluang) per kategori forecast */}
      <Card>
        <CardHeader><CardTitle className="text-base">Perkiraan (Nilai × Peluang) per Kategori</CardTitle></CardHeader>
        <CardContent>
          {forecast.length === 0 ? (
            <div className="text-muted-foreground text-sm">Belum ada data forecast.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={forecast} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis tickFormatter={(v) => rpC(Number(v))} fontSize={11} width={70} />
                  <Tooltip content={<ValueTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Bar dataKey="weighted" radius={[4, 4, 0, 0]}>
                    {forecast.map((r) => <Cell key={r.category} fill={forecastColor(r.category)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {forecast.map((r) => (
                  <div key={r.category} className="bg-muted/40 flex items-center justify-between rounded-md px-3 py-2 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="inline-block size-2.5 rounded-full" style={{ background: forecastColor(r.category) }} />
                      <span className="font-medium">{r.category}</span>
                    </span>
                    <span className="text-muted-foreground">{r.count} deal · {rpC(r.weighted)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pipeline per Kategori Produk & Brand */}
      <GroupBarSection title="Pipeline per Kategori Produk" rows={data.by_category} hint="Panjang bar = perkiraan tertimbang (nilai × peluang) per kategori produk (IVD / Medical)." />
      <GroupBarSection title="Pipeline per Brand (top 15)" rows={data.by_brand} hint="15 brand teratas menurut perkiraan tertimbang." />

      {/* Menang-Kalah */}
      <Card>
        <CardHeader><CardTitle className="text-base">Menang-Kalah</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Menang" value={String(wl.won)} tone="won" />
            <StatCard label="Kalah" value={String(wl.lost)} tone="lost" />
            <StatCard label="Win Rate" value={pct1(wl.win_rate)} sub={`dari ${wl.won + wl.lost} deal tertutup`} tone="rate" />
          </div>

          <div>
            <div className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">Alasan Kalah</div>
            {wl.by_reason.length === 0 ? (
              <div className="text-muted-foreground text-sm">Belum ada deal yang kalah.</div>
            ) : (
              <div className="space-y-2">
                {wl.by_reason.map((r) => (
                  <div key={r.reason} className="flex items-center gap-3">
                    <div className="w-28 shrink-0 text-xs font-medium">{lossLabel(r.reason)}</div>
                    <div className="bg-muted h-5 flex-1 overflow-hidden rounded">
                      <div className="bg-rose-500 dark:bg-rose-400/80 h-full rounded" style={{ width: `${(r.count / maxLoss) * 100}%` }} />
                    </div>
                    <div className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums">{r.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
