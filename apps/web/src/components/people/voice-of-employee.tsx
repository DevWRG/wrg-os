"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface VoiceItem {
  kind: string; content: string; employee_id: string; nama: string;
  dept: string | null; dept_label: string | null; dept_color: string | null;
}

const kindStyle = (k: string) =>
  k === "pain"
    ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";
const kindLabel = (k: string) => (k === "pain" ? "Kendala" : "Ide");

// F128 Voice of Employee (tab Kendala & Usulan) — agregat pain/ide lintas karyawan; filter kind + dept + cari.
export function VoiceOfEmployee({ items }: { items: VoiceItem[] }) {
  const [kind, setKind] = useState<"all" | "pain" | "idea">("all");
  const [dept, setDept] = useState<string>("all");
  const [q, setQ] = useState("");

  const depts = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) if (it.dept) m.set(it.dept, it.dept_label ?? it.dept);
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [items]);

  const painCount = useMemo(() => items.filter((i) => i.kind === "pain").length, [items]);
  const ideaCount = useMemo(() => items.filter((i) => i.kind === "idea").length, [items]);
  const contributors = useMemo(() => new Set(items.map((i) => i.employee_id)).size, [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((i) =>
      (kind === "all" || i.kind === kind) &&
      (dept === "all" || i.dept === dept) &&
      (!term || i.content.toLowerCase().includes(term) || i.nama.toLowerCase().includes(term)),
    );
  }, [items, kind, dept, q]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Kendala (pain)</div><div className="mt-1 text-2xl font-bold text-rose-600">{painCount}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Ide / Usulan</div><div className="mt-1 text-2xl font-bold text-emerald-600">{ideaCount}</div></CardContent></Card>
        <Card><CardContent className="py-4"><div className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Kontributor</div><div className="mt-1 text-2xl font-bold">{contributors}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border p-1">
          {([["all", "Semua"], ["pain", "Kendala"], ["idea", "Ide"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari isi / nama…" className="h-8 w-56" />
        <span className="text-muted-foreground text-xs">{filtered.length} item</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setDept("all")} className={`rounded-full border px-2.5 py-1 text-xs ${dept === "all" ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"}`}>Semua dept</button>
        {depts.map((d) => (
          <button key={d.key} onClick={() => setDept(d.key)} className={`rounded-full border px-2.5 py-1 text-xs ${dept === d.key ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"}`}>{d.label}</button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {filtered.map((it, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${kindStyle(it.kind)}`}>{kindLabel(it.kind)}</span>
              <p className="text-sm">{it.content}</p>
            </div>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: it.dept_color ?? "var(--color-muted-foreground)" }} />
              <span className="font-medium text-foreground">{it.nama}</span>
              {it.dept_label && <span>· {it.dept_label}</span>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground col-span-full py-8 text-center text-sm">Tidak ada item cocok.</p>}
      </div>
    </div>
  );
}
