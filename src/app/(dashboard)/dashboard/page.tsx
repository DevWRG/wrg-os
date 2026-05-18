import {
  ShoppingCart,
  DollarSign,
  Package,
  AlertTriangle,
} from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const recentOrders = [
  {
    id: "PO-2026-0421",
    customer: "RS Premier Bintaro",
    items: 12,
    total: "Rp 184.500.000",
    status: "Processing",
  },
  {
    id: "PO-2026-0420",
    customer: "Klinik Kimia Farma Sudirman",
    items: 4,
    total: "Rp 24.800.000",
    status: "Shipped",
  },
  {
    id: "PO-2026-0419",
    customer: "RSUD Tangerang",
    items: 28,
    total: "Rp 412.300.000",
    status: "Awaiting Payment",
  },
  {
    id: "PO-2026-0418",
    customer: "Apotek Century Kelapa Gading",
    items: 6,
    total: "Rp 8.150.000",
    status: "Delivered",
  },
  {
    id: "PO-2026-0417",
    customer: "Puskesmas Pasar Minggu",
    items: 9,
    total: "Rp 17.620.000",
    status: "Shipped",
  },
];

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Processing: "default",
  Shipped: "secondary",
  "Awaiting Payment": "outline",
  Delivered: "secondary",
};

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview operasional distribusi alat kesehatan."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Orders"
          value="42"
          delta="+8 vs minggu lalu"
          deltaTone="positive"
          icon={ShoppingCart}
        />
        <StatCard
          title="Monthly Sales"
          value="Rp 2.84 M"
          delta="+12.4% MoM"
          deltaTone="positive"
          icon={DollarSign}
        />
        <StatCard
          title="Total SKUs"
          value="1,284"
          delta="24 baru ditambahkan"
          icon={Package}
        />
        <StatCard
          title="Low Stock Alerts"
          value="17"
          delta="6 perlu PO segera"
          deltaTone="negative"
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Sales Trend</CardTitle>
            <CardDescription>30 hari terakhir</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground flex h-64 items-center justify-center rounded-md border border-dashed text-sm">
              Chart placeholder — wiring chart library nanti
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Top Categories</CardTitle>
            <CardDescription>By revenue bulan ini</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground flex h-64 items-center justify-center rounded-md border border-dashed text-sm">
              Donut chart placeholder
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Orders</CardTitle>
          <CardDescription>5 pesanan terbaru dari customer.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.id}</TableCell>
                  <TableCell>{order.customer}</TableCell>
                  <TableCell className="text-right">{order.items}</TableCell>
                  <TableCell className="text-right">{order.total}</TableCell>
                  <TableCell>
                    <Badge variant={statusTone[order.status] ?? "outline"}>
                      {order.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
