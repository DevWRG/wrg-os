import { aiDryRun, callAi } from "../ai.js";
import { db } from "../db.js";
import { getRaportDetail } from "./raport.js";

// Fase 3 — narasi AI Raport 360. Generate BATCH (dijadwalkan setelah 23:00) per
// karyawan+periode → services/ai /raport-narrative → simpan raport_narrative
// (cache, dibaca getRaportDetail). Fallback deterministik di services/ai (tak
// mengarang) bila LLM mati.

interface NarrativeResult { ok: boolean; amId: string; period?: string; model?: string; reason?: string }

export async function generateRaportNarrative(amId: string, period?: string): Promise<NarrativeResult> {
  const d = await getRaportDetail(amId, period);
  if (!d.found) return { ok: false, amId, reason: "not-found" };

  const signals = {
    nama: d.employee.nama,
    panggilan: d.employee.panggilan,
    role: d.employee.role,
    cabang: d.employee.cabang,
    is_am: d.employee.is_am,
    period_label: d.period_label,
    score: { overall: d.score.overall, rating: d.score.rating },
    parts: d.score.parts.map((p) => ({ label: p.label, score: p.score })),
    workload: d.workload,
    compliance: d.plan_report?.compliance_rate ?? null,
    active_days: d.absensi.active_days,
    leave_days: d.absensi.leave_days,
    revenue: d.revenue ? { total: d.revenue.total, pct: d.revenue.pct } : null,
    ar: d.ar ? { outstanding: d.ar.outstanding } : null,
    bsc: d.bsc ? { persp: d.bsc.persp, objectives: d.bsc.objectives } : null,
    okr: d.okr,
    categories: d.items.categories,
    status: d.items.status,
    failures: d.items.failures.slice(0, 10),
    blockers: d.items.blockers.slice(0, 10),
    coaching: d.coaching ? { score: d.coaching.score, strengths: d.coaching.strengths, gaps: d.coaching.gaps } : null,
  };

  const { status, data } = await callAi("/raport-narrative", {
    signals,
    period_label: d.period_label,
    dry_run: aiDryRun(),
  });
  if (status !== 200) return { ok: false, amId, period: d.period, reason: `services/ai ${status}` };

  const model = String(data.model ?? "");
  const narrativeObj = {
    pantas_puas: data.pantas_puas ?? [],
    penahan: data.penahan ?? [],
    bsc: data.bsc ?? {},
    akar_masalah: data.akar_masalah ?? "",
    catatan_adil: data.catatan_adil ?? "",
    ringkasan: data.ringkasan ?? "",
    predikat: data.predikat ?? "",
  };
  const sql = db();
  await sql`
    INSERT INTO raport_narrative (am_id, period, verdict, headline, narrative, model, created_at)
    VALUES (${amId}, ${d.period}, ${String(data.verdict ?? "")}, ${String(data.headline ?? "")},
            ${sql.json(narrativeObj as unknown as Parameters<typeof sql.json>[0])}, ${model}, NOW())
    ON CONFLICT (am_id, period) DO UPDATE SET
      verdict = EXCLUDED.verdict, headline = EXCLUDED.headline,
      narrative = EXCLUDED.narrative, model = EXCLUDED.model, created_at = NOW()
  `;
  return { ok: true, amId, period: d.period, model };
}

export interface RaportNarrativeBatchResult {
  period: string | null; total: number; generated: number; skipped: number; failed: number;
  errors: { amId: string; reason: string }[];
}

// Batch: semua karyawan aktif yang punya sinyal (ada item/plan atau profil spine)
// pada periode. Serial (nightly job) + toleran error per-orang.
export async function runRaportNarrative(opts: { period?: string } = {}): Promise<RaportNarrativeBatchResult> {
  const sql = db();
  const roster = await sql`SELECT am_id FROM master_user WHERE aktif ORDER BY nama`;
  const res: RaportNarrativeBatchResult = { period: null, total: roster.length, generated: 0, skipped: 0, failed: 0, errors: [] };
  for (const u of roster) {
    const amId = String(u.am_id);
    try {
      const d = await getRaportDetail(amId, opts.period);
      if (!d.found) { res.skipped++; continue; }
      res.period = d.period;
      // Lewati bila tak ada yang bisa dinarasikan (tak ada item & tak ada spine).
      if (d.workload.total === 0 && !d.bsc && (!d.plan_report || d.plan_report.expected === 0)) {
        res.skipped++;
        continue;
      }
      const r = await generateRaportNarrative(amId, opts.period);
      if (r.ok) res.generated++;
      else { res.failed++; res.errors.push({ amId, reason: r.reason ?? "?" }); }
    } catch (e) {
      res.failed++;
      res.errors.push({ amId, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return res;
}
