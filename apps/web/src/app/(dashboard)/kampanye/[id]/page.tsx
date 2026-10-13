import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KampanyeDetailView } from "@/components/kampanye/kampanye-detail";
import type { OpsiKampanye } from "@/components/kampanye/kampanye-form";
import type { DetailKampanye } from "@/components/kampanye/types";

export const dynamic = "force-dynamic";

export default async function KampanyeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/kampanye", "view")) {
    return (
      <>
        <PageHeader title="Kampanye" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return <EmptyState title="Kampanye tak ditemukan" description="Periksa tautannya." />;
  const bolehUbah = featureAllowed(me, "/kampanye", "edit");
  let d: DetailKampanye | null = null;
  let status = 0;
  let opsi: OpsiKampanye = { brands: [], am: [] };
  try {
    const h = { headers: { "x-user-id": me.id } };
    const [a, b] = await Promise.all([gatewayFetch(`/campaigns/${id}`, h), bolehUbah ? gatewayFetch("/campaign-options", h) : null]);
    status = a.status;
    if (a.ok) d = (await a.json()) as DetailKampanye;
    if (b?.ok) opsi = (await b.json()) as OpsiKampanye;
  } catch { d = null; }

  return (
    <>
      <PageHeader
        title={d ? d.kampanye.nama : "Kampanye"}
        description={d ? `${d.kampanye.kode} · kampanye non-KSO` : undefined}
        action={<Link href="/kampanye" className="text-muted-foreground text-sm hover:underline">← Semua kampanye</Link>}
      />
      {!d
        ? <EmptyState title={status === 404 ? "Kampanye tak ditemukan" : "Backend tidak terjangkau"} description={status === 404 ? "Periksa tautannya." : "Coba muat ulang beberapa saat lagi."} />
        : <KampanyeDetailView d={d} opsi={opsi} bolehUbah={bolehUbah} />}
    </>
  );
}
