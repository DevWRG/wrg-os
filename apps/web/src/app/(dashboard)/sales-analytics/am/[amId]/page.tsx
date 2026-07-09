import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { AmDrilldownTables, type Drilldown } from "@/components/sales-analytics/am-drilldown";

export const dynamic = "force-dynamic";

// Halaman drilldown satu AM (dibuka dari tombol Detail di tab Per-AM). Rentang
// tanggal aktif diteruskan via query (?from&to). Scope row-level via x-user-id.
export default async function AmDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ amId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ amId }, sp, me] = await Promise.all([params, searchParams, sessionUser()]);
  const qs = new URLSearchParams();
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const q = qs.toString();

  let data: Drilldown | null = null;
  let error = "";
  try {
    const res = await gatewayFetch(`/sales-analytics/per-am/${amId}/drilldown${q ? `?${q}` : ""}`, {
      headers: me?.id ? { "x-user-id": me.id } : {},
    });
    if (res.ok) data = (await res.json()) as Drilldown;
    else error = res.status === 403 ? "Kamu hanya boleh membuka data AM sendiri." : `Gagal memuat (HTTP ${res.status}).`;
  } catch {
    error = "Gagal memuat data drilldown.";
  }

  const backHref = `/sales-analytics?view=per-am`;
  const period = sp.from || sp.to ? `${sp.from || "awal"} → ${sp.to || "now"}` : "year-to-date";

  return (
    <>
      <div className="mb-2">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> Kembali ke Per-AM
        </Link>
      </div>
      <PageHeader title={`Drilldown AM ${amId}`} description={`Rincian per produk & per customer · periode ${period}. (F127)`} />
      {error ? (
        <p className="text-muted-foreground">{error}</p>
      ) : data ? (
        <AmDrilldownTables data={data} />
      ) : (
        <p className="text-muted-foreground">Data tidak tersedia.</p>
      )}
    </>
  );
}
