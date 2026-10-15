import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPmfScorecard } from "@/lib/pmf-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PmfView } from "@/components/pmf/pmf-view";
import type { PmfScorecard } from "@/components/pmf/types";

export const dynamic = "force-dynamic";

// F48 PMF Scorecard fase 1 — win-rate deal per brand x region per kuartal. Hanya membaca pipeline
// (tanpa tulis/LLM/WA). Kunci izin sendiri 'pmf-scorecard', default tertutup (lib/pmf-access.ts).
export default async function PmfScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ tahun?: string; kuartal?: string }>;
}) {
  const me = await sessionUser();
  if (!canViewPmfScorecard(me)) {
    return (
      <>
        <PageHeader title="PMF Scorecard" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  const { tahun, kuartal } = await searchParams;
  const q = new URLSearchParams();
  if (tahun && /^\d{4}$/.test(tahun)) q.set("tahun", tahun);
  if (kuartal && /^[1-4]$/.test(kuartal)) q.set("kuartal", kuartal);
  let data: PmfScorecard | null = null;
  try {
    const r = await gatewayFetch(`/pmf-scorecard${q.size ? `?${q}` : ""}`);
    if (r.ok) data = (await r.json()) as PmfScorecard;
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="PMF Scorecard"
        description="Brand mana yang menang atau kalah per region — win-rate deal pipeline (Closing-Won vs Closing-Lost) per kuartal."
      />
      {!data
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <PmfView data={data} />}
    </>
  );
}
