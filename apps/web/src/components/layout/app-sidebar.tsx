"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV, navVisible } from "@/lib/nav";
import { type SessionUser } from "@/lib/use-session";
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

// Sesi di-pass sebagai prop SSR (anti-flicker menu saat hydrate). Gate per item
// = navVisible(): matriks Akses Grup menentukan begitu fiturnya diatur, `show`
// (gate identitas) hanya fallback, dan bila izin tak tersedia (auth mati / belum
// login) semua tampil (non-breaking). Grup tanpa item disembunyikan.
export function AppSidebar({ me }: { me: SessionUser | null }) {
  const pathname = usePathname();

  const nav = NAV
    .map((g) => ({ ...g, items: g.items.filter((it) => navVisible(me, it)) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-color.png" alt="Wahana Lifeline" className="h-8 w-auto max-w-none object-contain object-left dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-white.png" alt="Wahana Lifeline" className="hidden h-8 w-auto max-w-none object-contain object-left dark:block" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {nav.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] font-semibold tracking-wider uppercase">{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={item.exact ? pathname === item.url : pathname === item.url || pathname.startsWith(`${item.url}/`)}
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
        <SidebarUser me={me} />
      </SidebarFooter>
    </Sidebar>
  );
}
