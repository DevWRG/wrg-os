"use client";

import { useState } from "react";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ArByCustomerView, type ArCustomer, type ArInvoice } from "@/components/tables/ar-by-customer-view";
import { ArTable } from "@/components/tables/ar-table";
import { type ArGroup } from "@/components/tables/ar-breakdown-tabs";

const rupiah = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

// Satu card AR aging dengan semua tab: Per Customer (aging + drill-down),
// Per Cabang & Per Sales (agregat outstanding OPEN), & Semua Invoice.
export function ArAgingTabs({
  customers, invoices, byCabang, bySales,
}: {
  customers: ArCustomer[]; invoices: ArInvoice[]; byCabang: ArGroup[]; bySales: ArGroup[];
}) {
  const [tab, setTab] = useState<"customer" | "cabang" | "sales" | "invoice">("customer");

  const groupCols = (head: string): DataColumn<ArGroup>[] => [
    { id: "key", header: head, sortable: true, accessor: (r) => r.key, cell: (r) => <span className="font-medium">{r.key}</span> },
    { id: "inv", header: "Invoice", align: "right", sortable: true, accessor: (r) => r.invoices, cell: (r) => <span className="tabular-nums">{r.invoices}</span> },
    { id: "out", header: "Outstanding", align: "right", sortable: true, accessor: (r) => r.outstanding, cell: (r) => <span className="tabular-nums font-medium">{rupiah(r.outstanding)}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex w-fit flex-wrap gap-1 rounded-lg border p-1">
        {([["customer", "Per Customer"], ["cabang", "Per Cabang"], ["sales", "Per Sales"], ["invoice", "Semua Invoice"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
        ))}
      </div>
      {tab === "customer" ? (
        <ArByCustomerView customers={customers} invoices={invoices} />
      ) : tab === "cabang" ? (
        <DataTable columns={groupCols("Cabang")} data={byCabang} getKey={(r, i) => `${r.key}-${i}`} searchPlaceholder="Cari cabang…" pageSize={25} empty="Tidak ada piutang OPEN." />
      ) : tab === "sales" ? (
        <DataTable columns={groupCols("Sales")} data={bySales} getKey={(r, i) => `${r.key}-${i}`} searchPlaceholder="Cari sales…" pageSize={25} empty="Tidak ada piutang OPEN." />
      ) : (
        <ArTable invoices={invoices} />
      )}
    </div>
  );
}
