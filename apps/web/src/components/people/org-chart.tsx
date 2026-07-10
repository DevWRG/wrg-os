"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dept, EmployeeItem } from "@/components/people/employee-spine-manager";

// F129 Org Chart (ORG_BASIC) — struktur per DEPARTEMEN dari spine F118.
// Root "WRG Group" → 9 departemen (label+warna dari tabel department) → anggota.
// Reporting-line per individu belum dimodelkan (hod_key kosong, atasan_raw free-text);
// pakai grouping departemen yang datanya reliable.
export function OrgChart({ departments, employees }: { departments: Dept[]; employees: EmployeeItem[] }) {
  const byDept = useMemo(() => {
    const m = new Map<string, EmployeeItem[]>();
    for (const e of employees) {
      const k = e.dept ?? "_none";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [employees]);

  // Urut: department resmi (by label) dulu, lalu "Tanpa departemen" bila ada.
  const ordered = useMemo(() => {
    const list = [...departments].sort((a, b) => a.label.localeCompare(b.label));
    const none = byDept.get("_none");
    const out: { key: string; label: string; color: string | null; members: EmployeeItem[] }[] = list.map((d) => ({
      key: d.key, label: d.label, color: d.color, members: byDept.get(d.key) ?? [],
    }));
    if (none && none.length) out.push({ key: "_none", label: "Tanpa departemen", color: null, members: none });
    return out;
  }, [departments, byDept]);

  return (
    <div className="space-y-4">
      {/* Root */}
      <div className="flex justify-center">
        <div className="rounded-xl border-2 border-primary/40 bg-primary-soft px-6 py-3 text-center">
          <div className="text-primary text-base font-bold">WRG Group</div>
          <div className="text-muted-foreground text-xs">{employees.length} karyawan · {ordered.filter((d) => d.members.length).length} departemen</div>
        </div>
      </div>
      <div className="mx-auto h-4 w-px bg-border" aria-hidden />

      {/* Departemen */}
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
              {d.members.length === 0 ? (
                <p className="text-muted-foreground text-xs">Belum ada anggota.</p>
              ) : (
                d.members.map((m) => (
                  <div key={m.id} className="border-border/60 border-b pb-1.5 last:border-0 last:pb-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {m.nama}
                      {m.roster_pending && <span className="text-amber-600 dark:text-amber-400" title="Roster pending">•</span>}
                    </div>
                    {m.role && <div className="text-muted-foreground truncate text-xs" title={m.role}>{m.role}</div>}
                    {(m.cabang || m.lokasi) && (
                      <div className="text-muted-foreground text-[11px]">{[m.cabang, m.lokasi].filter(Boolean).join(" · ")}</div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
