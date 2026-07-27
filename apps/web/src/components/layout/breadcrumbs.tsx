"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

// Label per segmen rute (gaya WRG-CRM). Fallback: kapitalisasi segmen.
const LABELS: Record<string, string> = {
  "plan-report": "Plan & Report",
  drilldown: "Detail",
  todos: "Sales TODO",
  visits: "Visits",
  reminders: "Reminders",
  holidays: "Holidays",
  leave: "Manage Leave",
  sales: "Sales",
  competitor: "Competitor Intel",
  pipeline: "Pipeline",
  customers: "Customers",
  ar: "AR Aging",
  "sales-docs": "Sales Docs",
  "collection-drafts": "Collection Drafts",
  people: "People Analytics",
  network: "Spider Network",
  briefings: "Executive Briefings",
  coaching: "Coaching Notes",
  reports: "Reports",
  digests: "Digest History",
  products: "Products",
  inventory: "Inventory",
  orders: "Orders",
  shipments: "Shipments",
  suppliers: "Suppliers",
  hitl: "HITL Review",
  users: "Users",
  settings: "Settings",
  showcase: "UI Showcase",
};

const labelOf = (seg: string) =>
  LABELS[seg] ?? seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function Breadcrumbs() {
  const pathname = usePathname();
  const segs = pathname.split("/").filter(Boolean);

  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Breadcrumb">
      <Link href="/" className="text-muted-foreground hover:text-foreground shrink-0">
        WRG CRM
      </Link>
      {segs.map((seg, i) => {
        const href = "/" + segs.slice(0, i + 1).join("/");
        const last = i === segs.length - 1;
        return (
          <span key={href} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
            {last ? (
              <span className="truncate font-medium">{labelOf(seg)}</span>
            ) : (
              <Link href={href} className="text-muted-foreground hover:text-foreground truncate">
                {labelOf(seg)}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
