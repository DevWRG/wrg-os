import Link from "next/link";
import { MapPin } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AmCabangTable, type AmRow, type GolonganOption } from "@/components/sales/am-cabang-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface AmCabangData { rows: AmRow[]; cabang_options: string[]; golongan_options: GolonganOption[] }

async function getData(): Promise<AmCabangData | null> {
  try {
    const res = await gatewayFetch(`/admin/am-cabang`);
    if (!res.ok) return null;
    return (await res.json()) as AmCabangData;
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
        description="Petakan tiap AM ke cabang & golongan. Cabang menentukan region kartu Sales Performance (via WatchPoint Territory). Golongan = jenjang karir SK Pasal 2.1 — jadi target customer & new-customer di NPK AM."
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
            <AmCabangTable rows={data.rows} cabangOptions={data.cabang_options} golonganOptions={data.golongan_options ?? []} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
