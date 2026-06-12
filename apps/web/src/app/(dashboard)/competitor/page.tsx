import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddCompetitorSheet } from "@/components/crm/add-competitor-sheet";
import { CompetitorTable } from "@/components/tables/competitor-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface CompetitorItem {
  id: string;
  am_id: string | null;
  customer_name: string | null;
  tanggal: string;
  vendor: string;
  produk: string | null;
  produk_kategori: string | null;
  harga_text: string | null;
  harga_numeric: number | null;
  konteks: string | null;
}
interface CompetitorResponse {
  count: number;
  items: CompetitorItem[];
}
interface VendorStat {
  vendor: string;
  sebutan: number;
  harga_rata: number | null;
  terakhir: string;
}
interface CompetitorSummary {
  count: number;
  summary: VendorStat[];
}


async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(`${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function CompetitorPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>;
}) {
  const { vendor: vendorRaw } = await searchParams;
  const vendor = vendorRaw?.trim() || "";
  const qs = vendor ? `?vendor=${encodeURIComponent(vendor)}` : "";

  const [summary, list] = await Promise.all([
    getJson<CompetitorSummary>("/competitor/summary"),
    getJson<CompetitorResponse>(`/competitor${qs}`),
  ]);
  const items = list?.items ?? null;
  const totalVendors = summary?.count ?? 0;
  const topVendors = (summary?.summary ?? []).slice(0, 12);
  const totalRecords = (summary?.summary ?? []).reduce((s, v) => s + v.sebutan, 0);

  return (
    <>
      <PageHeader
        title="Competitor Intel"
        description={
          totalRecords > 0
            ? `${totalRecords} catatan dari ${totalVendors} kompetitor (port competitor_intel).`
            : "Intelijen kompetitor dari lapangan (port competitor_intel)."
        }
        action={<AddCompetitorSheet />}
      />

      {!summary ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : totalRecords === 0 ? (
        <p className="text-muted-foreground">
          Belum ada intel. Catat via <code>POST /competitor</code>.
        </p>
      ) : (
        <>
          <form action="/competitor" className="flex flex-wrap items-center gap-2">
            <Input
              name="vendor"
              defaultValue={vendor}
              placeholder="Cari vendor… (mis. Wondfo)"
              className="h-8 max-w-xs"
            />
            <Button type="submit" variant="outline" size="sm">
              Cari
            </Button>
            {vendor && (
              <Button render={<Link href="/competitor" />} variant="ghost" size="sm">
                Reset
              </Button>
            )}
          </form>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/competitor"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition-colors",
                vendor === ""
                  ? "border-primary bg-primary-soft text-primary font-medium"
                  : "border-border bg-card text-foreground shadow-[var(--shadow-card)] hover:border-primary/40 hover:bg-muted",
              )}
            >
              Semua
              <span className={cn("text-xs", vendor === "" ? "opacity-80" : "text-muted-foreground")}>{totalRecords}</span>
            </Link>
            {topVendors.map((v) => {
              const isActive = vendor.toLowerCase() === v.vendor.toLowerCase();
              return (
                <Link
                  key={v.vendor}
                  href={`/competitor?vendor=${encodeURIComponent(v.vendor)}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm transition-colors",
                    isActive
                      ? "border-primary bg-primary-soft text-primary font-medium"
                      : "border-border bg-card text-foreground shadow-[var(--shadow-card)] hover:border-primary/40 hover:bg-muted",
                  )}
                >
                  {v.vendor}
                  <span className={cn("text-xs", isActive ? "opacity-80" : "text-muted-foreground")}>{v.sebutan}</span>
                </Link>
              );
            })}
          </div>

          <Card>
            <CardContent className="pt-6">
              {!items ? (
                <p className="text-muted-foreground">Gagal memuat daftar intel.</p>
              ) : items.length === 0 ? (
                <p className="text-muted-foreground">Tidak ada catatan untuk vendor &ldquo;{vendor}&rdquo;.</p>
              ) : (
                <CompetitorTable items={items} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
