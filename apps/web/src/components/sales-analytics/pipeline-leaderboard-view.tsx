"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// F127 tab "Leaderboard" — ranking AM dari data `deal` (F1 SPT), urut perkiraan
// tertimbang (Nilai × Peluang). Satu baris per AM; "(Tanpa AM)" = deal tanpa owner.
export interface LeaderboardRow {
  am_id: string | null;
  am_name: string;
  cabang: string | null;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  won: number;
  lost: number;
  open: number;
  win_rate: number;
}

const rpFull = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rpC = (n: number) => {
  const v = n || 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)}M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)}jt`;
  return rpFull.format(v);
};
const pct1 = (n: number) => `${Math.round(n * 1000) / 10}%`;

// Palet bar top-N (teal WRG → variasi ringan). Sama di light & dark.
const BAR_COLORS = ["#0d9488", "#14b8a6", "#2dd4bf", "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#f472b6"];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function BarTooltip({ active, payload, label }: {
  active?: boolean;
  label?: string | number;
  payload?: { payload: LeaderboardRow }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-card border-border rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold">{label}</div>
      <div>Jml deal: <span className="font-medium">{p.deal_count}</span></div>
      <div>Total nilai: <span className="font-medium">{rpC(p.total_value)}</span></div>
      <div>Perkiraan (×peluang): <span className="font-medium">{rpC(p.weighted_value)}</span></div>
      <div>Win rate: <span className="font-medium">{pct1(p.win_rate)}</span></div>
    </div>
  );
}

export function PipelineLeaderboardView({ data }: { data: LeaderboardRow[] }) {
  const rows = data ?? [];
  const totalDeals = rows.reduce((a, r) => a + r.deal_count, 0);
  const weightedTotal = rows.reduce((a, r) => a + r.weighted_value, 0);
  const totalWon = rows.reduce((a, r) => a + r.won, 0);
  const totalLost = rows.reduce((a, r) => a + r.lost, 0);
  const overallWin = totalWon + totalLost > 0 ? totalWon / (totalWon + totalLost) : 0;

  // Bar chart: top-N AM by weighted (label pakai am_name).
  const topN = rows.slice(0, 8).map((r) => ({ ...r, label: r.am_name }));

  return (
    <div className="space-y-4">
      {/* Ringkas */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Jumlah AM" value={String(rows.length)} sub="dengan deal aktif" />
        <StatCard label="Total Deal" value={String(totalDeals)} />
        <StatCard label="Perkiraan Tertimbang" value={rpC(weightedTotal)} sub="Nilai × peluang seluruh AM" />
        <StatCard label="Win Rate Total" value={pct1(overallWin)} sub={`${totalWon} menang / ${totalLost} kalah`} />
      </div>

      {/* Top-N bar by weighted */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top AM — Perkiraan (Nilai × Peluang)</CardTitle></CardHeader>
        <CardContent>
          {topN.length === 0 ? (
            <div className="text-muted-foreground text-sm">Belum ada data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(240, topN.length * 40)}>
              <BarChart data={topN} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => rpC(Number(v))} fontSize={11} />
                <YAxis type="category" dataKey="label" fontSize={11} width={110} />
                <Tooltip content={<BarTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                <Bar dataKey="weighted_value" radius={[0, 4, 4, 0]}>
                  {topN.map((r, i) => <Cell key={r.am_id ?? `noam-${i}`} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tabel ranking */}
      <Card>
        <CardHeader><CardTitle className="text-base">Ranking AM</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-muted-foreground text-sm">Tidak ada data AM.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-xs uppercase tracking-wide">
                    <th className="px-2 py-2 text-left font-semibold">#</th>
                    <th className="px-2 py-2 text-left font-semibold">AM</th>
                    <th className="px-2 py-2 text-left font-semibold">Cabang</th>
                    <th className="px-2 py-2 text-right font-semibold">Jml Deal</th>
                    <th className="px-2 py-2 text-right font-semibold">Total Nilai</th>
                    <th className="px-2 py-2 text-right font-semibold">Perkiraan (Nilai×Peluang)</th>
                    <th className="px-2 py-2 text-right font-semibold">Won</th>
                    <th className="px-2 py-2 text-right font-semibold">Win Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.am_id ?? `noam-${i}`} className="border-border/60 hover:bg-muted/40 border-b">
                      <td className="px-2 py-2 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{r.am_name}</td>
                      <td className="px-2 py-2">{r.cabang ?? "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.deal_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{rpC(r.total_value)}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{rpC(r.weighted_value)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <span className="text-emerald-600 dark:text-emerald-400">{r.won}</span>
                        <span className="text-muted-foreground"> / {r.lost}</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{pct1(r.win_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-muted-foreground mt-2 text-xs">Kolom Won menampilkan menang / kalah. Urut menurun berdasarkan perkiraan tertimbang.</div>
        </CardContent>
      </Card>
    </div>
  );
}
