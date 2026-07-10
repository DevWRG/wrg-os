"use client";

import { useState } from "react";

import { CustomersRevenueView, type CustomersRevenue } from "@/components/customers/customers-revenue-view";
import { WinBackView, type DormantCustomer } from "@/components/sales/win-back-view";

// Customers: dua tab — "Revenue Monitor" (semua customer, tren) & "Win-back"
// (dormant ≥N hari, action list). Win-back digabung ke sini (dulu menu terpisah).
export function CustomersTabs({ revenue, dormant }: { revenue: CustomersRevenue; dormant: DormantCustomer[] }) {
  const [tab, setTab] = useState<"monitor" | "winback">("monitor");
  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-lg border p-1">
        {([["monitor", "Revenue Monitor"], ["winback", "Win-back (Dormant)"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
        ))}
      </div>
      {tab === "monitor" ? <CustomersRevenueView data={revenue} /> : <WinBackView customers={dormant} />}
    </div>
  );
}
