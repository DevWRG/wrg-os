"use client";

import { useState } from "react";

import { ArByCustomerView, type ArCustomer, type ArInvoice } from "@/components/tables/ar-by-customer-view";
import { ArTable } from "@/components/tables/ar-table";

// Satu section AR aging dengan dua tab: "Per Customer" (agregasi bucket + drill-down)
// & "Semua Invoice" (list flat existing).
export function ArAgingTabs({ customers, invoices }: { customers: ArCustomer[]; invoices: ArInvoice[] }) {
  const [tab, setTab] = useState<"customer" | "invoice">("customer");
  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-lg border p-1">
        {([["customer", "Per Customer"], ["invoice", "Semua Invoice"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
        ))}
      </div>
      {tab === "customer" ? <ArByCustomerView customers={customers} invoices={invoices} /> : <ArTable invoices={invoices} />}
    </div>
  );
}
