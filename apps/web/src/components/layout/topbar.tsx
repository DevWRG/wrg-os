import { Bell, LayoutGrid, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Topbar() {
  return (
    <header className="bg-background sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger className="-ml-1 size-9 rounded-lg border bg-muted text-foreground [&_svg]:size-5 md:size-7 md:rounded-md md:border-0 md:bg-transparent md:[&_svg]:size-4" />
      <Separator orientation="vertical" className="h-4" />
      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative hidden w-56 sm:block">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input placeholder="Search…" className="h-8 pr-12 pl-8" type="search" />
          <kbd className="bg-muted text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] font-medium select-none">
            ⌘K
          </kbd>
        </div>

        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifikasi">
          <Bell />
          <span className="bg-danger absolute top-1 right-1 size-1.5 rounded-full" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Pesan">
          <LayoutGrid />
          <span className="bg-info absolute top-1 right-1 size-1.5 rounded-full" />
        </Button>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
