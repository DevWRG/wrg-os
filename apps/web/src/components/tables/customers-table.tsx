"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface Customer {
  customer_id: string;
  customer_name: string;
  deal_count: number;
  total_value: number;
  ams: string[];
  stages: string[];
  last_activity: string;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const columns: DataColumn<Customer>[] = [
  { id: "name", header: "Customer", sortable: true, accessor: (c) => c.customer_name, cell: (c) => <span className="font-medium">{c.customer_name}</span> },
  { id: "deal", header: "Deal", align: "right", sortable: true, accessor: (c) => c.deal_count },
  { id: "nilai", header: "Nilai", align: "right", sortable: true, accessor: (c) => c.total_value, cell: (c) => (c.total_value ? rupiah(c.total_value) : "—") },
  {
    id: "stage",
    header: "Stage",
    accessor: (c) => c.stages.join(" "),
    cell: (c) => (
      <div className="flex flex-wrap gap-1">
        {c.stages.map((s) => (
          <Badge key={s} variant="secondary">{s}</Badge>
        ))}
      </div>
    ),
  },
  { id: "am", header: "AM", accessor: (c) => c.ams.join(", "), cell: (c) => <span className="text-muted-foreground">{c.ams.join(", ")}</span> },
  { id: "last", header: "Aktivitas terakhir", sortable: true, accessor: (c) => c.last_activity, cell: (c) => <span className="text-muted-foreground">{tanggal(c.last_activity)}</span> },
];

export function CustomersTable({ customers }: { customers: Customer[] }) {
  return <DataTable columns={columns} data={customers} getKey={(c) => c.customer_id} searchPlaceholder="Cari customer / AM / stage…" pageSize={25} />;
}
