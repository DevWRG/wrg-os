import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SuppliersTable, type AccurateVendor } from "@/components/tables/suppliers-table";

export const dynamic = "force-dynamic";

async function getVendors(): Promise<AccurateVendor[] | null> {
  try {
    const res = await gatewayFetch(`/accurate/vendors?limit=2000`);
    if (!res.ok) return null;
    const data = (await res.json()) as { rows: AccurateVendor[] };
    return data.rows ?? [];
  } catch {
    return null;
  }
}

export default async function SuppliersPage() {
  const vendors = await getVendors();
  return (
    <>
      <PageHeader title="Suppliers" description="Vendor/supplier dari Accurate (accurate_vendor)." />
      <Card>
        <CardContent className="pt-6">
          {!vendors ? (
            <EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & sinkron Accurate aktif." />
          ) : vendors.length === 0 ? (
            <EmptyState title="Belum ada vendor" description="Jalankan sinkron: POST /accurate/sync/vendors." />
          ) : (
            <SuppliersTable vendors={vendors} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
