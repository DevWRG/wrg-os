"use client";

import { useState } from "react";

import { CustomersRevenueView, type CustomersRevenue } from "@/components/customers/customers-revenue-view";
import { ChurnView, type ChurnData } from "@/components/customers/churn-view";
import { WinBackView, type DormantCustomer } from "@/components/sales/win-back-view";

// Customers: tab "Revenue Monitor" (semua customer, tren), "Churn" (F77 early-warning
// 3-tier), & "Win-back" (dormant ≥N hari, action list). Win-back & Churn digabung ke sini.
export function CustomersTabs({ revenue, churn, dormant }: { revenue: CustomersRevenue; churn: ChurnData | null; dormant: DormantCustomer[] }) {
  const [tab, setTab] = useState<"monitor" | "churn" | "winback">("monitor");
  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-lg border p-1">
        {([["monitor", "Revenue Monitor"], ["churn", "Churn (Early Warning)"], ["winback", "Win-back (Dormant)"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
        ))}
      </div>
      {tab === "monitor" ? <CustomersRevenueView data={revenue} />
        : tab === "churn" ? (churn ? <ChurnView data={churn} /> : <p className="text-muted-foreground text-sm">Data churn tidak tersedia.</p>)
        : <WinBackView customers={dormant} />}
    </div>
  );
}
