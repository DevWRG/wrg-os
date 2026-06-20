"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LayoutGrid,
  Building2,
  Package,
  Boxes,
  ShoppingCart,
  Truck,
  Factory,
  Workflow,
  Receipt,
  BarChart3,
  ClipboardCheck,
  History,
  Settings,
  Sparkles,
  Send,
  FileText,
  ScrollText,
  GraduationCap,
  UsersRound,
  Network,
  Bell,
  MapPin,
  ListChecks,
  Swords,
  CalendarOff,
  CalendarDays,
  CalendarRange,
  Users,
  KeyRound,
  MessagesSquare,
  Gauge,
  type LucideIcon,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarUser } from "@/components/layout/sidebar-user";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

// IA bergaya WRG-CRM (sidebar Adminator: HR / Sales / Admin), diperluas dengan
// kapabilitas wrg-os di bawah Analytics & Operations. Tiap item menunjuk route
// yang sudah ada (nol 404); halaman khas WRG-CRM (Holidays, Manage Leave, Users,
// Sales Calendar, Sales Performance, AR submenu) menyusul di fase berikutnya.
const NAV: NavGroup[] = [
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
      { title: "Sales Performance", url: "/sales", icon: BarChart3, badge: "NEW" },
      { title: "Competitor Intel", url: "/competitor", icon: Swords },
      { title: "Pipeline", url: "/pipeline", icon: Workflow },
      { title: "Customers", url: "/customers", icon: Building2 },
      { title: "AR Aging", url: "/ar", icon: Receipt },
      { title: "Sales Docs", url: "/sales-docs", icon: FileText },
      { title: "Collection Drafts", url: "/collection-drafts", icon: Send },
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
      { title: "Users", url: "/users", icon: Users },
      { title: "User Access", url: "/user-access", icon: KeyRound },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "UI Showcase", url: "/showcase", icon: Sparkles },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-color.png" alt="Wahana Lifeline" className="h-8 w-auto max-w-none object-contain object-left dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-white.png" alt="Wahana Lifeline" className="hidden h-8 w-auto max-w-none object-contain object-left dark:block" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] font-semibold tracking-wider uppercase">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
                      tooltip={item.title}
                      className="rounded-md focus-visible:ring-0 data-active:bg-primary/10 data-active:font-medium data-active:text-primary data-active:shadow-[inset_3px_0_0_var(--primary)]"
                      render={<Link href={item.url} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.badge && (
                      <SidebarMenuBadge className="bg-success-soft text-success top-1.5 rounded-full px-1.5 text-[9px] font-bold tracking-wide">
                        {item.badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarUser />
      </SidebarFooter>
    </Sidebar>
  );
}
