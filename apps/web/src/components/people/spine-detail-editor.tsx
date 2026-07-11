"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface KpiRow { id: string | null; name: string; target: string; frequency: string; perspective: string; lower_better: boolean }
export interface RaciRow { process: string; role_type: string; note: string }
export interface DetailInit {
  tools: string[]; tasks: string[]; okr_kr: string[]; pain: string[]; idea: string[];
  bsc: { fin: string[]; cust: string[]; proc: string[]; learn: string[] };
  pdca: { plan: string; do: string; check: string; act: string };
  kpi: KpiRow[]; raci: RaciRow[];
}

const PERSP: { k: string; label: string }[] = [
  { k: "fin", label: "Finansial" }, { k: "cust", label: "Pelanggan" }, { k: "proc", label: "Proses Internal" }, { k: "learn", label: "Pembelajaran" },
];
const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const ta = "border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm";

function ListArea({ label, value, onChange, rows = 4, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground text-xs font-medium">{label}{hint && <span className="ml-1 font-normal opacity-70">({hint})</span>}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className={ta} />
    </label>
  );
}

// F118c — editor sub-koleksi profil (BSC/OKR/KPI/PDCA/RACI/Voice/tools/tasks).
// List = 1 baris per item. KPI & RACI = baris terstruktur (tambah/hapus).
// Simpan → PUT .../detail (replace transaksional; KPI id-aware jaga measurement).
export function SpineDetailEditor({ id, init, onCancel, onSaved }: { id: string; init: DetailInit; onCancel: () => void; onSaved: () => void }) {
  const [tools, setTools] = useState(init.tools.join("\n"));
  const [tasks, setTasks] = useState(init.tasks.join("\n"));
  const [okr, setOkr] = useState(init.okr_kr.join("\n"));
  const [pain, setPain] = useState(init.pain.join("\n"));
  const [idea, setIdea] = useState(init.idea.join("\n"));
  const [fin, setFin] = useState(init.bsc.fin.join("\n"));
  const [cust, setCust] = useState(init.bsc.cust.join("\n"));
  const [proc, setProc] = useState(init.bsc.proc.join("\n"));
  const [learn, setLearn] = useState(init.bsc.learn.join("\n"));
  const [pdca, setPdca] = useState(init.pdca);
  const [kpi, setKpi] = useState<KpiRow[]>(init.kpi);
  const [raci, setRaci] = useState<RaciRow[]>(init.raci);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const setKpiField = (i: number, patch: Partial<KpiRow>) => setKpi((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setRaciField = (i: number, patch: Partial<RaciRow>) => setRaci((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true); setMsg(null);
    const payload = {
      tools: linesToArr(tools), tasks: linesToArr(tasks), okr_kr: linesToArr(okr), pain: linesToArr(pain), idea: linesToArr(idea),
      bsc: { fin: linesToArr(fin), cust: linesToArr(cust), proc: linesToArr(proc), learn: linesToArr(learn) },
      pdca: (pdca.plan || pdca.do || pdca.check || pdca.act) ? pdca : null,
      kpi: kpi.filter((k) => k.name.trim()).map((k) => ({ id: k.id, name: k.name.trim(), target: k.target || null, frequency: k.frequency || null, perspective: k.perspective || null, lower_better: k.lower_better })),
      raci: raci.filter((r) => r.process.trim() && r.role_type.trim()).map((r) => ({ process: r.process.trim(), role_type: r.role_type.trim(), note: r.note || null })),
    };
    try {
      const r = await fetch(`/api/employee-spine/employees/${id}/detail`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) { setMsg(`Gagal: ${j.error ?? r.status}`); return; }
      onSaved();
    } catch { setMsg("Gagal: backend tak terjangkau"); }
    finally { setSaving(false); }
  };

  return (
    <Card><CardContent className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-base font-semibold">Edit Detail Profil</h4>
        <div className="flex items-center gap-2">
          {msg && <span className={`text-xs font-medium ${msg.startsWith("Gagal") ? "text-red-600" : "text-emerald-600"}`}>{msg}</span>}
          <Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? "Menyimpan…" : "Simpan Detail"}</Button>
          <Button size="sm" variant="outline" onClick={onCancel}>Batal</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ListArea label="BSC — Finansial" value={fin} onChange={setFin} hint="1 objektif per baris" />
        <ListArea label="BSC — Pelanggan" value={cust} onChange={setCust} hint="1 objektif per baris" />
        <ListArea label="BSC — Proses Internal" value={proc} onChange={setProc} hint="1 objektif per baris" />
        <ListArea label="BSC — Pembelajaran" value={learn} onChange={setLearn} hint="1 objektif per baris" />
      </div>

      <ListArea label="OKR — Key Results" value={okr} onChange={setOkr} hint="1 KR per baris" />

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">KPI</span>
          <Button size="sm" variant="outline" onClick={() => setKpi((r) => [...r, { id: null, name: "", target: "", frequency: "", perspective: "", lower_better: false }])}>+ KPI</Button>
        </div>
        <div className="space-y-2">
          {kpi.map((k, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_7rem_6rem_9rem_auto_auto]">
              <Input value={k.name} placeholder="Nama KPI" onChange={(e) => setKpiField(i, { name: e.target.value })} className="h-8" />
              <Input value={k.target} placeholder="Target" onChange={(e) => setKpiField(i, { target: e.target.value })} className="h-8" />
              <Input value={k.frequency} placeholder="Frek" onChange={(e) => setKpiField(i, { frequency: e.target.value })} className="h-8" />
              <select value={k.perspective} onChange={(e) => setKpiField(i, { perspective: e.target.value })} className="border-input bg-background h-8 rounded-md border px-2 text-sm">
                <option value="">— persp —</option>
                {PERSP.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
              </select>
              <label className="flex items-center gap-1 text-xs" title="Makin rendah makin baik"><input type="checkbox" checked={k.lower_better} onChange={(e) => setKpiField(i, { lower_better: e.target.checked })} />▼</label>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setKpi((r) => r.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          {kpi.length === 0 && <p className="text-muted-foreground text-xs">Belum ada KPI.</p>}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <ListArea label="PDCA — Plan" value={pdca.plan} onChange={(v) => setPdca((p) => ({ ...p, plan: v }))} rows={2} />
        <ListArea label="PDCA — Do" value={pdca.do} onChange={(v) => setPdca((p) => ({ ...p, do: v }))} rows={2} />
        <ListArea label="PDCA — Check" value={pdca.check} onChange={(v) => setPdca((p) => ({ ...p, check: v }))} rows={2} />
        <ListArea label="PDCA — Act" value={pdca.act} onChange={(v) => setPdca((p) => ({ ...p, act: v }))} rows={2} />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">RACI (peran di proses)</span>
          <Button size="sm" variant="outline" onClick={() => setRaci((r) => [...r, { process: "", role_type: "", note: "" }])}>+ RACI</Button>
        </div>
        <div className="space-y-2">
          {raci.map((r, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_6rem_1fr_auto]">
              <Input value={r.process} placeholder="Proses" onChange={(e) => setRaciField(i, { process: e.target.value })} className="h-8" />
              <Input value={r.role_type} placeholder="R/A/C/I" onChange={(e) => setRaciField(i, { role_type: e.target.value })} className="h-8" />
              <Input value={r.note} placeholder="Keterangan" onChange={(e) => setRaciField(i, { note: e.target.value })} className="h-8" />
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRaci((rr) => rr.filter((_, j) => j !== i))}>×</Button>
            </div>
          ))}
          {raci.length === 0 && <p className="text-muted-foreground text-xs">Belum ada RACI.</p>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ListArea label="Kendala (pain)" value={pain} onChange={setPain} hint="1 per baris" />
        <ListArea label="Usulan / Ide" value={idea} onChange={setIdea} hint="1 per baris" />
        <ListArea label="Tools" value={tools} onChange={setTools} hint="1 per baris" />
        <ListArea label="Tugas Utama" value={tasks} onChange={setTasks} hint="1 per baris" />
      </div>
    </CardContent></Card>
  );
}
