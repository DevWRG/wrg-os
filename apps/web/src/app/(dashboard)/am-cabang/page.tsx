import Link from "next/link";
import { MapPin } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AmCabangTable, type AmRow } from "@/components/sales/am-cabang-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function getData(): Promise<{ rows: AmRow[]; cabang_options: string[] } | null> {
  try {
    const res = await gatewayFetch(`/admin/am-cabang`);
    if (!res.ok) return null;
    return (await res.json()) as { rows: AmRow[]; cabang_options: string[] };
  } catch {
    return null;
  }
}

export default async function AmCabangPage() {
  const data = await getData();
  return (
    <>
      <PageHeader
        title="AM → Cabang"
        description="Petakan tiap AM ke cabang. Region (East/West) kartu Sales Performance diturunkan dari cabang ini via WatchPoint Territory (cabang→HoD)."
        action={
          <Button render={<Link href="/watchpoint/territory" />} variant="outline" size="sm">
            <MapPin /> Territory (cabang→region)
          </Button>
        }
      />
      {!data ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : data.rows.length === 0 ? (
        <p className="text-muted-foreground">Belum ada AM di roster (master_user role AM).</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <AmCabangTable rows={data.rows} cabangOptions={data.cabang_options} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
