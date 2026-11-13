import Link from "next/link";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ProyekDetail } from "@/components/proyek-hd/proyek-detail";

export const dynamic = "force-dynamic";

export default async function ProyekHdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  const { id } = await params;
  if (!me || !featureAllowed(me, "/proyek-hd", "view")) {
    return (
      <>
        <PageHeader title="Proyek HD" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  if (!/^\d{1,12}$/.test(id)) return <EmptyState title="Proyek tidak ditemukan" description="Alamat halaman tidak valid." />;
  return (
    <>
      <PageHeader title="Detail Proyek HD" action={<Link href="/proyek-hd" className="text-primary text-sm font-semibold">← Semua proyek</Link>} />
      <ProyekDetail id={id} bolehUbah={featureAllowed(me, "/proyek-hd", "edit")} />
    </>
  );
}
