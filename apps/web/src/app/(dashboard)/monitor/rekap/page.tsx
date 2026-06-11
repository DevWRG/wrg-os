import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { DigestView } from "@/components/monitor/digest-view";

export const dynamic = "force-dynamic";

interface DigestData {
  dates: string[];
  date: string | null;
  entries: { waktu: string | null; content: string }[];
}

async function getRekap(): Promise<DigestData> {
  try {
    const res = await gatewayFetch(`/monitor/rekap`);
    if (res.ok) return (await res.json()) as DigestData;
  } catch {
    /* ignore */
  }
  return { dates: [], date: null, entries: [] };
}

export default async function MonitorRekapPage() {
  const initial = await getRekap();
  return (
    <>
      <PageHeader
        title="Rekap"
        description="Rekap kolektif grup WhatsApp (ringkasan AI tiap ~5 jam) — port wrg-monitor."
      />
      <DigestView kind="rekap" initial={initial} />
    </>
  );
}
