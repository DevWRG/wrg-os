import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditOrderWa, canViewOrderWa } from "@/lib/order-wa-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderView, type DataOrder } from "@/components/order-wa/order-view";

export const dynamic = "force-dynamic";

// F90 Antrean Order. Gerbang menu juga ditegakkan layout (navVisible); isi ber-scope di API.
export default async function OrderWaPage() {
  const me = await sessionUser();
  if (!canViewOrderWa(me)) {
    return (
      <>
        <PageHeader title="Antrean Order" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: DataOrder | null = null;
  try {
    const r = await gatewayFetch("/order-wa", { headers: me ? { "x-user-id": me.id } : {} });
    if (r.ok) data = (await r.json()) as DataOrder;
  } catch { data = null; }
  return (
    <>
      <PageHeader title="Antrean Order" description="Pesanan AM lewat WhatsApp #ORDER — Admin Sales menginput SO di Accurate, sistem mencocokkan otomatis." />
      {data ? <OrderView awal={data} bisaUbah={canEditOrderWa(me)} /> : <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />}
    </>
  );
}
