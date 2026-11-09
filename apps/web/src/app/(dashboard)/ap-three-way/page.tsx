import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ApView } from "@/components/ap-three-way/ap-view";
import type { ListData } from "@/components/ap-three-way/types";

export const dynamic = "force-dynamic";

// F152 3-Way Match Faktur Pembelian (AP) — faktur vendor Accurate vs PO vs penerimaan, toleransi 0%.
// Read-only: selisih ditandai, penyelesaiannya di Accurate. Kunci izin 'ap-three-way', tertutup default.
export default async function ApThreeWayPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/ap-three-way", "view")) {
    return (
      <>
        <PageHeader title="3-Way Match AP" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: ListData | null = null;
  let pending = false;
  try {
    const r = await gatewayFetch("/ap/three-way?limit=500");
    if (r.status === 503) pending = true;
    else if (r.ok) data = (await r.json()) as ListData;
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="3-Way Match Faktur Pembelian (AP)"
        description="Faktur vendor dari Accurate dicocokkan ke PO dan penerimaan barang per baris, toleransi 0%. Hanya penanda: penyelesaian selisih dilakukan di Accurate. (F152)"
      />
      {pending
        ? <EmptyState title="Migrasi belum diterapkan" description="Tabel faktur pembelian belum ada di database (migrasi 240)." />
        : !data
          ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
          : <ApView data={data} />}
    </>
  );
}
