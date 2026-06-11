import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { DigestView } from "@/components/monitor/digest-view";

export const dynamic = "force-dynamic";

interface DigestData {
  dates: string[];
  date: string | null;
  entries: { waktu: string | null; content: string }[];
}

async function getResume(): Promise<DigestData> {
  try {
    const res = await gatewayFetch(`/monitor/resume`);
    if (res.ok) return (await res.json()) as DigestData;
  } catch {
    /* ignore */
  }
  return { dates: [], date: null, entries: [] };
}

export default async function MonitorResumePage() {
  const initial = await getResume();
  return (
    <>
      <PageHeader
        title="Resume"
        description="Resume eksekutif harian grup WhatsApp (ringkasan AI mid-day & end-of-day) — port wrg-monitor."
      />
      <DigestView kind="resume" initial={initial} />
    </>
  );
}
