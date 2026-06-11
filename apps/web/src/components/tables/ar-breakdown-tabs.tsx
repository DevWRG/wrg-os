"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

export interface ArGroup {
  key: string;
  invoices: number;
  outstanding: number;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

type TabKey = "customer" | "cabang" | "sales";
const TABS: { key: TabKey; label: string; head: string }[] = [
  { key: "customer", label: "Per Customer", head: "Customer" },
  { key: "cabang", label: "Per Cabang", head: "Cabang" },
  { key: "sales", label: "Per Sales", head: "Sales" },
];

export function ArBreakdownTabs({
  byCustomer,
  byCabang,
  bySales,
}: {
  byCustomer: ArGroup[];
  byCabang: ArGroup[];
  bySales: ArGroup[];
}) {
  const [tab, setTab] = useState<TabKey>("customer");
  const active = TABS.find((t) => t.key === tab)!;
  const data = tab === "customer" ? byCustomer : tab === "cabang" ? byCabang : bySales;

  const columns: DataColumn<ArGroup>[] = [
    { id: "key", header: active.head, sortable: true, accessor: (r) => r.key, cell: (r) => <span className="font-medium">{r.key}</span> },
    { id: "inv", header: "Invoice", align: "right", sortable: true, accessor: (r) => r.invoices, cell: (r) => <span className="tabular-nums">{r.invoices}</span> },
    { id: "out", header: "Outstanding", align: "right", sortable: true, accessor: (r) => r.outstanding, cell: (r) => <span className="tabular-nums font-medium">{rupiah(r.outstanding)}</span> },
  ];

  return (
    <div className="space-y-3">
      <div className="bg-muted inline-flex rounded-md p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded px-3 py-1 text-sm font-medium transition-colors",
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <DataTable
        columns={columns}
        data={data}
        getKey={(r, i) => `${r.key}-${i}`}
        searchPlaceholder={`Cari ${active.head.toLowerCase()}…`}
        pageSize={25}
        empty="Tidak ada piutang OPEN."
      />
    </div>
  );
}
