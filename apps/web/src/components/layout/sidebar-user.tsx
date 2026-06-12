"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronsUpDown, KeyRound, LogOut, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { displayName, displayRole, initials, useSession } from "@/lib/use-session";

// User-card di footer sidebar (gaya Adminator: avatar + nama + role + chevron),
// jadi trigger dropdown akun. Identitas diambil dari sesi (/api/auth/me).
export function SidebarUser() {
  const router = useRouter();
  const me = useSession();
  const name = displayName(me);
  const sub = displayRole(me);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="ring-primary/30 size-8 ring-2">
              <AvatarFallback className="from-primary to-wrg-coral text-primary-foreground bg-gradient-to-br text-xs font-semibold">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{name}</span>
              <span className="text-muted-foreground truncate text-xs">{sub}</span>
            </div>
            <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              <span className="text-sm font-medium">{name}</span>
              <span className="text-muted-foreground text-xs">{me?.email ?? sub}</span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings" />}>
              <KeyRound className="mr-2 size-4" />
              Ganti password
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/users" />}>
              <Users className="mr-2 size-4" />
              Users
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
              <LogOut className="mr-2 size-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
