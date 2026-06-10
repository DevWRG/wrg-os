import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const shipments = [
  {
    id: "SHP-2026-0203",
    order: "PO-2026-0420",
    customer: "Klinik Kimia Farma Sudirman",
    courier: "Internal Fleet",
    status: "In Transit",
    eta: "2026-05-18",
  },
  {
    id: "SHP-2026-0202",
    order: "PO-2026-0417",
    customer: "Puskesmas Pasar Minggu",
    courier: "JNE Trucking",
    status: "In Transit",
    eta: "2026-05-19",
  },
  {
    id: "SHP-2026-0201",
    order: "PO-2026-0418",
    customer: "Apotek Century Kelapa Gading",
    courier: "Internal Fleet",
    status: "Delivered",
    eta: "2026-05-13",
  },
  {
    id: "SHP-2026-0200",
    order: "PO-2026-0416",
    customer: "RS Hermina Bekasi",
    courier: "SiCepat Cargo",
    status: "Delivered",
    eta: "2026-05-09",
  },
];

const statusTone: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  "In Transit": "default",
  Delivered: "secondary",
  Returned: "destructive",
};

export default function ShipmentsPage() {
  return (
    <>
      <PageHeader
        title="Shipments"
        description="Status pengiriman ke customer per surat jalan."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shipment #</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>ETA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.id}</TableCell>
                  <TableCell>{s.order}</TableCell>
                  <TableCell>{s.customer}</TableCell>
                  <TableCell>{s.courier}</TableCell>
                  <TableCell>
                    <Badge variant={statusTone[s.status] ?? "outline"}>
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{s.eta}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
