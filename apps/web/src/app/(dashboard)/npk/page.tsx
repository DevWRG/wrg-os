import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NpkMatrix } from "@/components/npk/npk-matrix";
import type { NpkMatrixResult } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

// F66 NPK — Menu Direktur: matrix NPK 8 HoD × 7 aspek (SK Pasal 3). Gate: admin/superuser.
export default async function NpkDirekturPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  const isDirektur = me?.role === "admin" || me?.superuser === true;

  if (!isDirektur) {
    return (
      <>
        <PageHeader title="NPK Direktur" description="Nilai Prestasi Karyawan — semua HoD." />
        <EmptyState title="Akses terbatas" description="Halaman ini hanya untuk Direktur (admin). Jika Anda HoD, gunakan menu “NPK Saya”." />
      </>
    );
  }

  const qs = new URLSearchParams();
  if (sp.year) qs.set("year", sp.year);
  if (sp.period) qs.set("period", sp.period);
  let data: NpkMatrixResult | null = null;
  try {
    const res = await gatewayFetch(`/npk/scores${qs.toString() ? `?${qs}` : ""}`, { headers: { "x-user-id": me!.id } });
    if (res.ok) data = (await res.json()) as NpkMatrixResult;
  } catch { data = null; }

  return (
    <>
      <PageHeader title="NPK Direktur" description="Nilai Prestasi Karyawan per HoD — 7 aspek SK Pasal 3, per semester." />
      <NpkMatrix data={data} />
    </>
  );
}
