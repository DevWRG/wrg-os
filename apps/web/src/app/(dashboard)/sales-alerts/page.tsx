import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { SalesAlertsManager, type SalesAlert, type AlertTargets } from "@/components/sales-analytics/sales-alerts-manager";

export const dynamic = "force-dynamic";

// F127 Sales Alerts — threshold alert penjualan → notif WA saat ambang terlampaui.
export default async function SalesAlertsPage() {
  const me = await sessionUser();
  const headers: Record<string, string> = me?.id ? { "x-user-id": me.id } : {};
  async function get<T>(path: string): Promise<T | null> {
    try { const r = await gatewayFetch(path, { headers }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
  }
  const [a, t] = await Promise.all([
    get<{ alerts: SalesAlert[] }>("/sales-analytics/alerts"),
    get<AlertTargets>("/sales-analytics/alert-targets"),
  ]);
  return (
    <>
      <PageHeader
        title="Sales Alerts"
        description="Threshold alert penjualan → notifikasi WA (grup/personal) saat ambang terlampaui. (F127)"
      />
      <SalesAlertsManager initialAlerts={a?.alerts ?? []} targets={t ?? { groups: [], users: [] }} />
    </>
  );
}
