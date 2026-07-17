"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// F1-SPT kanban read-only: board 8-stage + filter + ringkasan weighted + deal detail.
// Interaktivitas (drag/CRUD/timeline/approval) = tahap B (butuh endpoint write PR3).

export interface PipelineDeal {
  deal_id: string;
  customer_name: string;
  facility_name: string | null;
  am_id: string | null;
  brand: string | null;
  product: string | null;
  product_category: string | null;
  prospect_category: string | null;
  stage: string;
  probability: number | null;
  forecast_category: string | null;
  estimate_amount: number | null;
  weighted: number;
  pic_hod: string | null;
  cabang: string | null;
  coop_model: string | null;
  city: string | null;
  province: string | null;
  purchase_year: number | null;
  days_in_stage: number | null;
  stale: boolean;
  notes: string | null;
  updated_at: string;
}
export interface PipelineStage {
  stage: string;
  count: number;
  total_value: number;
  weighted_value: number;
  deals: PipelineDeal[];
}
export interface PipelineData {
  stages: PipelineStage[];
  summary: {
    total_deals: number;
    total_value: number;
    weighted_value: number;
    stale_count: number;
    by_forecast: { forecast: string; count: number; value: number }[];
  };
}

const STAGES = [
  "Prospecting", "First Contact", "Presentation", "Quotation",
  "Offering", "Negotiation", "Closing-Won", "Closing-Lost",
];
const STAGE_COLOR: Record<string, string> = {
  Prospecting: "border-t-slate-400", "First Contact": "border-t-sky-400",
  Presentation: "border-t-indigo-400", Quotation: "border-t-violet-400",
  Offering: "border-t-amber-400", Negotiation: "border-t-orange-500",
  "Closing-Won": "border-t-emerald-500", "Closing-Lost": "border-t-rose-500",
};
const PCAT_COLOR: Record<string, string> = { Cold: "bg-sky-100 text-sky-700", Warm: "bg-amber-100 text-amber-700", Hot: "bg-rose-100 text-rose-700" };

