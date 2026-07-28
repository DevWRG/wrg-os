import { redirect } from "next/navigation";
import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { executiveAccess } from "@/lib/executive-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExecutiveDashboard, type CommandData } from "@/components/executive/executive-dashboard";

export const dynamic = "force-dynamic";

// F76 Executive Command Center (Director Dashboard). Ambil view COMMAND awal
// (server) lalu client component memuat view lain on-demand via BFF /api/executive/*.
export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  // Gate: Direktur/admin/superuser = full; HoD = subset (AC-5). Sesi null (auth off)
  // dibiarkan → default "full" (permisif spt can()).
  const access = me ? executiveAccess(me) : "full";
  if (me && access == null) redirect("/"); // root → menu pertama yg boleh dilihat
  let initial: CommandData | null = null;
  try {
    const res = await gatewayFetch("/executive/command", {
      headers: me?.id ? { "x-user-id": me.id } : {},
    });
    if (res.ok) initial = (await res.json()) as CommandData;
  } catch {
    initial = null;
  }
  return (
    <>
      <PageHeader
        title="Executive Command Center"
        description="Single-pane-of-glass Direktur: ringkasan hari ini, radar AM, portfolio outlet, intel dormant, dan baseline KPI. (F76)"
      />
      <ExecutiveDashboard initial={initial} initialView={sp.view} access={access ?? "full"} />
    </>
  );
}
