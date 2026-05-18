"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const monthlySales = [
  { month: "Jan", sales: 1.8 },
  { month: "Feb", sales: 2.1 },
  { month: "Mar", sales: 1.95 },
  { month: "Apr", sales: 2.45 },
  { month: "May", sales: 2.84 },
];

const ordersByType = [
  { type: "RS", value: 58 },
  { type: "Klinik", value: 22 },
  { type: "Apotek", value: 14 },
  { type: "Puskesmas", value: 6 },
];

const lineConfig = {
  sales: { label: "Sales (Rp Miliar)", color: "var(--chart-1)" },
} satisfies ChartConfig;

const barConfig = {
  value: { label: "Orders", color: "var(--chart-2)" },
} satisfies ChartConfig;

const pieConfig = {
  RS: { label: "Rumah Sakit", color: "var(--chart-1)" },
  Klinik: { label: "Klinik", color: "var(--chart-2)" },
  Apotek: { label: "Apotek", color: "var(--chart-3)" },
  Puskesmas: { label: "Puskesmas", color: "var(--chart-4)" },
} satisfies ChartConfig;

export default function ChartsShowcasePage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Monthly Sales</CardTitle>
          <CardDescription>Tren penjualan 5 bulan terakhir (Rp Miliar).</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={lineConfig} className="h-64 w-full">
            <LineChart data={monthlySales} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line
                dataKey="sales"
                type="monotone"
                stroke="var(--color-sales)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orders by Customer Type</CardTitle>
          <CardDescription>Bulan ini.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={barConfig} className="h-64 w-full">
            <BarChart data={ordersByType}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="type" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={4} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Revenue Share by Channel</CardTitle>
          <CardDescription>Persentase order per tipe customer.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={pieConfig} className="mx-auto h-64 w-full max-w-md">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie data={ordersByType} dataKey="value" nameKey="type" innerRadius={50}>
                {ordersByType.map((entry) => (
                  <Cell key={entry.type} fill={`var(--color-${entry.type})`} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
