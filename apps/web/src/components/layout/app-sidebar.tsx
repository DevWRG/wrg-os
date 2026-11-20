"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Search } from "lucide-react";

import { NAV, devOnlyBadge, navVisible } from "@/lib/nav";
import { lencanaMenu } from "@/lib/nav-baru";
import { grupTerbukaAwal, menuAktif, saringMenu } from "@/lib/sidebar-nav";
import { type SessionUser } from "@/lib/use-session";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { SidebarUser } from "@/components/layout/sidebar-user";

// "production" untuk build dari `main` (lihat next.config.ts); selain itu build dev.
const BUILD_CHANNEL = process.env.NEXT_PUBLIC_BUILD_CHANNEL;

// Sesi di-pass sebagai prop SSR (anti-flicker menu saat hydrate). Gate per item
// = navVisible(): matriks Akses Grup menentukan begitu fiturnya diatur, `show`
// (gate identitas) hanya fallback, dan bila izin tak tersedia (auth mati / belum
// login) semua tampil (non-breaking). Grup tanpa item disembunyikan.
//
// Navigasi (evaluasi UI/UX 19 Nov 2026 — sidebar 15 grup / 123 item selalu
// terbuka tanpa pencarian): kotak "Cari menu" (⌘K / Ctrl+K memfokuskannya),
// grup bisa dilipat (default hanya grup aktif yang terbuka bila menu > 20;
// pilihan buka/tutup diingat per browser), lencana NEW berbatas waktu
// (lib/nav-baru). Mode ikon (sidebar diciutkan) tetap menampilkan semua ikon.
const KUNCI_GRUP = "wrg-sidebar-grup-terbuka";
const EVENT_GRUP = "wrg-sidebar-grup";

function bacaGrup(): string | null {
  try { return localStorage.getItem(KUNCI_GRUP); } catch { return null; }
}
function simpanGrup(labels: string[]) {
  try { localStorage.setItem(KUNCI_GRUP, JSON.stringify(labels)); } catch { /* storage tak tersedia */ }
  window.dispatchEvent(new Event(EVENT_GRUP));
}
function langgananGrup(cb: () => void) {
  window.addEventListener(EVENT_GRUP, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT_GRUP, cb); window.removeEventListener("storage", cb); };
}

export function AppSidebar({ me }: { me: SessionUser | null }) {
  const pathname = usePathname();
  // Mobile: tutup drawer tiap navigasi (klik menu / logo). No-op di desktop.
  const { setOpenMobile, setOpen, state, isMobile } = useSidebar();
  const ciut = state === "collapsed" && !isMobile;

  const nav = useMemo(
    () => NAV.map((g) => ({ ...g, items: g.items.filter((it) => navVisible(me, it)) })).filter((g) => g.items.length > 0),
    [me],
  );

  const [cari, setCari] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tampil = useMemo(() => saringMenu(nav, cari), [nav, cari]);

  // Pilihan buka/tutup grup diingat per browser (localStorage); sebelum ada
  // pilihan, default dari grupTerbukaAwal. Grup menu yang sedang dibuka selalu
  // terbuka. Dibaca lewat useSyncExternalStore supaya render server = default.
  const simpanan = useSyncExternalStore(langgananGrup, bacaGrup, () => null);
  const terbuka = useMemo(() => {
    if (simpanan) {
      try { return new Set(JSON.parse(simpanan) as string[]); } catch { /* rusak → default */ }
    }
    return grupTerbukaAwal(nav, pathname);
  }, [simpanan, nav, pathname]);
  const grupAktif = nav.find((g) => g.items.some((it) => menuAktif(it, pathname)))?.label;
  const toggleGrup = (label: string) => {
    const n = new Set(terbuka);
    if (n.has(label)) n.delete(label); else n.add(label);
    simpanGrup([...n]);
  };

  // ⌘K / Ctrl+K → buka sidebar (bila diciutkan) lalu fokus ke kotak cari.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isMobile) setOpenMobile(true); else setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, setOpen, setOpenMobile]);

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => setOpenMobile(false)} render={<Link href="/" />} className="overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-color.png" alt="Wahana Lifeline" className="h-8 w-auto max-w-none object-contain object-left dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-white.png" alt="Wahana Lifeline" className="hidden h-8 w-auto max-w-none object-contain object-left dark:block" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {!ciut && (
          <div className="relative px-2 pt-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-[calc(50%+2px)] left-4 size-4 -translate-y-1/2" />
            <SidebarInput
              ref={inputRef}
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setCari(""); e.currentTarget.blur(); } }}
              placeholder="Cari menu…"
              aria-label="Cari menu"
              className="pr-10 pl-8"
            />
            <kbd className="bg-muted text-muted-foreground pointer-events-none absolute top-[calc(50%+2px)] right-4 -translate-y-1/2 rounded border px-1 text-[10px] font-medium select-none max-md:hidden">
              ⌘K
            </kbd>
          </div>
        )}
        {!ciut && cari && tampil.length === 0 && (
          <p className="text-muted-foreground px-4 py-3 text-xs">Tidak ada menu yang cocok dengan “{cari}”.</p>
        )}
        {tampil.map((group) => {
          // Saat mencari atau sidebar diciutkan (ikon saja), semua grup terbuka.
          const buka = ciut || cari.trim() !== "" || group.label === grupAktif || terbuka.has(group.label);
          return (
          <SidebarGroup key={group.label} className={buka ? undefined : "py-0"}>
            <SidebarGroupLabel
              render={<button type="button" />}
              onClick={() => toggleGrup(group.label)}
              aria-expanded={buka}
              className="hover:text-sidebar-foreground w-full cursor-pointer justify-between text-[10px] font-semibold tracking-wider uppercase"
            >
              {group.label}
              <ChevronDown className={`transition-transform ${buka ? "" : "-rotate-90"}`} />
            </SidebarGroupLabel>
            {buka && (
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const lencana = lencanaMenu(item.url, item.badge);
                  return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={menuAktif(item, pathname)}
                      tooltip={item.title}
                      className="rounded-md focus-visible:ring-0 data-active:bg-primary/10 data-active:font-medium data-active:text-primary data-active:shadow-[inset_3px_0_0_var(--primary)]"
                      onClick={() => { setOpenMobile(false); setCari(""); }}
                      render={<Link href={item.url} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {devOnlyBadge(item.url, BUILD_CHANNEL) ? (
                      <SidebarMenuBadge
                        className="bg-warning-soft text-warning top-1.5 rounded-full px-1.5 text-[9px] font-bold tracking-wide"
                        title="Belum ada di produksi — menunggu promosi dev → main"
                      >
                        DEV
                      </SidebarMenuBadge>
                    ) : (
                      lencana && (
                        <SidebarMenuBadge className="bg-success-soft text-success top-1.5 rounded-full px-1.5 text-[9px] font-bold tracking-wide">
                          {lencana}
                        </SidebarMenuBadge>
                      )
                    )}
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
            )}
          </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <SidebarUser me={me} />
      </SidebarFooter>
    </Sidebar>
  );
}
