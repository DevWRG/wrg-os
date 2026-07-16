"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { MessageSquare, Users, Users2, Image as ImageIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface DigestStats {
  date: string;
  total_messages: number;
  active_groups: number;
  active_members: number;
  media_messages: number;
  by_hour: { hour: number; count: number }[];
  by_type: { type: string; label: string; count: number }[];
  top_groups: { name: string; count: number }[];
}

const nf = (n: number) => n.toLocaleString("id-ID");
const CHART_VARS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function DigestInfographic({ date }: { date: string }) {
  const [stats, setStats] = useState<DigestStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch stats saat ganti tanggal; disengaja.
    setLoading(true);
    fetch(`/api/monitor/stats?date=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DigestStats | null) => {
        if (alive) setStats(j && !("error" in j) ? j : null);
      })
      .catch(() => {
        if (alive) setStats(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [date]);

  if (!date) return null;
  if (!stats || stats.total_messages === 0) {
    return loading ? (
      <Card>
        <CardContent className="text-muted-foreground py-6 text-center text-sm">Memuat infografis…</CardContent>
      </Card>
    ) : null;
  }

  // Isi 0–23 supaya ritme harian terbaca (jam kosong = 0).
  const hourMap = new Map(stats.by_hour.map((h) => [h.hour, h.count]));
  const hourData = Array.from({ length: 24 }, (_, h) => ({
    label: String(h).padStart(2, "0"),
    count: hourMap.get(h) ?? 0,
  }));

  const typeConfig: ChartConfig = {};
  stats.by_type.forEach((t, i) => {
    typeConfig[t.type] = { label: t.label, color: CHART_VARS[i % CHART_VARS.length] };
  });

  const hourConfig = { count: { label: "Pesan", color: "var(--chart-1)" } } satisfies ChartConfig;
  const groupConfig = { count: { label: "Pesan", color: "var(--chart-2)" } } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<MessageSquare className="size-4" />} label="Total Pesan" value={nf(stats.total_messages)} />
        <Kpi icon={<Users2 className="size-4" />} label="Grup Aktif" value={nf(stats.active_groups)} />
        <Kpi icon={<Users className="size-4" />} label="Anggota Aktif" value={nf(stats.active_members)} />
        <Kpi icon={<ImageIcon className="size-4" />} label="Pesan Media" value={nf(stats.media_messages)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Aktivitas per jam */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Aktivitas per Jam (WIB)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={hourConfig} className="aspect-auto h-[200px] w-full">
              <BarChart data={hourData} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={1} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Tipe pesan */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tipe Pesan</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={typeConfig} className="mx-auto h-[220px] w-full max-w-xs">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="type" hideLabel />} />
                <Pie data={stats.by_type} dataKey="count" nameKey="type" innerRadius={48}>
                  {stats.by_type.map((t) => (
                    <Cell key={t.type} fill={`var(--color-${t.type})`} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
              {stats.by_type.map((t) => (
                <span key={t.type} className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span className="size-2 rounded-full" style={{ background: `var(--color-${t.type})` }} />
                  {t.label} <span className="text-foreground tabular-nums">{nf(t.count)}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Grup teraktif */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Grup Teraktif</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={groupConfig} className="aspect-auto h-[220px] w-full">
              <BarChart data={stats.top_groups} layout="vertical" margin={{ left: 4, right: 12 }}>
                <XAxis type="number" dataKey="count" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={140}
                  tickFormatter={(v: string) => (v.length > 20 ? v.slice(0, 19) + "…" : v)}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground truncate text-xs">{label}</div>
          <div className="text-xl font-semibold tabular-nums">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