const jt = (n: number | null) => {
  const v = n ?? 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${v.toLocaleString("id-ID")}`;
};
const uniq = (arr: (string | null)[]) => [...new Set(arr.filter((x): x is string => !!x))].sort();

function Sel({ label, val, set, options }: { label: string; val: string; set: (v: string) => void; options: string[] }) {
  return (
    <select value={val} onChange={(e) => set(e.target.value)}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm">
      <option value="">{label}: semua</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function PipelineBoard({ data }: { data: PipelineData }) {
  const allDeals = useMemo(() => data.stages.flatMap((s) => s.deals), [data]);
  const [f, setF] = useState({ pcat: "", cabang: "", hod: "", brand: "", coop: "", year: "", q: "" });
  const [sel, setSel] = useState<PipelineDeal | null>(null);

  const opts = useMemo(() => ({
    pcat: uniq(allDeals.map((d) => d.product_category)),
    cabang: uniq(allDeals.map((d) => d.cabang)),
    hod: uniq(allDeals.map((d) => d.pic_hod)),
    brand: uniq(allDeals.map((d) => d.brand)),
    coop: uniq(allDeals.map((d) => d.coop_model)),
    year: uniq(allDeals.map((d) => (d.purchase_year ? String(d.purchase_year) : null))),
  }), [allDeals]);

  const filtered = useMemo(() => allDeals.filter((d) =>
    (!f.pcat || d.product_category === f.pcat) &&
    (!f.cabang || d.cabang === f.cabang) &&
    (!f.hod || d.pic_hod === f.hod) &&
    (!f.brand || d.brand === f.brand) &&
    (!f.coop || d.coop_model === f.coop) &&
    (!f.year || String(d.purchase_year) === f.year) &&
    (!f.q || `${d.facility_name ?? ""} ${d.customer_name} ${d.product ?? ""}`.toLowerCase().includes(f.q.toLowerCase()))
  ), [allDeals, f]);

  const byStage = useMemo(() => {
    const m = new Map<string, PipelineDeal[]>();
    for (const s of STAGES) m.set(s, []);
    for (const d of filtered) (m.get(d.stage) ?? m.set(d.stage, []).get(d.stage)!).push(d);
    return m;
  }, [filtered]);

  const sumVal = filtered.reduce((a, d) => a + (d.estimate_amount ?? 0), 0);
  const sumW = filtered.reduce((a, d) => a + d.weighted, 0);
  const staleN = filtered.filter((d) => d.stale).length;

  return (
    <div className="space-y-4">
      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Deal</div><div className="text-xl font-semibold tabular-nums">{filtered.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Nilai</div><div className="text-xl font-semibold tabular-nums">{jt(sumVal)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Weighted (est×prob)</div><div className="text-xl font-semibold tabular-nums text-primary">{jt(sumW)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Stale &gt;2mg</div><div className="text-xl font-semibold tabular-nums text-rose-600">{staleN}</div></Card>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        <input placeholder="Cari faskes/produk…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })}
          className="rounded-md border border-input bg-background px-3 py-1 text-sm min-w-[180px]" />
        <Sel label="Kategori" val={f.pcat} set={(v) => setF({ ...f, pcat: v })} options={opts.pcat} />
        <Sel label="Cabang" val={f.cabang} set={(v) => setF({ ...f, cabang: v })} options={opts.cabang} />
        <Sel label="HOD" val={f.hod} set={(v) => setF({ ...f, hod: v })} options={opts.hod} />
        <Sel label="Brand" val={f.brand} set={(v) => setF({ ...f, brand: v })} options={opts.brand} />
        <Sel label="Coop" val={f.coop} set={(v) => setF({ ...f, coop: v })} options={opts.coop} />
        <Sel label="Tahun" val={f.year} set={(v) => setF({ ...f, year: v })} options={opts.year} />
        {(f.pcat || f.cabang || f.hod || f.brand || f.coop || f.year || f.q) && (
          <button onClick={() => setF({ pcat: "", cabang: "", hod: "", brand: "", coop: "", year: "", q: "" })}
            className="text-sm text-muted-foreground hover:text-foreground underline">reset</button>
        )}
      </div>

      {/* Board kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STAGES.map((stage) => {
          const deals = byStage.get(stage) ?? [];
          const w = deals.reduce((a, d) => a + d.weighted, 0);
          return (
            <div key={stage} className={`min-w-[240px] max-w-[240px] flex-shrink-0 rounded-lg border border-t-4 bg-muted/30 ${STAGE_COLOR[stage] ?? "border-t-slate-300"}`}>
              <div className="p-2 border-b">
                <div className="font-medium text-sm">{stage}</div>
                <div className="text-xs text-muted-foreground">{deals.length} deal · {jt(w)} weighted</div>
              </div>
              <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
                {deals.length === 0 && <div className="text-xs text-muted-foreground italic py-2">—</div>}
                {deals.map((d) => (
                  <button key={d.deal_id} onClick={() => setSel(d)}
                    className="w-full text-left rounded-md border bg-background p-2 hover:border-primary transition-colors">
                    <div className="flex items-start justify-between gap-1">
                      <div className="text-sm font-medium leading-tight line-clamp-2">{d.facility_name || d.customer_name}</div>
                      {d.stale && <span title="Stale >2mg" className="text-rose-500 text-xs shrink-0">●</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{[d.brand, d.product].filter(Boolean).join(" · ") || "—"}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs tabular-nums">{jt(d.estimate_amount)}</span>
                      {d.prospect_category && <span className={`text-[10px] px-1.5 py-0.5 rounded ${PCAT_COLOR[d.prospect_category] ?? "bg-muted"}`}>{d.prospect_category}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Deal detail modal (read-only) */}
      {sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSel(null)}>
          <Card className="max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold leading-tight">{sel.facility_name || sel.customer_name}</h2>
              <button onClick={() => setSel(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge>{sel.stage}</Badge>
              {sel.product_category && <Badge variant="secondary">{sel.product_category}</Badge>}
              {sel.prospect_category && <Badge variant="outline">{sel.prospect_category}</Badge>}
              {sel.forecast_category && <Badge variant="outline">{sel.forecast_category}</Badge>}
              {sel.stale && <Badge variant="destructive">Stale {sel.days_in_stage}h</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 text-sm">
              {([
                ["Brand", sel.brand], ["Produk", sel.product], ["Coop", sel.coop_model],
                ["Estimate", jt(sel.estimate_amount)], ["Weighted", jt(sel.weighted)],
                ["Probabilitas", sel.probability != null ? `${Math.round(sel.probability * 100)}%` : "—"],
                ["Cabang", sel.cabang], ["PIC HOD", sel.pic_hod], ["AM (am_id)", sel.am_id],
                ["Kota", sel.city], ["Provinsi", sel.province], ["Tahun beli", sel.purchase_year],
                ["Hari di stage", sel.days_in_stage],
              ] as [string, string | number | null][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular-nums">{v ?? "—"}</dd></div>
              ))}
            </dl>
            {sel.notes && <div className="mt-4"><div className="text-xs text-muted-foreground">Catatan</div><div className="text-sm whitespace-pre-wrap mt-1">{sel.notes}</div></div>}
            <div className="mt-4 text-xs text-muted-foreground border-t pt-2">Read-only. Edit/pindah stage/timeline menyusul (tahap B).</div>
          </Card>
        </div>
      )}
    </div>
  );
}
