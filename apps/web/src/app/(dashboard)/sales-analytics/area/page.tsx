import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AreaInfografis, type InfografisData } from "@/components/sales-analytics/area-infografis";

export const dynamic = "force-dynamic";

// Infografis "Sales Area Performance" — tujuan link di ringkasan WA grup Koord HoD
// (pengganti kirim PDF/gambar). Gerbang menu = Sales Analytics (layout); scope AM
// ditolak di API karena isinya angka semua sales. ?tanggal=YYYY-MM-DD (default hari ini).
export default async function SalesAreaPage({ searchParams }: { searchParams: Promise<{ tanggal?: string }> }) {
  const [sp, me] = await Promise.all([searchParams, sessionUser()]);
  const tanggal = sp.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(sp.tanggal) ? sp.tanggal : "";
  let data: InfografisData | null = null;
  let error = "";
  try {
    const res = await gatewayFetch(`/sales-analytics/area${tanggal ? `?as_of=${tanggal}` : ""}`, {
      headers: me?.id ? { "x-user-id": me.id } : {},
    });
    if (res.ok) data = (await res.json()) as InfografisData;
    else error = res.status === 403 ? "Halaman ini khusus HoD dan Direktur." : `Gagal memuat (HTTP ${res.status}).`;
  } catch {
    error = "Backend tidak terjangkau. Coba muat ulang.";
  }
  const diperbarui = data
    ? new Date(data.generated_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })
    : "";

  return (
    <>
      <PageHeader
        title="Sales Area Performance"
        description={data ? `Per ${data.performance.as_of} · omzet netto tanpa PPN dari faktur Accurate · diperbarui ${diperbarui}` : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/sales-analytics" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ArrowLeft className="size-4" /> Sales Analytics
        </Link>
        <form method="get" className="ml-auto flex items-center gap-2">
          <Input type="date" name="tanggal" defaultValue={data?.performance.as_of ?? tanggal} className="w-40" aria-label="Tanggal" />
          <Button type="submit" size="sm" variant="soft">Tampilkan</Button>
        </form>
      </div>
      {error || !data ? <EmptyState title="Tidak bisa ditampilkan" description={error || "Data tidak tersedia."} /> : <AreaInfografis data={data} />}
    </>
  );
}
