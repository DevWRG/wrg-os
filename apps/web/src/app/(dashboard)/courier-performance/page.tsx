import { gatewayFetch } from "@/lib/gateway";
import { isoWib } from "@/lib/tanggal-wib";
import { PageHeader } from "@/components/dashboard/page-header";
import { CourierPerformanceClient, type KurirPerformaSummary } from "@/components/shipping/courier-performance-client";

export const dynamic = "force-dynamic";

function last30Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoWib(from), to: isoWib(to) };
}

async function getSummary(from: string, to: string): Promise<KurirPerformaSummary | null> {
  try {
    const res = await gatewayFetch(`/courier-performance/summary?from=${from}&to=${to}`);
    if (!res.ok) return null;
    return (await res.json()) as KurirPerformaSummary;
  } catch {
    return null;
  }
}

// F43 Kurir Performance — baca-saja atas Tracking Pengiriman (WA #KIRIM/#TERIMA/#BAST).
export default async function CourierPerformancePage() {
  const { from, to } = last30Days();
  const summary = await getSummary(from, to);
  return (
    <>
      <PageHeader
        title="Kurir Performance"
        description="Durasi rata-rata per kurir dari WA: #KIRIM → #TERIMA (waktu tempuh) dan #KIRIM → #BAST. Tanpa input web."
      />
      <CourierPerformanceClient initialSummary={summary} />
    </>
  );
}
