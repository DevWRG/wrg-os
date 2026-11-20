import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

// Kotak "Search… ⌘K", lonceng, dan ikon grid DIHAPUS (evaluasi UI/UX 19 Nov
// 2026): ketiganya tak berfungsi dan titik merah/biru "belum dibaca" di-hardcode,
// jadi selalu menyala. Pencarian menu kini di sidebar (⌘K memfokuskannya).
export function Topbar() {
  return (
    <header className="bg-background sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger className="-ml-1 size-9 rounded-lg border bg-muted text-foreground [&_svg]:size-5 md:size-7 md:rounded-md md:border-0 md:bg-transparent md:[&_svg]:size-4" />
      <Separator orientation="vertical" className="h-4" />
      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
