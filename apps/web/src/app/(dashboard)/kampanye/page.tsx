import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KampanyeListView } from "@/components/kampanye/kampanye-list";
import type { OpsiKampanye } from "@/components/kampanye/kampanye-form";
import type { KampanyeList } from "@/components/kampanye/types";

export const dynamic = "force-dynamic";

// F74 Campaign Tracker (menyerap F46). Kampanye non-KSO per brand/item +
// periode; realisasi faktur/SO dihitung otomatis dan di-scope apps/api dari
// x-user-id (AM = dirinya, HoD = cabang timnya, admin = semua).
export default async function KampanyePage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/kampanye", "view")) {
    return (
      <>
        <PageHeader title="Kampanye" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const bolehTambah = featureAllowed(me, "/kampanye", "create");
  let data: KampanyeList[] | null = null;
  let opsi: OpsiKampanye = { brands: [], am: [] };
  try {
    const h = { headers: { "x-user-id": me.id } };
    const [a, b] = await Promise.all([gatewayFetch("/campaigns", h), bolehTambah ? gatewayFetch("/campaign-options", h) : null]);
    if (a.ok) data = ((await a.json()) as { campaigns: KampanyeList[] }).campaigns;
    if (b?.ok) opsi = (await b.json()) as OpsiKampanye;
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="Kampanye"
        description="Kampanye penjualan non-KSO per brand/produk: target per AM, realisasi faktur & SO otomatis, dan corong lead → deal → faktur."
      />
      {!data
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <KampanyeListView data={data} opsi={opsi} bolehTambah={bolehTambah} />}
    </>
  );
}
