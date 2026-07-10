import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { WinBackView, type DormantCustomer } from "@/components/sales/win-back-view";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

// Dormant Customer Win-back — customer lama yang berhenti order (prioritas revenue
// historis). Fetch floor ≥30 hari; ambang di-filter di klien (60/90/120/180).
export default async function WinBackPage() {
  const data = await get<{ customers: DormantCustomer[] }>("/customers/dormant?days=30");
  return (
    <>
      <PageHeader
        title="Win-back Customer"
        description="Customer dormant (berhenti order) — prioritas revenue historis, per AM. Buat follow-up re-engagement."
      />
      <WinBackView customers={data?.customers ?? []} />
    </>
  );
}
