import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { PageHeader } from "@/components/dashboard/page-header";
import { SalesAnalyticsDashboard, type AturanAlertProps, type OverviewResult } from "@/components/sales-analytics/sales-analytics-dashboard";
import type { AlertTargets, SalesAlert } from "@/components/sales-analytics/sales-alerts-manager";

export const dynamic = "force-dynamic";

// F127 Sales Analytics — halaman multi-dimensi. Ambil Executive Overview awal
// (server) lalu client component memuat view lain on-demand via BFF.
//
// K12 (evaluasi menu 19 Nov 2026): Sales Alerts kini tab "Aturan Alert" di sini.
// Data analitik hanya diambil bila user berizin Sales Analytics (izin induk); data
// alert hanya bila berizin `sales-alerts`. /sales-alerts → ?view=alerts.
export default async function SalesAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  const headers: Record<string, string> = me?.id ? { "x-user-id": me.id } : {};
  async function get<T>(path: string): Promise<T | null> {
    try { const r = await gatewayFetch(path, { headers }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
  }
  const induk = findNavItem("/sales-analytics");
  const fAlert = induk?.features?.find((f) => f.key === "sales-alerts");
  const bolehAnalitik = !induk || navOwnVisible(me, induk);
  const bolehAlert = !!fAlert && tabVisible(me, fAlert);

  const [initial, a, t] = await Promise.all([
    bolehAnalitik ? get<OverviewResult>("/sales-analytics/overview") : Promise.resolve(null),
    bolehAlert ? get<{ alerts: SalesAlert[] }>("/sales-analytics/alerts") : Promise.resolve(null),
    bolehAlert ? get<AlertTargets>("/sales-analytics/alert-targets") : Promise.resolve(null),
  ]);
  const aturanAlert: AturanAlertProps | undefined = bolehAlert
    ? { initialAlerts: a?.alerts ?? [], targets: t ?? { groups: [], users: [] } }
    : undefined;

  return (
    <>
      <PageHeader
        title="Sales Analytics"
        description="Analitik penjualan multi-dimensi (overview, per-AM, per-produk, per-cabang, per-customer, tren, pipeline) dan aturan alert penjualan ke WA."
      />
      <SalesAnalyticsDashboard initial={initial} initialView={sp.view} aturanAlert={aturanAlert} bolehAnalitik={bolehAnalitik} />
    </>
  );
}
