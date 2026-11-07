"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

/**
 * Ringkasan per-bulan untuk menu Orders & Shipments.
 *
 * Angkanya datang JADI dari endpoint agregat SQL, tidak lagi dihitung di sini.
 * Dulu komponen ini menerima `rows` — baris yang kebetulan sudah di-fetch
 * halaman (`?limit=500`) — lalu menjumlahkan total dokumen, "bulan ini",
 * customer unik, nilai rupiah, dan batang 12 bulan dari situ. Mirror-nya jauh
 * lebih besar dari 500, jadi semua angka itu diam-diam terlalu rendah, dan
 * grafiknya menampilkan bulan-bulan lama nyaris kosong seolah bisnisnya
 * menurun padahal barisnya memang tak pernah diambil.
 */
export interface MirrorSummary {
  total: number;
  this_month_count: number;
  unique_customers: number;
  total_amount: number;
  /** kronologis, maksimum 12 bulan terakhir; `month` = "YYYY-MM". */
  by_month: { month: string; count: number; amount: number }[];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function SummaryChart({
  summary,
  countLabel,
  withAmount = false,
}: {
  summary: MirrorSummary;
  countLabel: string;
  withAmount?: boolean;
}) {
  const total = summary.total;
  const thisMonthCount = summary.this_month_count;
  const totalAmount = summary.total_amount;
  const uniqueCust = summary.unique_customers;
  // Yang tersisa di klien cuma pemformatan label bulan — bukan agregasi.
  const data = useMemo(
    () =>
      summary.by_month.map((b) => {
        const [y, m] = b.month.split("-");
        return { month: `${MON[Number(m) - 1] ?? m} '${(y ?? "").slice(2)}`, count: b.count, amount: b.amount };
      }),
    [summary.by_month],
  );

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
