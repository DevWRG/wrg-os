import { Plus } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const orders = [
  {
    id: "PO-2026-0421",
    customer: "RS Premier Bintaro",
    items: 12,
    total: "Rp 184.500.000",
    status: "Processing",
    date: "2026-05-17",
  },
  {
    id: "PO-2026-0420",
    customer: "Klinik Kimia Farma Sudirman",
    items: 4,
    total: "Rp 24.800.000",
    status: "Shipped",
    date: "2026-05-16",
  },
  {
    id: "PO-2026-0419",
    customer: "RSUD Tangerang",
    items: 28,
    total: "Rp 412.300.000",
    status: "Awaiting Payment",
    date: "2026-05-15",
  },
  {
    id: "PO-2026-0418",
    customer: "Apotek Century Kelapa Gading",
    items: 6,
    total: "Rp 8.150.000",
    status: "Delivered",
    date: "2026-05-12",
  },
  {
    id: "PO-2026-0417",
    customer: "Puskesmas Pasar Minggu",
    items: 9,
    total: "Rp 17.620.000",
    status: "Shipped",
    date: "2026-05-10",
  },
  {
    id: "PO-2026-0416",
    customer: "RS Hermina Bekasi",
    items: 22,
    total: "Rp 96.800.000",
    status: "Delivered",
    date: "2026-05-08",
  },
];

const statusTone: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  Processing: "default",
  Shipped: "secondary",
  "Awaiting Payment": "outline",
  Delivered: "secondary",
  Cancelled: "destructive",
};

export default function OrdersPage() {
  return (
    <>
      <PageHeader
        title="Orders"
        description="Daftar purchase order yang masuk dari customer."
        action={
          <Button>
            <Plus />
            New Order
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.id}</TableCell>
                  <TableCell>{o.customer}</TableCell>
                  <TableCell className="text-right">{o.items}</TableCell>
                  <TableCell className="text-right">{o.total}</TableCell>
                  <TableCell>
                    <Badge variant={statusTone[o.status] ?? "outline"}>
                      {o.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{o.date}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
