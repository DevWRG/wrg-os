"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// F127 tab "Activity" — rekap aktivitas (perpindahan stage / touch) dari
// spt_state_log JOIN deal. Per-AM + tren mingguan (12 minggu terakhir).
export interface ActivityAmRow {
  am_id: string | null;
  am_name: string;
  activity_count: number;
  last_7d: number;
  last_30d: number;
  last_activity: string | null; // ISO string / null
}
export interface ActivityTrendPoint {
  week: string; // ISO string awal minggu
  count: number;
}
export interface ActivityReportData {
  per_am: ActivityAmRow[];
  trend: ActivityTrendPoint[];
  total: number;
}

// Tanggal Indonesia (dd MMM yyyy) — mis. "05 Jul 2026".
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmtTgl = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
};
// Label sumbu-X tren: "dd MMM" (ringkas).
const fmtMinggu = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")} ${BULAN[d.getMonth()]}`;
};

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

function TrendTooltip({ active, payload, label }: {
  active?: boolean;
  label?: string | number;
  payload?: { payload: ActivityTrendPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-card border-border rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold">Minggu {label}</div>
      <div>Aktivitas: <span className="font-medium">{p.count}</span></div>
    </div>
  );
}

export function ActivityReportView({ data }: { data: ActivityReportData }) {
  const perAm = data?.per_am ?? [];
  const trend = (data?.trend ?? []).map((t) => ({ ...t, label: fmtMinggu(t.week) }));
  const total = data?.total ?? 0;
  const totalAm = perAm.length;
  const total7d = perAm.reduce((a, r) => a + r.last_7d, 0);
  const total30d = perAm.reduce((a, r) => a + r.last_30d, 0);

  return (
    <div className="space-y-4">
      {/* Ringkas */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total Aktivitas" value={String(total)} sub="seluruh perpindahan / touch deal" />
        <StatCard label="AM Aktif" value={String(totalAm)} sub="punya aktivitas tercatat" />
        <StatCard label="7 Hari Terakhir" value={String(total7d)} />
        <StatCard label="30 Hari Terakhir" value={String(total30d)} />
      </div>

      {/* Tren mingguan */}
      <Card>
        <CardHeader><CardTitle className="text-base">Tren Aktivitas Mingguan (12 minggu terakhir)</CardTitle></CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <div className="text-muted-foreground text-sm">Belum ada aktivitas.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trend} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={40} />
                <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tabel per-AM */}
      <Card>
        <CardHeader><CardTitle className="text-base">Aktivitas per AM</CardTitle></CardHeader>
        <CardContent>
          {perAm.length === 0 ? (
            <div className="text-muted-foreground text-sm">Tidak ada data AM.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-xs uppercase tracking-wide">
                    <th className="px-2 py-2 text-left font-semibold">#</th>
                    <th className="px-2 py-2 text-left font-semibold">AM</th>
                    <th className="px-2 py-2 text-right font-semibold">Total Aktivitas</th>
                    <th className="px-2 py-2 text-right font-semibold">7 Hari</th>
                    <th className="px-2 py-2 text-right font-semibold">30 Hari</th>
                    <th className="px-2 py-2 text-right font-semibold">Aktivitas Terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {perAm.map((r, i) => (
                    <tr key={r.am_id ?? `noam-${i}`} className="border-border/60 hover:bg-muted/40 border-b">
                      <td className="px-2 py-2 tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{r.am_name}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{r.activity_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.last_7d}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.last_30d}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtTgl(r.last_activity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-muted-foreground mt-2 text-xs">Urut menurun berdasarkan total aktivitas. "(Tanpa AM)" = deal tanpa owner.</div>
        </CardContent>
      </Card>
    </div>
  );
}
