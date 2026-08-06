import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NpkSelfDetail } from "@/components/npk/npk-self-detail";
import { NpkSelfBriefing } from "@/components/npk/npk-self-briefing";
import { NpkPeriodPicker } from "@/components/npk/npk-period-picker";
import type { NpkDetailResult } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

// Respons /npk/am/scores/:ref memakai am_id/am_name → dipetakan ke subjek generik.
interface ApiAmDetail extends Omit<NpkDetailResult, "subject_key" | "subject_name"> {
  am_id: string; am_name: string; cabang: string | null;
}

async function fetchDetail(userId: string, year: number, period: "S1" | "S2"): Promise<NpkDetailResult | null> {
  try {
    // `ref` = app_user.id; backend resolve ke am_id lalu memvalidasi scope. Sengaja
    // TIDAK mengirim am_id dari sisi web — kalau ref-nya bisa ditentukan klien,
    // gate "hanya diri sendiri" jadi bergantung pada UI, bukan server.
    const res = await gatewayFetch(`/npk/am/scores/${userId}?year=${year}&period=${period}`, { headers: { "x-user-id": userId } });
    if (!res.ok) return null;
    const d = (await res.json()) as ApiAmDetail;
    return {
      ...d,
      subject_key: d.am_id,
      subject_name: d.am_name,
      role: d.cabang ? `AM · ${d.cabang}` : "AM",
    };
  } catch { return null; }
}

// F66 NPK level AM — "NPK Saya" untuk staff AM/sales: gauge + radar 7 aspek,
// hanya dirinya. Gate menu+rute: canViewNpkAmSelf lewat katalog nav → redirect
// di layout dashboard. Backend tetap menolak (403) bila ref bukan diri sendiri.
export default async function NpkAmSelfPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);

  if (!me?.am_id) {
    return (
      <>
        <PageHeader title="NPK Saya" description="Nilai Prestasi Karyawan Anda." />
        <EmptyState
          title="Khusus AM / Sales"
          description="Menu ini menampilkan NPK untuk akun AM/sales. Akun Anda belum tertaut ke data AM (am_id). Hubungi admin bila ini keliru."
        />
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
