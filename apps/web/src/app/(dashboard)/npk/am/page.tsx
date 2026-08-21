import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { NpkMatrix } from "@/components/npk/npk-matrix";
import { NpkPeriodPicker } from "@/components/npk/npk-period-picker";
import { NpkBriefing } from "@/components/npk/npk-briefing";
import { NpkActionQueue } from "@/components/npk/npk-action-queue";
import { computeSummary } from "@/components/npk/npk-status";
import type { AspectKey, NpkMatrixResult, NpkMatrixRow, Predikat } from "@/components/npk/npk-format";

export const dynamic = "force-dynamic";

// Bentuk respons /npk/am/scores (subjek = master_user.am_id) → baris matrix generik.
interface ApiAmRow {
  am_id: string; am_name: string; panggilan: string | null; cabang: string | null;
  npk: number; predikat: Predikat; available_count: number;
  aspects: Record<AspectKey, { capped: number | null; available: boolean }>;
  computed_at: string | null;
}
type ApiAmResult = Omit<NpkMatrixResult, "rows"> & { rows: ApiAmRow[] };

const toMatrix = (d: ApiAmResult): NpkMatrixResult => ({
  ...d,
  rows: d.rows.map<NpkMatrixRow>((r) => ({
    subject_key: r.am_id,
    subject_name: r.am_name,
    role: r.cabang ? `AM · ${r.cabang}` : "AM",
    user_id: null,
    npk: r.npk, predikat: r.predikat, available_count: r.available_count,
    aspects: r.aspects, computed_at: r.computed_at,
  })),
});

async function fetchScores(userId: string, year: number, period: "S1" | "S2"): Promise<NpkMatrixResult | null> {
  try {
    const res = await gatewayFetch(`/npk/am/scores?year=${year}&period=${period}`, { headers: { "x-user-id": userId } });
    return res.ok ? toMatrix((await res.json()) as ApiAmResult) : null;
  } catch { return null; }
}

// F66 NPK level AM — matrix semua AM × 7 aspek (SK Pasal 3).
// Gate menu+rute: canViewNpkAm (Direktur/admin + HoD) lewat katalog nav → layout
// dashboard yang redirect. Pembatasan BARIS tetap di server (visibleAms): kalau
// suatu saat akun non-HoD diberi izin fitur ini, dia tetap hanya melihat barisnya
// sendiri — halaman ini tidak pernah jadi jalan pintas ke data AM lain.
export default async function NpkAmPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; period?: string }>;
}) {
  const [me, sp] = await Promise.all([sessionUser(), searchParams]);

  const reqYear = sp.year ? Number(sp.year) : new Date().getFullYear();
  const reqPeriod: "S1" | "S2" = sp.period === "S1" ? "S1" : sp.period === "S2" ? "S2" : new Date().getMonth() < 6 ? "S1" : "S2";
  // Periode sebelumnya (utk delta): S2→S1 tahun sama; S1→S2 tahun lalu.
  const prev = reqPeriod === "S2" ? { year: reqYear, period: "S1" as const } : { year: reqYear - 1, period: "S2" as const };

  const [data, prevData] = await Promise.all([
    fetchScores(me?.id ?? "", reqYear, reqPeriod),
    fetchScores(me?.id ?? "", prev.year, prev.period),
  ]);

  const activeYear = data?.year ?? reqYear;
  const activePeriod = (data?.period ?? reqPeriod) as "S1" | "S2";
  const summary = data ? computeSummary(data.rows, prevData?.rows ?? null) : null;
  const computedAt = data?.rows.find((r) => r.computed_at)?.computed_at ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="NPK AM"
        description="Nilai Prestasi Karyawan per Account Manager — 7 aspek SK Pasal 3, per semester."
        action={<NpkPeriodPicker year={activeYear} period={activePeriod} />}
      />

      {summary && <NpkBriefing summary={summary} year={activeYear} period={activePeriod} computedAt={computedAt} subjectLabel="AM" />}
      {data && data.rows.length > 0 && <NpkActionQueue rows={data.rows} />}

      <NpkMatrix
        data={data}
        title={`Matrix NPK AM · ${data?.rows.length ?? 0} AM × 7 Aspek`}
        subjectLabel="AM"
        computeHint="POST /npk/am/compute"
        naNote="Untuk AM: KSO/GP/Coaching belum punya sumber data; Revenue N/A selama target AM belum diisi di Sales → Target, dan Customer N/A selama golongan AM belum di-set di AM → Cabang. Skor per aspek memakai tabel berjenjang SK Pasal 3.2 (poin maks tiap aspek = bobotnya), sama dengan NPK HoD sejak v1.166.0 — angkanya sebanding lintas menu."
      />
    </div>
  );
}
