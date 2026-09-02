import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { PolaView, type WaGroup } from "@/components/monitor/pola-view";

export const dynamic = "force-dynamic";

// Daftar grup diambil dari /monitor/groups (monitor_pola UNION wa_message) supaya
// grup bertraffic rendah — mis. grup customer yg belum punya profil pola — tetap
// muncul & bisa dikategorikan. Isi profil di-fetch saat kartu diklik.
async function getGroups(): Promise<WaGroup[]> {
  try {
    const res = await gatewayFetch(`/monitor/groups`);
    if (res.ok) return ((await res.json()) as { groups: WaGroup[] }).groups ?? [];
  } catch {
    /* ignore */
  }
  return [];
}

export default async function MonitorPolaPage() {
  const [groups, me] = await Promise.all([getGroups(), sessionUser()]);
  const canEdit = me?.role === "admin" || me?.superuser === true;
  return (
    <>
      <PageHeader
        title="Pola Komunikasi"
        description="Profil pola komunikasi tiap grup WhatsApp (profiling AI harian) — port wrg-monitor."
      />
      <PolaView groups={groups} canEdit={canEdit} />
    </>
  );
}
