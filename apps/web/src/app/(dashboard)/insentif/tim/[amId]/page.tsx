import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { InsentifPeriodePicker } from "@/components/insentif/insentif-periode-picker";
import { InsentifRincian } from "@/components/insentif/insentif-rincian";
import {
  periodeSah, type BarisBulanan, type BarisTransaksi,
} from "@/components/insentif/insentif-format";
import { sessionUser } from "@/lib/admin-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

interface DetailResult {
  periode: string;
  ringkas: BarisBulanan;
  transaksi: BarisTransaksi[];
}

// Rincian insentif satu AM, untuk HoD/Finance/Direktur.
//
// Di luar scope → backend membalas **404**, bukan 403 (PRD §E.2.5): 403 mengonfirmasi
// bahwa orang itu PUNYA catatan insentif, dan untuk payroll konfirmasi itu sendiri sudah
// kebocoran. Halaman ini meneruskan apa adanya lewat notFound() — jadi "AM cabang lain"
// dan "AM yang tak ada" terlihat sama dari luar.
//
// Rute ini ikut gate menu /insentif/tim: findNavItem mencocokkan prefiks terpanjang,
// jadi /insentif/tim/<amId> kena item Insentif Tim — bukan item "Insentif Saya" yang
// terbuka untuk semua orang.
async function fetchDetail(userId: string, amId: string, periode: string): Promise<DetailResult | null> {
  try {
    const res = await gatewayFetch(
      `/insentif/${encodeURIComponent(amId)}?periode=${encodeURIComponent(periode)}`,
      { headers: { "x-user-id": userId } },
    );
    if (!res.ok) return null;
    return (await res.json()) as DetailResult;
  } catch {
    return null;
  }
}

export default async function InsentifAmDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ amId: string }>;
  searchParams: Promise<{ periode?: string }>;
}) {
  const [me, p, sp] = await Promise.all([sessionUser(), params, searchParams]);
  if (!me) notFound();

  const periode = periodeSah(sp.periode);
  const data = await fetchDetail(me.id, p.amId, periode);
  if (!data) notFound();

  const nama = data.ringkas.nama || p.amId;

  return (
    <div className="flex flex-col gap-5">
      {/* "Kembali" di ATAS header — idiom drilldown yang sama dengan Sales Analytics per-AM. */}
      <div className="-mb-2">
        <Link
          href={`/insentif/tim?periode=${periode}`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" /> Kembali ke Insentif Tim
        </Link>
      </div>
      <PageHeader
        title={nama}
        description={`Rincian insentif per transaksi${data.ringkas.tier_ut ? ` · tier ${data.ringkas.tier_ut}` : ""}`}
        action={<InsentifPeriodePicker periode={periode} />}
      />
      <InsentifRincian
        periode={data.periode}
        ringkas={data.ringkas}
        transaksi={data.transaksi}
      />
    </div>
  );
}
