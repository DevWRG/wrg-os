import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NpkSelfDetail } from "@/components/npk/npk-self-detail";
import { NpkPeriodPicker } from "@/components/npk/npk-period-picker";
import type { NpkDetailResult } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

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

  const qs = new URLSearchParams();
  if (sp.year) qs.set("year", sp.year);
  if (sp.period) qs.set("period", sp.period);
  let data: NpkDetailResult | null = null;
  try {
    const res = await gatewayFetch(`/npk/scores/${me.id}${qs.toString() ? `?${qs}` : ""}`, { headers: { "x-user-id": me.id } });
    if (res.ok) data = (await res.json()) as NpkDetailResult;
  } catch { data = null; }

  const activeYear = data?.year ?? (sp.year ? Number(sp.year) : new Date().getFullYear());
  const activePeriod = (data?.period ?? (sp.period === "S1" ? "S1" : sp.period === "S2" ? "S2" : new Date().getMonth() < 6 ? "S1" : "S2")) as "S1" | "S2";

  return (
    <>
      <PageHeader
        title="NPK Saya"
        description="Nilai Prestasi Karyawan Anda — 7 aspek SK Pasal 3, per semester."
        action={<NpkPeriodPicker year={activeYear} period={activePeriod} />}
      />
      <NpkSelfDetail data={data} />
    </>
  );
}
