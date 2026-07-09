"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

export interface Drilldown {
  am_id: string;
  range?: { from: string; to: string };
  per_produk: { key: string; label: string; total: number; qty: number }[];
  per_customer: { key: string; label: string; total: number; count: number }[];
}

const rp = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const fmtRp = (n: number) => rp.format(n || 0);

// Tabel drilldown satu AM (Per Produk + Per Customer) — dipakai di halaman
// /sales-analytics/am/[amId]. Revenue = netto (rekonsiliasi ke tab utama).
export function AmDrilldownTables({ data }: { data: Drilldown }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Per Produk</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            data={data.per_produk} getKey={(r) => r.key} searchPlaceholder="Cari produk…" initialSort={{ id: "total", dir: "desc" }}
            columns={[
              { id: "label", header: "Produk", sortable: true, accessor: (r) => r.label },
              { id: "qty", header: "Qty", align: "right", sortable: true, accessor: (r) => r.qty },
              { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
            ]} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Per Customer</CardTitle></CardHeader>
        <CardContent>
          <DataTable
            data={data.per_customer} getKey={(r) => r.key} searchPlaceholder="Cari customer…" initialSort={{ id: "total", dir: "desc" }}
            columns={[
              { id: "label", header: "Customer", sortable: true, accessor: (r) => r.label },
              { id: "count", header: "Faktur", align: "right", sortable: true, accessor: (r) => r.count },
              { id: "total", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.total, cell: (r) => fmtRp(r.total) },
            ]} />
        </CardContent>
      </Card>
    </div>
  );
}
