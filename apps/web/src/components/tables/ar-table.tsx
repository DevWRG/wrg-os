"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

interface Invoice {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  due_date: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  is_anomaly: boolean;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(n);
const bucketTone = (b: string): "default" | "secondary" | "destructive" | "outline" =>
  b === "90+" ? "destructive" : b === "61-90" ? "outline" : "secondary";

const columns: DataColumn<Invoice>[] = [
  {
    id: "customer",
    header: "Customer",
    sortable: true,
    accessor: (inv) => inv.customer_name ?? inv.customer_id,
    cell: (inv) => (
      <span className="font-medium">
        {inv.customer_name ?? inv.customer_id}
        {inv.is_anomaly && <Badge variant="destructive" className="ml-2">anomali</Badge>}
      </span>
    ),
  },
  { id: "invoice", header: "Invoice", sortable: true, accessor: (inv) => inv.invoice_no, cell: (inv) => <span className="text-muted-foreground">{inv.invoice_no}</span> },
  { id: "due", header: "Jatuh tempo", sortable: true, accessor: (inv) => inv.due_date, cell: (inv) => <span className="text-muted-foreground">{inv.due_date}</span> },
  { id: "amount", header: "Nilai", align: "right", sortable: true, accessor: (inv) => inv.amount, cell: (inv) => rupiah(inv.amount) },
  { id: "overdue", header: "Overdue", align: "right", sortable: true, accessor: (inv) => inv.days_overdue, cell: (inv) => `${inv.days_overdue} hari` },
  { id: "bucket", header: "Bucket", sortable: true, accessor: (inv) => inv.bucket, cell: (inv) => <Badge variant={bucketTone(inv.bucket)}>{inv.bucket}</Badge> },
];

export function ArTable({ invoices }: { invoices: Invoice[] }) {
  return <DataTable columns={columns} data={invoices} getKey={(inv) => `${inv.customer_id}-${inv.invoice_no}`} searchPlaceholder="Cari customer / invoice / bucket…" pageSize={25} />;
}
