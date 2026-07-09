"use client";

import { useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface Dept { key: string; label: string; color: string | null; weights: Record<string, number>; count: number }
export interface EmployeeItem {
  id: string; nama: string; dept: string | null; dept_label: string | null; dept_color: string | null;
  role: string | null; cabang: string | null; lokasi: string | null; roster_pending: boolean; kpi_count: number;
}
interface Kpi { id: string; name: string; target: string | null; frequency: string | null; perspective: string | null; lower_better: boolean }
interface Profile {
  id: string; nama: string; dept_label: string | null; dept_color: string | null; role: string | null;
  atasan_raw: string | null; lokasi: string | null; masa: string | null; panggilan: string | null; cabang: string | null;
  whatsapp: string | null; roster_pending: boolean; quote: string | null; okr_objective: string | null;
  weights: Record<string, number>; tools: string[]; tasks: string[]; bsc: Record<string, string[]>;
  okr_kr: string[]; kpi: Kpi[]; pdca: { plan: string | null; do: string | null; check: string | null; act: string | null } | null;
  raci: { process: string; role_type: string; note: string | null }[]; pain: string[]; idea: string[];
}

const PERSP: Record<string, { label: string; color: string }> = {
  fin: { label: "Finansial", color: "#1f6f54" },
  cust: { label: "Pelanggan", color: "#2563a8" },
  proc: { label: "Proses Internal", color: "#7a4ba0" },
  learn: { label: "Pembelajaran & Pertumbuhan", color: "#c2691a" },
};
const PORDER = ["fin", "cust", "proc", "learn"];

// F119 — skor BSC tertimbang (cap 120%, renormalisasi bobot atas perspektif ber-KPI).
function computeScore(kpi: Kpi[], weights: Record<string, number>, inputs: Record<string, number>) {
  const byP: Record<string, Kpi[]> = {};
  for (const k of kpi) if (k.perspective) (byP[k.perspective] ??= []).push(k);
  const active = Object.keys(byP);
  const perspScore: Record<string, number> = {};
  for (const p of active) {
    const vals = byP[p].map((k) => Math.min(120, inputs[k.id] ?? 100));
    perspScore[p] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const wsum = active.reduce((a, p) => a + (weights[p] || 0), 0);
  let score = 0;
  const eff: Record<string, number> = {};
  for (const p of active) {
    eff[p] = wsum > 0 ? (weights[p] || 0) / wsum : 1 / active.length;
    score += eff[p] * perspScore[p];
  }
  return { score: Math.round(score), perspScore, eff, active, triggered: active.filter((p) => perspScore[p] < 80) };
}
const ratingOf = (s: number) => (s >= 110 ? "Istimewa" : s >= 95 ? "Sesuai Target" : s >= 80 ? "Perlu Perhatian" : "Perlu Perbaikan");
const ratingTone = (s: number) => (s >= 95 ? "text-emerald-600" : s >= 80 ? "text-amber-600" : "text-red-600");

export function EmployeeSpineManager({ departments, employees }: { departments: Dept[]; employees: EmployeeItem[] }) {
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState<Record<string, number>>({});

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return employees.filter((e) =>
      (!dept || e.dept === dept) &&
      (!term || e.nama.toLowerCase().includes(term) || (e.role ?? "").toLowerCase().includes(term) || (e.cabang ?? "").toLowerCase().includes(term)),
    );
  }, [employees, dept, q]);

  const open = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/employee-spine/employees/${id}`);
      if (r.ok) {
        const p = (await r.json()) as Profile;
        setProfile(p);
        setInputs(Object.fromEntries(p.kpi.map((k) => [k.id, 100])));
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally { setLoading(false); }
  }, []);

  if (profile) return <ProfileView p={profile} inputs={inputs} setInputs={setInputs} onBack={() => setProfile(null)} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setDept("")} className={`rounded-full px-3 py-1 text-xs font-medium ${dept === "" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>Semua ({employees.length})</button>
        {departments.map((d) => (
          <button key={d.key} onClick={() => setDept(d.key)} className={`rounded-full px-3 py-1 text-xs font-medium ${dept === d.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>{d.label} ({d.count})</button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama/role/cabang…" className="h-8 w-56" />
        {loading && <span className="text-muted-foreground text-sm">Memuat…</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((e) => (
          <button key={e.id} onClick={() => open(e.id)} className="rounded-xl border bg-card p-3 text-left transition hover:shadow-md" style={{ borderLeft: `4px solid ${e.dept_color ?? "#94a3b8"}` }}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold leading-tight">{e.nama}</div>
              {e.roster_pending && <Badge variant="outline" className="text-amber-600">pending</Badge>}
            </div>
            <div className="text-muted-foreground mt-1 line-clamp-2 text-xs">{e.role ?? "—"}</div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{e.dept_label ?? "—"}</span>
              <span className="text-muted-foreground">{e.kpi_count} KPI</span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground col-span-full py-8 text-center text-sm">Tidak ada karyawan cocok.</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

function ProfileView({ p, inputs, setInputs, onBack }: { p: Profile; inputs: Record<string, number>; setInputs: (u: Record<string, number>) => void; onBack: () => void }) {
  const sc = computeScore(p.kpi, p.weights, inputs);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{p.nama}{p.panggilan ? ` (${p.panggilan})` : ""}</h3>
          <div className="text-muted-foreground text-sm">{p.role ?? "—"} · {p.dept_label ?? "—"}{p.cabang ? ` · ${p.cabang}` : ""}</div>
        </div>
        <Button size="sm" variant="outline" onClick={onBack}>← Kembali</Button>
      </div>
      {p.quote && <blockquote className="border-primary text-muted-foreground border-l-4 pl-3 text-sm italic">“{p.quote}”</blockquote>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="BSC — 4 Perspektif">
          <div className="grid gap-2 sm:grid-cols-2">
            {PORDER.map((k) => (
              <div key={k} className="rounded-lg p-2 text-xs text-white" style={{ background: PERSP[k].color }}>
                <div className="mb-1 font-semibold uppercase tracking-wide opacity-95">{PERSP[k].label}</div>
                <ul className="list-inside list-disc space-y-0.5">{(p.bsc[k] ?? []).map((o, i) => <li key={i}>{o}</li>)}{(p.bsc[k] ?? []).length === 0 && <li className="opacity-70">—</li>}</ul>
              </div>
            ))}
          </div>
        </Section>
        <Section title="OKR">
          <div className="text-sm font-medium">{p.okr_objective ?? "—"}</div>
          <ul className="mt-2 list-inside list-decimal space-y-1 text-sm">{p.okr_kr.map((k, i) => <li key={i}>{k}</li>)}</ul>
        </Section>
      </div>

      <Section title="KPI">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left"><tr className="border-b"><th className="py-2 pr-3">KPI</th><th className="pr-3">Target</th><th className="pr-3">Frek</th><th className="pr-3">Perspektif</th><th>Arah</th></tr></thead>
            <tbody>{p.kpi.map((k) => (
              <tr key={k.id} className="border-b last:border-0">
                <td className="py-1.5 pr-3 font-medium">{k.name}</td>
                <td className="pr-3">{k.target ?? "—"}</td>
                <td className="pr-3">{k.frequency ?? "—"}</td>
                <td className="pr-3">{k.perspective ? <span style={{ color: PERSP[k.perspective]?.color }}>{PERSP[k.perspective]?.label}</span> : "—"}</td>
                <td>{k.lower_better ? "▼ makin rendah" : "▲ makin tinggi"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Section>

      <Section title="Kalkulator Skor BSC (F119)">
        <p className="text-muted-foreground mb-3 text-xs">Isi % pencapaian tiap KPI (cap 120%). Skor per-perspektif dirata-ratakan, bobot dinormalisasi ke perspektif ber-KPI. Perspektif &lt;80% memicu PDCA.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {p.kpi.map((k) => (
            <label key={k.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate" title={k.name}>{k.name}</span>
              <Input type="number" value={inputs[k.id] ?? 100} onChange={(e) => setInputs({ ...inputs, [k.id]: Number(e.target.value) })} className="h-8 w-20 text-right" />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t pt-3">
          <div><div className="text-muted-foreground text-xs">Skor BSC</div><div className={`text-2xl font-bold ${ratingTone(sc.score)}`}>{sc.score}</div></div>
          <div><div className="text-muted-foreground text-xs">Rating</div><div className={`text-lg font-semibold ${ratingTone(sc.score)}`}>{ratingOf(sc.score)}</div></div>
          <div className="flex flex-wrap gap-2">
            {sc.active.map((pp) => (
              <span key={pp} className="rounded-md px-2 py-1 text-xs" style={{ background: `${PERSP[pp]?.color}22`, color: PERSP[pp]?.color }}>
                {PERSP[pp]?.label}: {Math.round(sc.perspScore[pp])}% (bobot {Math.round(sc.eff[pp] * 100)}%)
              </span>
            ))}
          </div>
        </div>
        {sc.triggered.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-400/50 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30">
            ⚠️ PDCA dipicu untuk: {sc.triggered.map((t) => PERSP[t]?.label).join(", ")} (skor &lt;80%)
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {p.pdca && (
          <Section title="PDCA">
            <dl className="space-y-2 text-sm">
              {([["Plan", p.pdca.plan], ["Do", p.pdca.do], ["Check", p.pdca.check], ["Act", p.pdca.act]] as const).map(([lbl, val]) => (
                <div key={lbl}><dt className="text-muted-foreground text-xs font-semibold uppercase">{lbl}</dt><dd>{val ?? "—"}</dd></div>
              ))}
            </dl>
          </Section>
        )}
        <Section title="RACI (peran di proses)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead className="text-muted-foreground text-left"><tr className="border-b"><th className="py-2 pr-3">Proses</th><th className="pr-3">Peran</th><th>Keterangan</th></tr></thead>
              <tbody>{p.raci.map((r, i) => <tr key={i} className="border-b last:border-0"><td className="py-1.5 pr-3">{r.process}</td><td className="pr-3 font-semibold">{r.role_type}</td><td className="text-muted-foreground">{r.note ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Kendala (Voice)"><ul className="list-inside list-disc space-y-1 text-sm">{p.pain.map((v, i) => <li key={i}>{v}</li>)}{p.pain.length === 0 && <li className="text-muted-foreground">—</li>}</ul></Section>
        <Section title="Usulan / Ide"><ul className="list-inside list-disc space-y-1 text-sm">{p.idea.map((v, i) => <li key={i}>{v}</li>)}{p.idea.length === 0 && <li className="text-muted-foreground">—</li>}</ul></Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Tools"><div className="flex flex-wrap gap-1.5">{p.tools.map((t, i) => <Badge key={i} variant="secondary">{t}</Badge>)}{p.tools.length === 0 && <span className="text-muted-foreground text-sm">—</span>}</div></Section>
        <Section title="Tugas Utama"><ul className="list-inside list-disc space-y-1 text-sm">{p.tasks.map((t, i) => <li key={i}>{t}</li>)}{p.tasks.length === 0 && <li className="text-muted-foreground">—</li>}</ul></Section>
      </div>
    </div>
  );
}
