// Katalog menu = SATU sumber kebenaran untuk: (a) render sidebar, (b) katalog
// fitur RBAC (tombol "Sync Fitur" → upsert ke tabel `feature`). Tambah item di
// sini → muncul di sidebar DAN bisa langsung di-sync jadi fitur yg bisa di-gate.
// feature.key = slug route (lihat featureKey()), selaras infra/postgres/init/044_rbac.sql.

import {
  LayoutDashboard, LayoutGrid, Building2, Package, Boxes, ShoppingCart, Truck,
  Factory, Workflow, Receipt, BarChart3, ClipboardCheck, History, Settings,
  Sparkles, Send, FileText, ScrollText, GraduationCap, UsersRound, Network,
  Bell, MapPin, ListChecks, Swords, CalendarOff, CalendarDays, CalendarRange,
  Users, KeyRound, ShieldCheck, MessagesSquare, Gauge, Tags, SlidersHorizontal,
  Target, MapPinned, type LucideIcon,
} from "lucide-react";

// exact: sorot aktif hanya saat path persis (untuk route induk yg punya child,
// mis. /pricelist vs /pricelist/setup).
export interface NavItem { title: string; url: string; icon: LucideIcon; badge?: string; exact?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Sales Overview", url: "/overview", icon: LayoutGrid, badge: "NEW" },
      { title: "WatchPoint HoD", url: "/watchpoint", icon: Gauge, badge: "NEW" },
    ],
  },
  {
    label: "HR",
    items: [
      { title: "Plan & Report", url: "/dashboard", icon: LayoutDashboard },
      { title: "Sales TODO", url: "/todos", icon: ListChecks },
      { title: "Visits", url: "/visits", icon: MapPin },
      { title: "Reminders", url: "/reminders", icon: Bell },
      { title: "Holidays", url: "/holidays", icon: CalendarOff },
      { title: "Manage Leave", url: "/leave", icon: CalendarDays },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Sales Calendar", url: "/calendar", icon: CalendarRange },
      { title: "Sales Performance", url: "/sales", icon: BarChart3, badge: "NEW", exact: true },
      { title: "Competitor Intel", url: "/competitor", icon: Swords },
      { title: "Pipeline", url: "/pipeline", icon: Workflow },
      { title: "Customers", url: "/customers", icon: Building2 },
      { title: "AR Aging", url: "/ar", icon: Receipt },
      { title: "Sales Docs", url: "/sales-docs", icon: FileText },
      { title: "Collection Drafts", url: "/collection-drafts", icon: Send },
      { title: "Pricelist Setup", url: "/pricelist/setup", icon: SlidersHorizontal },
      { title: "Pricelist", url: "/pricelist", icon: Tags, exact: true },
    ],
  },
  {
    label: "Analytics",
    items: [
      { title: "People Analytics", url: "/people", icon: UsersRound },
      { title: "Spider Network", url: "/network", icon: Network },
      { title: "Executive Briefings", url: "/briefings", icon: ScrollText },
      { title: "Coaching Notes", url: "/coaching", icon: GraduationCap },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      { title: "Digest History", url: "/digests", icon: History },
    ],
  },
  {
    label: "Monitor",
    items: [
      { title: "Rekap", url: "/monitor/rekap", icon: MessagesSquare },
      { title: "Resume", url: "/monitor/resume", icon: ScrollText },
      { title: "Pola Komunikasi", url: "/monitor/pola", icon: Network },
      { title: "Members", url: "/monitor/members", icon: Users },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Products", url: "/products", icon: Package },
      { title: "Inventory", url: "/inventory", icon: Boxes },
      { title: "Orders", url: "/orders", icon: ShoppingCart },
      { title: "Shipments", url: "/shipments", icon: Truck },
      { title: "Suppliers", url: "/suppliers", icon: Factory },
      { title: "HITL Review", url: "/hitl", icon: ClipboardCheck },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Sales Targets", url: "/sales/targets", icon: Target },
      { title: "AM → Cabang", url: "/am-cabang", icon: MapPinned },
      { title: "Users", url: "/users", icon: Users },
      { title: "User Access", url: "/user-access", icon: KeyRound },
      { title: "Akses Grup", url: "/access-groups", icon: ShieldCheck },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "UI Showcase", url: "/showcase", icon: Sparkles },
    ],
  },
];

// Fitur (RBAC) per item = slug route: /monitor/rekap → "monitor-rekap" (= feature.key).
export const featureKey = (url: string) => url.replace(/^\//, "").replace(/\//g, "-");

export interface FeatureCatalogRow { key: string; name: string; section: string; path: string; sort: number }

// Katalog fitur datar utk Sync (dikirim ke /admin/access/features/sync).
export function featureCatalog(): FeatureCatalogRow[] {
  const rows: FeatureCatalogRow[] = [];
  let sort = 10;
  for (const g of NAV) {
    for (const it of g.items) {
      rows.push({ key: featureKey(it.url), name: it.title, section: g.label, path: it.url, sort });
      sort += 10;
    }
  }
  return rows;
}
