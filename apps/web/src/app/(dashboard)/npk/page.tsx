import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NpkMatrix } from "@/components/npk/npk-matrix";
import { NpkPeriodPicker } from "@/components/npk/npk-period-picker";
import { NpkBriefing } from "@/components/npk/npk-briefing";
import { NpkActionQueue } from "@/components/npk/npk-action-queue";
import { NpkSectionPlaceholder } from "@/components/npk/npk-section-placeholder";
import { computeSummary } from "@/components/npk/npk-status";
import type { NpkMatrixResult } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

async function fetchScores(userId: string, year: number, period: "S1" | "S2"): Promise<NpkMatrixResult | null> {
  try {
    const res = await gatewayFetch(`/npk/scores?year=${year}&period=${period}`, { headers: { "x-user-id": userId } });
    return res.ok ? ((await res.json()) as NpkMatrixResult) : null;
  } catch { return null; }
}

// F66 NPK — Menu Direktur: matrix NPK 8 HoD × 7 aspek (SK Pasal 3). Gate: admin/superuser.
export default async function NpkDirekturPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);
  const isDirektur = me?.role === "admin" || me?.superuser === true;

  if (!isDirektur) {
    return (
      <>
        <PageHeader title="NPK Direktur" description="Nilai Prestasi Karyawan — semua HoD." />
        <EmptyState title="Akses terbatas" description="Halaman ini hanya untuk Direktur (admin). Jika Anda HoD, gunakan menu “NPK Saya”." />
      </>
    );
  }

  const reqYear = sp.year ? Number(sp.year) : new Date().getFullYear();
  const reqPeriod: "S1" | "S2" = sp.period === "S1" ? "S1" : sp.period === "S2" ? "S2" : new Date().getMonth() < 6 ? "S1" : "S2";
  // Periode sebelumnya (utk delta): S2→S1 tahun sama; S1→S2 tahun lalu.
  const prev = reqPeriod === "S2" ? { year: reqYear, period: "S1" as const } : { year: reqYear - 1, period: "S2" as const };

  const [data, prevData] = await Promise.all([
    fetchScores(me!.id, reqYear, reqPeriod),
    fetchScores(me!.id, prev.year, prev.period),
  ]);

  const activeYear = data?.year ?? reqYear;
  const activePeriod = (data?.period ?? reqPeriod) as "S1" | "S2";
  const summary = data ? computeSummary(data.rows, prevData?.rows ?? null) : null;
  const computedAt = data?.rows.find((r) => r.computed_at)?.computed_at ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="NPK Direktur"
        description="Nilai Prestasi Karyawan per HoD — 7 aspek SK Pasal 3, per semester."
        action={<NpkPeriodPicker year={activeYear} period={activePeriod} />}
      />

      {summary && <NpkBriefing summary={summary} year={activeYear} period={activePeriod} computedAt={computedAt} />}
      {data && data.rows.length > 0 && <NpkActionQueue rows={data.rows} />}

      <NpkMatrix data={data} />

      <NpkSectionPlaceholder
        num={2}
        title="AM NPK Matrix · 12 AM × 7 Aspek"
        note="Matrix NPK per Account Manager (mode Sales) — struktur sama seperti matrix HoD, di-skor per AM. Belum di-compute: engine NPK saat ini baru menghitung 8 HoD."
        needs={["Perluasan engine compute ke level AM (revenue/AR per am_id via sales_target_am)", "Penyimpanan skor NPK per-AM (keyed am_id)"]}
      />
      <NpkSectionPlaceholder
        num={3}
        title="HoD KPI Library · Composite Breakdown (Non-Sales)"
        note="Untuk HoD non-sales (Finance/Aftersales/Accounting/BD-GA), Aspek Revenue diganti composite KPI per peran (IT delivery, uptime, renewal on-time, dsb)."
        needs={["Definisi KPI + bobot per peran non-sales", "Feed pencapaian KPI (mis. tabel kpi_measurement)"]}
      />
      <NpkSectionPlaceholder
        num={4}
        title="Trend vs Baseline"
        note="Sparkline tren skor coaching/NPK 6 bulan berjalan vs baseline, per HoD."
        needs={["Snapshot NPK berkala (bulanan/informal) untuk rolling trend", "Aspek Coaching ter-feed (input manual HoD)"]}
      />
    </div>
  );
}
