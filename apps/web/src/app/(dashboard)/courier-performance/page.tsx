import { gatewayFetch } from "@/lib/gateway";
import { isoWib } from "@/lib/tanggal-wib";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddCourierDeliverySheet } from "@/components/shipping/add-courier-delivery-sheet";
import { CourierPerformanceClient, type CourierPerformanceSummary } from "@/components/shipping/courier-performance-client";
import type { CourierDeliveryRow } from "@/components/shipping/courier-delivery-table";

export const dynamic = "force-dynamic";

function last30Days(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: isoWib(from), to: isoWib(to) };
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

// Saran isian nama kurir: satu ejaan per kurir (yang paling sering dipakai),
// supaya pencatat memilih nama yang sudah ada alih-alih mengetik varian baru.
function kurirOptions(rows: CourierDeliveryRow[]): string[] {
  const hitung = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = r.kurir_name.toLowerCase();
    const ejaan = hitung.get(k) ?? new Map<string, number>();
    ejaan.set(r.kurir_name, (ejaan.get(r.kurir_name) ?? 0) + 1);
    hitung.set(k, ejaan);
  }
  return [...hitung.values()]
    .map((ejaan) => [...ejaan.entries()].sort((a, b) => b[1] - a[1])[0][0])
    .sort((a, b) => a.localeCompare(b));
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
        action={<AddCourierDeliverySheet kurirOptions={kurirOptions(rows ?? [])} />}
      />
      <CourierPerformanceClient initialRows={rows ?? []} initialSummary={summary} hasData={rows !== null} />
    </>
  );
}
