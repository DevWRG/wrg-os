"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { KeyRound, LogOut, Users } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { displayName, displayRole, initials, useSession } from "@/lib/use-session";

export function UserMenu() {
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="relative size-9 rounded-full p-0" aria-label="Menu pengguna" />}
      >
        <Avatar className="ring-primary/30 size-8 ring-2">
          <AvatarFallback className="bg-gradient-to-br from-primary to-purple text-primary-foreground text-xs">{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-muted-foreground text-xs">{sub}</span>
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
  );
}
