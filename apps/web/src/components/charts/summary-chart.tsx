"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

// Ringkasan per-bulan dari baris yang SUDAH di-fetch (orders/shipments) — agregasi
// di klien, tanpa endpoint/DB baru. Bar = jumlah dokumen per bulan (≤12 bulan terakhir).
interface SummaryRow {
  trans_date: string | null;
  customer_name?: string | null;
  total_amount?: string | null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function SummaryChart({
  rows,
  countLabel,
  withAmount = false,
}: {
  rows: SummaryRow[];
  countLabel: string;
  withAmount?: boolean;
}) {
  const { data, total, thisMonthCount, totalAmount, uniqueCust } = useMemo(() => {
    const byMonth = new Map<string, { count: number; amount: number }>();
    const custs = new Set<string>();
    const nowMonth = new Date().toISOString().slice(0, 7);
    let totalAmount = 0;
    let thisMonthCount = 0;
    for (const r of rows) {
      const ym = (r.trans_date ?? "").slice(0, 7); // YYYY-MM
      const amt = withAmount ? Number(r.total_amount) || 0 : 0;
      totalAmount += amt;
      if (r.customer_name) custs.add(r.customer_name);
      if (ym === nowMonth) thisMonthCount++;
      if (ym) {
        const c = byMonth.get(ym) ?? { count: 0, amount: 0 };
        c.count++;
        c.amount += amt;
        byMonth.set(ym, c);
      }
    }
    const data = [...byMonth.keys()].sort().slice(-12).map((ym) => {
      const [y, m] = ym.split("-");
      const v = byMonth.get(ym)!;
      return { month: `${MON[Number(m) - 1] ?? m} '${y.slice(2)}`, count: v.count, amount: v.amount };
    });
    return { data, total: rows.length, thisMonthCount, totalAmount, uniqueCust: custs.size };
  }, [rows, withAmount]);

  const config = { count: { label: countLabel, color: "var(--primary)" } } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader className="gap-3 pb-2">
        <CardTitle className="text-base">Ringkasan per bulan</CardTitle>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Stat label={`Total ${countLabel}`} value={total.toLocaleString("id-ID")} />
          <Stat label="Bulan ini" value={thisMonthCount.toLocaleString("id-ID")} />
          {withAmount ? (
            <Stat label="Nilai total" value={rp(totalAmount)} />
          ) : (
            <Stat label="Customer unik" value={uniqueCust.toLocaleString("id-ID")} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">Belum cukup data tanggal untuk grafik.</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
            <BarChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
