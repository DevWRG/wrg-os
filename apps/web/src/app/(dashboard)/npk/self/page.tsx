import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NpkSelfDetail } from "@/components/npk/npk-self-detail";
import { NpkSelfBriefing } from "@/components/npk/npk-self-briefing";
import { NpkPeriodPicker } from "@/components/npk/npk-period-picker";
import type { NpkDetailResult } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

async function fetchDetail(userId: string, year: number, period: "S1" | "S2"): Promise<NpkDetailResult | null> {
  try {
    const res = await gatewayFetch(`/npk/scores/${userId}?year=${year}&period=${period}`, { headers: { "x-user-id": userId } });
    return res.ok ? ((await res.json()) as NpkDetailResult) : null;
  } catch { return null; }
}

// F66 NPK — Menu HoD: NPK diri sendiri (gauge + radar 7 aspek). Gate: hod_key ter-set.
export default async function NpkSelfPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);

  if (!me?.hod_key) {
    return (
      <>
        <PageHeader title="NPK Saya" description="Nilai Prestasi Karyawan Anda." />
        <EmptyState title="Khusus HoD" description="Menu ini menampilkan NPK untuk akun HoD. Akun Anda belum tertaut sebagai HoD (hod_key). Hubungi admin bila ini keliru." />
      </>
    );
  }

  const reqYear = sp.year ? Number(sp.year) : new Date().getFullYear();
  const reqPeriod: "S1" | "S2" = sp.period === "S1" ? "S1" : sp.period === "S2" ? "S2" : new Date().getMonth() < 6 ? "S1" : "S2";
  const prev = reqPeriod === "S2" ? { year: reqYear, period: "S1" as const } : { year: reqYear - 1, period: "S2" as const };

  const [data, prevData] = await Promise.all([
    fetchDetail(me.id, reqYear, reqPeriod),
    fetchDetail(me.id, prev.year, prev.period),
  ]);

  const activeYear = data?.year ?? reqYear;
  const activePeriod = (data?.period ?? reqPeriod) as "S1" | "S2";
  const prevNpk = prevData && prevData.available_count > 0 ? prevData.npk : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="NPK Saya"
        description="Nilai Prestasi Karyawan Anda — 7 aspek SK Pasal 3, per semester."
        action={<NpkPeriodPicker year={activeYear} period={activePeriod} />}
      />
      {data && <NpkSelfBriefing data={data} prevNpk={prevNpk} />}
      <NpkSelfDetail data={data} />
    </div>
  );
}
