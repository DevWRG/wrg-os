import { redirect } from "next/navigation";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPurchaseForecast } from "@/lib/purchase-forecast-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { PurchaseForecastDashboard, type PurchaseForecastSummary } from "@/components/purchasing/purchase-forecast-dashboard";
import type { ForecastVendor, PurchaseForecast } from "@/components/purchasing/purchase-forecast-form";

export const dynamic = "force-dynamic";

async function ambil<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// F41 Forecast vs Realisasi PO — per bulan × lini × vendor (rombak 13 Okt 2026).
// Jaring kedua di server (nav `show` sudah menyembunyikan menu).
export default async function PurchaseForecastPage() {
  const me = await sessionUser();
  if (!canViewPurchaseForecast(me)) {
    redirect("/akses-ditolak?menu=Forecast%20vs%20Realisasi%20PO");
  }
  // Periode awal = bulan berjalan versi WIB.
  const [y, m] = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).split("-").map(Number);
  const qs = `year=${y}&month=${m}`;
  const [vendors, summary, rows] = await Promise.all([
    ambil<{ vendors: ForecastVendor[] }>("/purchase-forecast/vendors"),
    ambil<PurchaseForecastSummary>(`/purchase-forecast/summary?${qs}`),
    ambil<{ rows: PurchaseForecast[] }>(`/purchase-forecast?${qs}`),
  ]);

  return (
    <>
      <PageHeader
        title="Forecast vs Realisasi PO"
        description="Rencana pembelian per bulan × lini × vendor dibanding PO Accurate. Lini & brand diambil dari Klasifikasi Produk."
      />
      {!summary ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : (
        <PurchaseForecastDashboard
          vendors={vendors?.vendors ?? []}
          initialYear={y}
          initialMonth={m}
          initialSummary={summary}
          initialRows={rows?.rows ?? []}
        />
      )}
    </>
  );
}
