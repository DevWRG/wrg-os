"use client";

import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dept, EmployeeItem } from "@/components/people/employee-spine-manager";

interface OrgReport { id: string; nama: string; role: string | null; dept_label: string | null }
export interface OrgReporting {
  hods: { key: string; name: string; role: string; reports: OrgReport[] }[];
  ambiguous: (OrgReport & { hod_names: string[] })[];
  unmapped: (OrgReport & { atasan_raw: string })[];
  counts: { total: number; mapped: number; ambiguous: number; unmapped: number };
}

function MemberRow({ nama, role, sub }: { nama: string; role: string | null; sub?: string | null }) {
  return (
    <div className="border-border/60 border-b pb-1.5 last:border-0 last:pb-0">
      <div className="text-sm font-medium">{nama}</div>
      {role && <div className="text-muted-foreground truncate text-xs" title={role}>{role}</div>}
      {sub && <div className="text-muted-foreground text-[11px]">{sub}</div>}
    </div>
  );
}

function RootBox({ line }: { line: string }) {
  return (
    <>
      <div className="flex justify-center">
        <div className="rounded-xl border-2 border-primary/40 bg-primary-soft px-6 py-3 text-center">
          <div className="text-primary text-base font-bold">WRG Group</div>
          <div className="text-muted-foreground text-xs">{line}</div>
        </div>
      </div>
      <div className="mx-auto h-4 w-px bg-border" aria-hidden />
    </>
  );
}

// F129 Org Chart. Dua mode: "Per Departemen" (ORG_BASIC, dari dept) & "Reporting
// Line" (ORG_OPTIMAL, karyawan di bawah HoD hasil resolver F121 — bila tersedia).
export function OrgChart({ departments, employees, reporting }: { departments: Dept[]; employees: EmployeeItem[]; reporting?: OrgReporting | null }) {
  const [mode, setMode] = useState<"dept" | "reporting">("dept");

  const byDept = useMemo(() => {
    const m = new Map<string, EmployeeItem[]>();
    for (const e of employees) { const k = e.dept ?? "_none"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return m;
  }, [employees]);

  const ordered = useMemo(() => {
    const list = [...departments].sort((a, b) => a.label.localeCompare(b.label));
    const none = byDept.get("_none");
    const out = list.map((d) => ({ key: d.key, label: d.label, color: d.color, members: byDept.get(d.key) ?? [] }));
    if (none && none.length) out.push({ key: "_none", label: "Tanpa departemen", color: null, members: none });
    return out;
  }, [departments, byDept]);

  return (
    <div className="space-y-4">
      {reporting && (
        <div className="flex gap-1 rounded-lg border p-1 w-fit">
          {([["dept", "Per Departemen"], ["reporting", "Reporting Line"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setMode(k)} className={`rounded-md px-3 py-1 text-sm font-medium ${mode === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{lbl}</button>
          ))}
        </div>
      )}

      {mode === "dept" || !reporting ? (
        <>
          <RootBox line={`${employees.length} karyawan · ${ordered.filter((d) => d.members.length).length} departemen`} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ordered.map((d) => (
              <Card key={d.key} className="overflow-hidden">
                <CardHeader className="gap-1 border-b py-3" style={d.color ? { borderTopColor: d.color, borderTopWidth: 3 } : undefined}>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color ?? "var(--color-muted-foreground)" }} />
                      {d.label}
                    </CardTitle>
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">{d.members.length}</span>
                  </div>
                </CardHeader>
                <CardContent className="max-h-80 space-y-1.5 overflow-y-auto py-3">
                  {d.members.length === 0 ? <p className="text-muted-foreground text-xs">Belum ada anggota.</p>
                    : d.members.map((m) => <MemberRow key={m.id} nama={m.nama} role={m.role} sub={[m.cabang, m.lokasi].filter(Boolean).join(" · ") || null} />)}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <>
          <RootBox line={`${reporting.counts.mapped}/${reporting.counts.total} ter-mapping ke ${reporting.hods.filter((h) => h.reports.length).length} HoD · ${reporting.counts.ambiguous} ambigu · ${reporting.counts.unmapped} belum`} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reporting.hods.filter((h) => h.reports.length > 0).map((h) => (
              <Card key={h.key} className="overflow-hidden">
                <CardHeader className="gap-0.5 border-b py-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span>{h.name}</span>
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">{h.reports.length}</span>
                  </CardTitle>
                  <div className="text-muted-foreground text-xs">{h.role}</div>
                </CardHeader>
                <CardContent className="max-h-80 space-y-1.5 overflow-y-auto py-3">
                  {h.reports.map((m) => <MemberRow key={m.id} nama={m.nama} role={m.role} sub={m.dept_label} />)}
                </CardContent>
              </Card>
            ))}
          </div>

          {reporting.ambiguous.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader className="border-b py-3"><CardTitle className="text-sm text-amber-700 dark:text-amber-400">Ambigu — multi-HOD ({reporting.ambiguous.length})</CardTitle></CardHeader>
              <CardContent className="grid gap-1.5 py-3 sm:grid-cols-2 lg:grid-cols-3">
                {reporting.ambiguous.map((m) => <MemberRow key={m.id} nama={m.nama} role={m.role} sub={`↳ ${m.hod_names.join(" / ")}`} />)}
              </CardContent>
            </Card>
          )}
          {reporting.unmapped.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader className="border-b py-3"><CardTitle className="text-sm text-rose-700 dark:text-rose-400">Belum ter-mapping ({reporting.unmapped.length})</CardTitle></CardHeader>
              <CardContent className="grid gap-1.5 py-3 sm:grid-cols-2 lg:grid-cols-3">
                {reporting.unmapped.map((m) => <MemberRow key={m.id} nama={m.nama} role={m.role} sub={m.atasan_raw ? `atasan: ${m.atasan_raw}` : "atasan tak disebut"} />)}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
