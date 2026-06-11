"use client";

import { Plus } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

const suppliers = [
  { code: "SUP-001", name: "Mindray Medical Indonesia", country: "China / ID", category: "Patient Monitoring", pic: "Bpk. Andre", status: "Active" },
  { code: "SUP-002", name: "Philips Healthcare Indonesia", country: "Netherlands", category: "Multi-modality", pic: "Ibu Nadya", status: "Active" },
  { code: "SUP-003", name: "Omron Healthcare Indonesia", country: "Japan", category: "Home Diagnostic", pic: "Bpk. Heru", status: "Active" },
  { code: "SUP-004", name: "B. Braun Medical Indonesia", country: "Germany", category: "Infusion / Therapy", pic: "Ibu Sari", status: "Active" },
  { code: "SUP-005", name: "Dräger Indonesia", country: "Germany", category: "Anesthesia / OR", pic: "Bpk. Tomy", status: "On Review" },
  { code: "SUP-006", name: "GE Healthcare Indonesia", country: "USA", category: "Imaging", pic: "Ibu Putri", status: "Active" },
];

type Supplier = (typeof suppliers)[number];
const columns: DataColumn<Supplier>[] = [
  { id: "code", header: "Code", sortable: true, accessor: (s) => s.code, cell: (s) => <span className="font-medium">{s.code}</span> },
  { id: "name", header: "Name", sortable: true, accessor: (s) => s.name },
  { id: "country", header: "Country", sortable: true, accessor: (s) => s.country },
  { id: "category", header: "Category", sortable: true, accessor: (s) => s.category },
  { id: "pic", header: "PIC", sortable: true, accessor: (s) => s.pic },
  { id: "status", header: "Status", sortable: true, accessor: (s) => s.status, cell: (s) => <Badge variant={s.status === "Active" ? "secondary" : "outline"}>{s.status}</Badge> },
];

export default function SuppliersPage() {
  return (
    <>
      <PageHeader title="Suppliers" description="Principal/manufacturer alat kesehatan yang didistribusikan." action={<Button><Plus />New Supplier</Button>} />
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={suppliers} getKey={(s) => s.code} searchPlaceholder="Cari supplier / kategori…" pageSize={25} />
        </CardContent>
      </Card>
    </>
  );
}
