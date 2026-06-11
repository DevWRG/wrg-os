"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

const shipments = [
  { id: "SHP-2026-0203", order: "PO-2026-0420", customer: "Klinik Kimia Farma Sudirman", courier: "Internal Fleet", status: "In Transit", eta: "2026-05-18" },
  { id: "SHP-2026-0202", order: "PO-2026-0417", customer: "Puskesmas Pasar Minggu", courier: "JNE Trucking", status: "In Transit", eta: "2026-05-19" },
  { id: "SHP-2026-0201", order: "PO-2026-0418", customer: "Apotek Century Kelapa Gading", courier: "Internal Fleet", status: "Delivered", eta: "2026-05-13" },
  { id: "SHP-2026-0200", order: "PO-2026-0416", customer: "RS Hermina Bekasi", courier: "SiCepat Cargo", status: "Delivered", eta: "2026-05-09" },
];

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "In Transit": "default",
  Delivered: "secondary",
  Returned: "destructive",
};

type Shipment = (typeof shipments)[number];
const columns: DataColumn<Shipment>[] = [
  { id: "id", header: "Shipment #", sortable: true, accessor: (s) => s.id, cell: (s) => <span className="font-medium">{s.id}</span> },
  { id: "order", header: "Order #", sortable: true, accessor: (s) => s.order },
  { id: "customer", header: "Customer", sortable: true, accessor: (s) => s.customer },
  { id: "courier", header: "Courier", sortable: true, accessor: (s) => s.courier },
  { id: "status", header: "Status", sortable: true, accessor: (s) => s.status, cell: (s) => <Badge variant={statusTone[s.status] ?? "outline"}>{s.status}</Badge> },
  { id: "eta", header: "ETA", sortable: true, accessor: (s) => s.eta },
];

export default function ShipmentsPage() {
  return (
    <>
      <PageHeader title="Shipments" description="Status pengiriman ke customer per surat jalan." />
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={shipments} getKey={(s) => s.id} searchPlaceholder="Cari shipment / customer / kurir…" pageSize={25} />
        </CardContent>
      </Card>
    </>
  );
}
