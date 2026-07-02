import { AppSidebar } from "@/components/layout/app-sidebar";
import { Footer } from "@/components/layout/footer";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { sessionUser } from "@/lib/admin-guard";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sesi diambil di server (cookie) & dioper ke sidebar sebagai prop → nav
  // ter-gate role langsung ter-render pas SSR, tanpa flicker "muncul telat".
  const me = await sessionUser();
  return (
    <SidebarProvider>
      <AppSidebar me={me} />
      <SidebarInset className="min-w-0">
        <Topbar />
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
          {children}
        </main>
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  );
}
