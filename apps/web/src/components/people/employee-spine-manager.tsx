"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/use-confirm";
import { SpineDetailEditor, type DetailInit } from "@/components/people/spine-detail-editor";

export interface Dept { key: string; label: string; color: string | null; weights: Record<string, number>; count: number }
export interface EmployeeItem {
  id: string; nama: string; dept: string | null; dept_label: string | null; dept_color: string | null;
  role: string | null; cabang: string | null; lokasi: string | null; roster_pending: boolean; kpi_count: number;
}
interface Kpi { id: string; name: string; target: string | null; frequency: string | null; perspective: string | null; lower_better: boolean }
interface Profile {
  id: string; nama: string; dept: string | null; dept_label: string | null; dept_color: string | null; role: string | null;
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
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

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
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally { setLoading(false); }
  }, []);

  const createEmp = async (data: EmpFormData) => {
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/employee-spine/employees", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const j = await r.json();
      if (!r.ok) { setErr(String(j.error ?? `HTTP ${r.status}`)); return; }
      setCreating(false); router.refresh();
    } catch { setErr("Gagal menyimpan (backend tak terjangkau)"); }
    finally { setSaving(false); }
  };

  if (profile) return <ProfileView key={profile.id} p={profile} departments={departments} onBack={() => setProfile(null)} onUpdated={setProfile} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setDept("")} className={`rounded-full px-3 py-1 text-xs font-medium ${dept === "" ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>Semua ({employees.length})</button>
        {departments.map((d) => (
          <button key={d.key} onClick={() => setDept(d.key)} className={`rounded-full px-3 py-1 text-xs font-medium ${dept === d.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>{d.label} ({d.count})</button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama/role/cabang…" className="h-8 w-56" />
        {loading && <span className="text-muted-foreground text-sm">Memuat…</span>}
        <Button size="sm" className="ml-auto" onClick={() => { setCreating((v) => !v); setErr(null); }}>{creating ? "Batal" : "+ Tambah Karyawan"}</Button>
      </div>

      {creating && (
        <Card>
          <CardHeader><CardTitle className="text-base">Tambah Karyawan</CardTitle></CardHeader>
          <CardContent>
            {err && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div>}
            <EmployeeForm departments={departments} initial={emptyForm()} submitting={saving} onCancel={() => setCreating(false)} onSubmit={createEmp} />
          </CardContent>
        </Card>
      )}

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

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ProfileView({ p, departments, onBack, onUpdated }: { p: Profile; departments: Dept[]; onBack: () => void; onUpdated: (p: Profile) => void }) {
  const [inputs, setInputs] = useState<Record<string, number>>(() => Object.fromEntries(p.kpi.map((k) => [k.id, 100])));
  const [period, setPeriod] = useState(currentMonth);
  const [loadingM, setLoadingM] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const sc = computeScore(p.kpi, p.weights, inputs);

  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [editingDetail, setEditingDetail] = useState(false);
  const [savingEmp, setSavingEmp] = useState(false);
  const [empErr, setEmpErr] = useState<string | null>(null);

  const saveEmp = async (data: EmpFormData) => {
    setSavingEmp(true); setEmpErr(null);
    try {
      const r = await fetch(`/api/employee-spine/employees/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const j = await r.json();
      if (!r.ok) { setEmpErr(String(j.error ?? `HTTP ${r.status}`)); return; }
      const rr = await fetch(`/api/employee-spine/employees/${p.id}`);
      if (rr.ok) onUpdated((await rr.json()) as Profile);
      setEditing(false); router.refresh();
    } catch { setEmpErr("Gagal menyimpan (backend tak terjangkau)"); }
    finally { setSavingEmp(false); }
  };

  const removeEmp = () => confirm(
    { title: `Hapus ${p.nama}?`, description: "Profil + semua KPI/BSC/OKR/PDCA/RACI/Voice/measurement karyawan ini dihapus permanen.", destructive: true, confirmLabel: "Hapus" },
    async () => { const r = await fetch(`/api/employee-spine/employees/${p.id}`, { method: "DELETE" }); if (r.ok) { router.refresh(); onBack(); } },
  );

  // Prefill % dari measurement tersimpan utk periode terpilih (default 100).
  const loadMeasurements = useCallback(async (per: string) => {
    setLoadingM(true); setSavedMsg(null);
    try {
      const r = await fetch(`/api/employee-spine/employees/${p.id}/measurements?period=${encodeURIComponent(per)}`);
      const base = Object.fromEntries(p.kpi.map((k) => [k.id, 100])) as Record<string, number>;
      if (r.ok) {
        const data = (await r.json()) as { measurements: { kpi_id: string; achievement_pct: number }[] };
        for (const m of data.measurements ?? []) base[m.kpi_id] = m.achievement_pct;
      }
      setInputs(base);
    } finally { setLoadingM(false); }
  }, [p.id, p.kpi]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill inputs dari measurement tersimpan; disengaja.
    void loadMeasurements(period);
  }, [period, loadMeasurements]);

  const save = useCallback(async () => {
    setSaving(true); setSavedMsg(null);
    try {
      const items = p.kpi.map((k) => ({ kpi_id: k.id, achievement_pct: Math.round(inputs[k.id] ?? 100) }));
      const r = await fetch(`/api/employee-spine/employees/${p.id}/measurements`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ period, items }),
      });
      const data = await r.json();
      setSavedMsg(r.ok ? `Tersimpan ${data.saved ?? items.length} KPI · ${period}` : `Gagal: ${data.error ?? r.status}`);
    } catch {
      setSavedMsg("Gagal: backend tak terjangkau");
    } finally { setSaving(false); }
  }, [p.id, p.kpi, inputs, period]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{p.nama}{p.panggilan ? ` (${p.panggilan})` : ""}</h3>
          <div className="text-muted-foreground text-sm">{p.role ?? "—"} · {p.dept_label ?? "—"}{p.cabang ? ` · ${p.cabang}` : ""}</div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setEditing((v) => !v); setEmpErr(null); }}>{editing ? "Batal Edit" : "Edit"}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditingDetail((v) => !v)}>{editingDetail ? "Tutup Detail" : "Edit Detail"}</Button>
          <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={removeEmp}>Hapus</Button>
          <Button size="sm" variant="outline" onClick={onBack}>← Kembali</Button>
        </div>
      </div>

      {editing && (
        <Card>
          <CardHeader><CardTitle className="text-base">Edit Karyawan</CardTitle></CardHeader>
          <CardContent>
            {empErr && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{empErr}</div>}
            <EmployeeForm departments={departments} initial={profileToForm(p)} submitting={savingEmp} onCancel={() => setEditing(false)} onSubmit={saveEmp} />
          </CardContent>
        </Card>
      )}

      {editingDetail && (
        <SpineDetailEditor
          id={p.id}
          init={profileToDetail(p)}
          onCancel={() => setEditingDetail(false)}
          onSaved={async () => { const rr = await fetch(`/api/employee-spine/employees/${p.id}`); if (rr.ok) onUpdated((await rr.json()) as Profile); setEditingDetail(false); router.refresh(); }}
        />
      )}

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

      <Section title="Kalkulator & Scorecard BSC (F119)">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground text-xs">Periode</span>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-8 w-40" />
          </label>
          <Button size="sm" onClick={() => void save()} disabled={saving || loadingM}>{saving ? "Menyimpan…" : "Simpan"}</Button>
          {loadingM && <span className="text-muted-foreground text-xs">Memuat data periode…</span>}
          {savedMsg && <span className={`text-xs font-medium ${savedMsg.startsWith("Gagal") ? "text-red-600" : "text-emerald-600"}`}>{savedMsg}</span>}
        </div>
        <p className="text-muted-foreground mb-3 text-xs">Isi % pencapaian tiap KPI (cap 120%) untuk periode di atas, lalu <b>Simpan</b>. Skor per-perspektif dirata-ratakan, bobot dinormalisasi ke perspektif ber-KPI. Perspektif &lt;80% memicu PDCA. Nilai tersimpan per periode &amp; dimuat ulang saat periode diganti.</p>
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
      {dialog}
    </div>
  );
}

// Profile → init editor detail (F118c). List kosong → array kosong; pdca null → string kosong.
function profileToDetail(p: Profile): DetailInit {
  return {
    tools: p.tools ?? [], tasks: p.tasks ?? [], okr_kr: p.okr_kr ?? [], pain: p.pain ?? [], idea: p.idea ?? [],
    bsc: { fin: p.bsc?.fin ?? [], cust: p.bsc?.cust ?? [], proc: p.bsc?.proc ?? [], learn: p.bsc?.learn ?? [] },
    pdca: { plan: p.pdca?.plan ?? "", do: p.pdca?.do ?? "", check: p.pdca?.check ?? "", act: p.pdca?.act ?? "" },
    kpi: p.kpi.map((k) => ({ id: k.id, name: k.name, target: k.target ?? "", frequency: k.frequency ?? "", perspective: k.perspective ?? "", lower_better: k.lower_better })),
    raci: p.raci.map((r) => ({ process: r.process, role_type: r.role_type, note: r.note ?? "" })),
  };
}

// ── Form CRUD karyawan (dipakai create & edit) ──
interface EmpFormData {
  nama: string; dept: string; role: string; panggilan: string; cabang: string; lokasi: string;
  whatsapp: string; masa: string; atasan_raw: string; okr_objective: string; quote: string; roster_pending: boolean;
}
function emptyForm(): EmpFormData {
  return { nama: "", dept: "", role: "", panggilan: "", cabang: "", lokasi: "", whatsapp: "", masa: "", atasan_raw: "", okr_objective: "", quote: "", roster_pending: false };
}
function profileToForm(p: Profile): EmpFormData {
  return {
    nama: p.nama ?? "", dept: p.dept ?? "", role: p.role ?? "", panggilan: p.panggilan ?? "",
    cabang: p.cabang ?? "", lokasi: p.lokasi ?? "", whatsapp: p.whatsapp ?? "", masa: p.masa ?? "",
    atasan_raw: p.atasan_raw ?? "", okr_objective: p.okr_objective ?? "", quote: p.quote ?? "", roster_pending: p.roster_pending,
  };
}

function EmployeeForm({ departments, initial, submitting, onCancel, onSubmit }: {
  departments: Dept[]; initial: EmpFormData; submitting: boolean; onCancel: () => void; onSubmit: (d: EmpFormData) => void;
}) {
  const [f, setF] = useState<EmpFormData>(initial);
  const set = (k: keyof EmpFormData, v: string | boolean) => setF((prev) => ({ ...prev, [k]: v }) as EmpFormData);
  const field = (label: string, k: keyof EmpFormData) => (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <Input value={f[k] as string} onChange={(e) => set(k, e.target.value)} className="h-8" />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs">Nama *</span>
          <Input value={f.nama} onChange={(e) => set("nama", e.target.value)} className="h-8" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs">Departemen</span>
          <select value={f.dept} onChange={(e) => set("dept", e.target.value)} className="border-input bg-background h-8 rounded-md border px-2 text-sm">
            <option value="">— pilih —</option>
            {departments.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        {field("Panggilan", "panggilan")}
        {field("Role / Jabatan", "role")}
        {field("Cabang", "cabang")}
        {field("Lokasi", "lokasi")}
        {field("WhatsApp", "whatsapp")}
        {field("Masa kerja", "masa")}
        {field("Atasan (mentah)", "atasan_raw")}
        {field("OKR objektif", "okr_objective")}
        {field("Quote", "quote")}
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={f.roster_pending} onChange={(e) => set("roster_pending", e.target.checked)} />
          <span>Roster pending</span>
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={submitting || !f.nama.trim()} onClick={() => onSubmit({ ...f, nama: f.nama.trim() })}>{submitting ? "Menyimpan…" : "Simpan"}</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Batal</Button>
      </div>
    </div>
  );
}
