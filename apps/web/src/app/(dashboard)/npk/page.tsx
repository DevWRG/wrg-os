import Link from "next/link";
import { Users } from "lucide-react";

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
import type { AspectKey, NpkMatrixResult, NpkMatrixRow, Predikat } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

// Bentuk respons /npk/scores (subjek = HoD) → baris matrix generik yang dipakai
// komponen bersama dengan /npk/am (lihat catatan di npk-format.ts).
interface ApiHodRow {
  hod_key: string; hod_name: string; role: string; user_id: string | null;
  npk: number; predikat: Predikat; available_count: number;
  aspects: Record<AspectKey, { capped: number | null; available: boolean }>;
  computed_at: string | null;
}
type ApiHodResult = Omit<NpkMatrixResult, "rows"> & { rows: ApiHodRow[] };

const toMatrix = (d: ApiHodResult): NpkMatrixResult => ({
  ...d,
  rows: d.rows.map<NpkMatrixRow>((r) => ({
    subject_key: r.hod_key, subject_name: r.hod_name, role: r.role, user_id: r.user_id,
    npk: r.npk, predikat: r.predikat, available_count: r.available_count,
    aspects: r.aspects, computed_at: r.computed_at,
  })),
});

async function fetchScores(userId: string, year: number, period: "S1" | "S2"): Promise<NpkMatrixResult | null> {
  try {
    const res = await gatewayFetch(`/npk/scores?year=${year}&period=${period}`, { headers: { "x-user-id": userId } });
    return res.ok ? toMatrix((await res.json()) as ApiHodResult) : null;
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

      {summary && <NpkBriefing summary={summary} year={activeYear} period={activePeriod} computedAt={computedAt} subjectLabel="HoD" />}
      {data && data.rows.length > 0 && <NpkActionQueue rows={data.rows} />}

      <NpkMatrix
        data={data}
        title="Matrix NPK HoD · 8 HoD × 7 Aspek"
        subjectLabel="HoD"
        naNote="Untuk HoD: KSO/GP/Coaching belum punya sumber data, dan HoD non-cabang tak punya scope sales."
      />

      {/* Matrix per AM dulu placeholder di sini; sekarang jadi menu sendiri (078). */}
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="size-4 shrink-0" />
        Matrix NPK per Account Manager pindah ke menu <Link href="/npk/am" className="font-medium text-primary hover:underline">NPK AM</Link> — aspek Revenue, Customer, AR &amp; CRM sudah di-compute per AM.
      </p>

      <NpkSectionPlaceholder
        num={2}
        title="HoD KPI Library · Composite Breakdown (Non-Sales)"
        note="Untuk HoD non-sales (Finance/Aftersales/Accounting/BD-GA), Aspek Revenue diganti composite KPI per peran (IT delivery, uptime, renewal on-time, dsb)."
        needs={["Definisi KPI + bobot per peran non-sales", "Feed pencapaian KPI (mis. tabel kpi_measurement)"]}
      />
      <NpkSectionPlaceholder
        num={3}
        title="Trend vs Baseline"
        note="Sparkline tren skor coaching/NPK 6 bulan berjalan vs baseline, per HoD."
        needs={["Snapshot NPK berkala (bulanan/informal) untuk rolling trend", "Aspek Coaching ter-feed (input manual HoD)"]}
      />
    </div>
  );
}
