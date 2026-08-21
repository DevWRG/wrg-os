import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddCourierDeliverySheet } from "@/components/shipping/add-courier-delivery-sheet";
import { CourierPerformanceClient, type CourierPerformanceSummary } from "@/components/shipping/courier-performance-client";
import type { CourierDeliveryRow } from "@/components/shipping/courier-delivery-table";

export const dynamic = "force-dynamic";

function last30Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

async function getRows(): Promise<CourierDeliveryRow[] | null> {
  try {
    const res = await gatewayFetch("/courier-deliveries");
    if (!res.ok) return null;
    return (await res.json()) as CourierDeliveryRow[];
  } catch {
    return null;
  }
}

async function getSummary(from: string, to: string): Promise<CourierPerformanceSummary | null> {
  try {
    const res = await gatewayFetch(`/courier-deliveries/summary?from=${from}&to=${to}`);
    if (!res.ok) return null;
    return (await res.json()) as CourierPerformanceSummary;
  } catch {
    return null;
  }
}

// F43 Kurir/Ekspedisi Performance Dashboard — standalone (lihat migrasi 095).
export default async function CourierPerformancePage() {
  const { from, to } = last30Days();
  const [rows, summary] = await Promise.all([getRows(), getSummary(from, to)]);
  return (
    <>
      <PageHeader
        title="Kurir/Ekspedisi Performance"
        description="Pantau performa pengiriman per kurir — ketepatan waktu & rata-rata durasi (F43)."
        action={<AddCourierDeliverySheet />}
      />
      <CourierPerformanceClient initialRows={rows ?? []} initialSummary={summary} hasData={rows !== null} />
    </>
  );
}
