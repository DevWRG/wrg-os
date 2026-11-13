import Link from "next/link";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { OpsHalaman } from "@/components/proyek-hd/ops-halaman";

export const dynamic = "force-dynamic";

// Data operasional Proyek HD: konstruksi, kurva S, RO, mesin, keuangan, permintaan RS, isu, funnel.
export default async function OpsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/proyek-hd", "view")) {
    return (
      <>
        <PageHeader title="Data Operasional Proyek HD" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const { slug } = await params;
  const sp = await searchParams;
  const proyek = typeof sp.proyek === "string" && /^\d{1,12}$/.test(sp.proyek) ? sp.proyek : null;
  return (
    <>
      <PageHeader
        title="Data Operasional Proyek HD"
        description={proyek ? "Data operasional satu proyek." : "Semua proyek. Buka dari halaman detail proyek untuk menyaring satu RS."}
        action={<Link href={proyek ? `/proyek-hd/${proyek}` : "/proyek-hd"} className="text-primary text-sm font-semibold">← Kembali</Link>}
      />
      <OpsHalaman slug={slug} proyekId={proyek} boleh={{
        buat: featureAllowed(me, "/proyek-hd", "create"),
        ubah: featureAllowed(me, "/proyek-hd", "edit"),
        hapus: featureAllowed(me, "/proyek-hd", "delete"),
      }} />
    </>
  );
}
