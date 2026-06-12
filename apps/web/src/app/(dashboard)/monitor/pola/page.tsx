import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { PolaView } from "@/components/monitor/pola-view";

export const dynamic = "force-dynamic";

interface PolaData {
  groups: { group_jid: string; group_name: string }[];
  group_jid: string | null;
  group_name: string | null;
  content: string | null;
}

async function getPola(): Promise<PolaData> {
  try {
    const res = await gatewayFetch(`/monitor/pola`);
    if (res.ok) return (await res.json()) as PolaData;
  } catch {
    /* ignore */
  }
  return { groups: [], group_jid: null, group_name: null, content: null };
}

export default async function MonitorPolaPage() {
  const initial = await getPola();
  return (
    <>
      <PageHeader
        title="Pola Komunikasi"
        description="Profil pola komunikasi tiap grup WhatsApp (profiling AI harian) — port wrg-monitor."
      />
      <PolaView initial={initial} />
    </>
  );
}
