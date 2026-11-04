import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Footer } from "@/components/layout/footer";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navVisible } from "@/lib/nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sesi diambil di server (cookie) & dioper ke sidebar sebagai prop → nav
  // ter-gate role langsung ter-render pas SSR, tanpa flicker "muncul telat".
  const me = await sessionUser();

  // Gate rute: keputusan SAMA dengan sidebar (navVisible) → menu tersembunyi =
  // halaman tertutup, termasuk saat URL diketik langsung. Pathname dioper lewat
  // header dari middleware (Server Component tak bisa membacanya). Rute di luar
  // katalog menu tak di-gate; tanpa sesi (auth mati) juga tidak — selaras can().
  //
  // WAJIB redirect, bukan sekadar menukar isi <main>: layout & page dirender
  // paralel, jadi halaman aslinya tetap masuk RSC payload di HTML walau tak
  // ditampilkan. redirect() memutus render itu (respons 307, tanpa body).
  const pathname = (await headers()).get("x-pathname") ?? "";
  const item = me && pathname ? findNavItem(pathname) : null;
  if (item && !navVisible(me, item)) {
    redirect(`/akses-ditolak?menu=${encodeURIComponent(item.title)}`);
  }

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
