"use client";

import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface AccurateVendor {
  id: string;
  name: string | null;
  branch_name: string | null;
}

const columns: DataColumn<AccurateVendor>[] = [
  { id: "name", header: "Nama Vendor", sortable: true, accessor: (v) => v.name ?? "", cell: (v) => <span className="font-medium">{v.name ?? "—"}</span> },
  { id: "branch", header: "Cabang", sortable: true, accessor: (v) => v.branch_name ?? "", cell: (v) => <span className="text-muted-foreground">{v.branch_name ?? "—"}</span> },
];

export function SuppliersTable({ vendors }: { vendors: AccurateVendor[] }) {
  return <DataTable columns={columns} data={vendors} getKey={(v) => v.id} searchPlaceholder="Cari vendor…" pageSize={25} />;
}
