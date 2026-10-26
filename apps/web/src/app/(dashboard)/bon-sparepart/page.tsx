import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditBonSparepart, canViewBonSparepart } from "@/lib/bon-sparepart-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BonView, type DataBon } from "@/components/bon-sparepart/bon-view";

export const dynamic = "force-dynamic";

// F155 Bon Sparepart Teknisi. Gerbang menu juga ditegakkan layout (navVisible).
export default async function BonSparepartPage() {
  const me = await sessionUser();
  if (!canViewBonSparepart(me)) {
    return (
      <>
        <PageHeader title="Bon Sparepart" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: DataBon | null = null;
  try {
    const r = await gatewayFetch("/bon-sparepart", { headers: me ? { "x-user-id": me.id } : {} });
    if (r.ok) data = (await r.json()) as DataBon;
  } catch { data = null; }
  return (
    <>
      <PageHeader title="Bon Sparepart" description="Bon sparepart teknisi (gudang mencatat, teknisi melapor lewat WhatsApp #BON) dan opname — bon yang sudah dilaporkan vs belum, serta rekonsiliasi ke SJ." />
      {data ? <BonView awal={data} bisaUbah={canEditBonSparepart(me)} /> : <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />}
    </>
  );
}
