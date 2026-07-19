"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  fmt1, periodLabel, scoreBand,
  type AspectKey, type NpkMatrixResult, type NpkMatrixRow,
} from "./npk-format";
import { zoneOf } from "./npk-status";

const SHORT: Record<AspectKey, string> = {
  revenue: "Revenue", customer: "Customer", ar: "AR", kso: "KSO", gp: "GP", crm: "CRM", coaching: "Coaching",
};

type SortKey = "name" | "npk" | AspectKey;

export function NpkMatrix({ data }: { data: NpkMatrixResult | null }) {
  const [sortKey, setSortKey] = useState<SortKey>("npk");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(() => {
    if (!data) return [];
    const val = (r: NpkMatrixRow): number | string =>
      sortKey === "name" ? r.hod_name.toLowerCase()
        : sortKey === "npk" ? r.npk
          : (r.aspects[sortKey]?.capped ?? -1);
    return [...data.rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return dir === "asc" ? c : -c;
    });
  }, [data, sortKey, dir]);

  if (!data) return <Card><CardContent className="py-10 text-center text-muted-foreground">Gagal memuat data NPK.</CardContent></Card>;

  const toggle = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setDir(k === "name" ? "asc" : "desc"); }
  };
  const sortIcon = (k: SortKey) =>
    k !== sortKey ? <ChevronsUpDown className="size-3 opacity-40" />
      : dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;

  return (
    <div className="flex flex-col gap-4">
      {!data.computed && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-700 dark:text-amber-400">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>Belum ada hasil compute untuk {periodLabel(data.period)} {data.year}. Jalankan <code className="rounded bg-muted px-1">POST /npk/compute</code> lebih dulu.</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 border-b pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-6 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">1</span>
            <div>
              Matrix NPK HoD · 8 HoD × 7 Aspek
              <p className="text-xs font-normal text-muted-foreground">{periodLabel(data.period)} · {data.year} · SK Pasal 3</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">
                    <button onClick={() => toggle("name")} className="inline-flex items-center gap-1 font-medium hover:text-foreground">HoD {sortIcon("name")}</button>
                  </th>
                  {data.aspect_order.map((k) => (
                    <th key={k} className="px-2 py-2 text-center" title={data.aspect_label[k]}>
                      <button onClick={() => toggle(k)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">{SHORT[k]} {sortIcon(k)}</button>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center">
                    <button onClick={() => toggle("npk")} className="inline-flex items-center gap-1 font-semibold hover:text-foreground">NPK {sortIcon("npk")}</button>
                  </th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-center" title="Aspek dengan sumber data live">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nb = scoreBand(r.npk);
                  return (
                    <tr key={r.hod_key} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.hod_name}</div>
                        <div className="text-xs text-muted-foreground">{r.role}</div>
                      </td>
                      {data.aspect_order.map((k) => {
                        const cell = r.aspects[k];
                        if (!cell?.available || cell.capped == null)
                          return <td key={k} className="px-2 py-2.5 text-center text-xs text-muted-foreground/50">N/A</td>;
                        const b = scoreBand(cell.capped);
                        return (
                          <td key={k} className="px-2 py-2.5 text-center">
                            <span className={cn("inline-block min-w-11 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", b.bg, b.text)}>{fmt1(cell.capped)}</span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center">
                        {r.available_count === 0
                          ? <span className="text-base font-medium text-muted-foreground/50">–</span>
                          : <span className={cn("text-base font-bold tabular-nums", nb.text)}>{fmt1(r.npk)}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {(() => { const z = zoneOf(r); return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold", z.cls)}>{z.label}</span>; })()}
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs tabular-nums text-muted-foreground">{r.available_count}/7</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Sel <span className="font-medium">N/A</span> = aspek belum punya sumber data live (KSO/GP/Coaching/target customer) atau HoD non-cabang tanpa scope sales — bukan kinerja buruk. NPK dihitung dari aspek yang tersedia saja (bobot tetap SK). Kolom <span className="font-medium">Coverage</span> menunjukkan berapa dari 7 aspek yang terukur.
      </p>
    </div>
  );
}
