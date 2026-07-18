"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DealFormModal, type DealFormInit } from "./deal-form-modal";

// F1-SPT kanban interaktif (tahap B): board 8-stage + filter + ringkasan weighted +
// deal detail + DRAG pindah stage (PATCH /api/deals/:id/stage, write-guard di backend).
// Drop ke Closing-Lost → wajib pilih loss_reason (gate approval HoD, loss_status=pending).

export interface PipelineDeal {
  deal_id: string;
  customer_name: string;
  facility_name: string | null;
  am_id: string | null;
  am_name: string | null;
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
// enum deal_loss_reason (migrasi 057) — wajib saat drag ke Closing-Lost.
const LOSS_REASONS: { val: string; label: string }[] = [
  { val: "harga", label: "Harga" },
  { val: "kompetitor", label: "Kompetitor" },
  { val: "no-budget", label: "Tidak ada budget" },
  { val: "kalah-tender", label: "Kalah tender" },
  { val: "internal-RS", label: "Internal RS/faskes" },
];

const jt = (n: number | null) => {
  const v = n ?? 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${v.toLocaleString("id-ID")}`;
};
const uniq = (arr: (string | null)[]) => [...new Set(arr.filter((x): x is string => !!x))].sort();
// Coop model → bahasa awam: KSO tetap KSO; SALE/Sale → "Beli Putus".
const coopLabel = (c: string | null) => (c == null ? c : /sale/i.test(c) ? "Beli Putus" : c);
const fmtDateTime = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

interface TimelineEntry {
  id: string;
  from_stage: string | null;
  to_stage: string;
  changed_by: string | null;
  reason: string | null;
  occurred_at: string;
}

function Sel({ label, val, set, options }: { label: string; val: string; set: (v: string) => void; options: string[] }) {
  return (
    <select value={val} onChange={(e) => set(e.target.value)}
      className="h-9 rounded-md border border-input bg-muted px-3 text-sm shadow-sm cursor-pointer hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring">
      <option value="">{label}: semua</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function PipelineBoard({ data, isAdmin = false }: { data: PipelineData; isAdmin?: boolean }) {
  const router = useRouter();
  const allDeals = useMemo(() => data.stages.flatMap((s) => s.deals), [data]);
  const [f, setF] = useState({ pcat: "", cabang: "", hod: "", am: "", brand: "", coop: "", year: "", q: "" });
  const [sel, setSel] = useState<PipelineDeal | null>(null);
  const [formModal, setFormModal] = useState<{ mode: "create" } | { mode: "edit"; deal: DealFormInit } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Modal loss_reason saat drop ke Closing-Lost: {deal, from}.
  const [lossModal, setLossModal] = useState<{ deal: PipelineDeal; reason: string; note: string } | null>(null);
  // Modal keterangan WAJIB untuk setiap pemindahan stage non-Lost: {deal, toStage, note}.
  const [moveModal, setMoveModal] = useState<{ deal: PipelineDeal; toStage: string; note: string } | null>(null);
  // Simpan bareng dealId → loading & stale-guard bisa DITURUNKAN (derived), jadi
  // effect gak perlu setState sync (react-hooks/set-state-in-effect). Semua setState
  // setelah await + guard alive.
  const [timeline, setTimeline] = useState<{ dealId: string; entries: TimelineEntry[] } | null>(null);

  useEffect(() => {
    if (!sel) return;
    const dealId = sel.deal_id;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/timeline`, { cache: "no-store" });
        const data = res.ok ? await res.json() : { entries: [] };
        if (alive) setTimeline({ dealId, entries: Array.isArray(data?.entries) ? data.entries : [] });
      } catch {
        if (alive) setTimeline({ dealId, entries: [] });
      }
    })();
    return () => { alive = false; };
  }, [sel]);
  // Timeline utk deal yg sedang dibuka (abaikan data deal lain yg belum ke-refresh).
  const tl = sel && timeline && timeline.dealId === sel.deal_id ? timeline.entries : null;
  const tlLoading = !!sel && tl === null;

  // Kirim transisi stage ke backend, lalu refresh data server-rendered.
  async function patchStage(dealId: string, toStage: string, extra?: { loss_reason?: string; note?: string }) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to_stage: toStage, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: body?.error || `gagal (${res.status})` });
        return false;
      }
      setMsg({ kind: "ok", text: `Dipindah ke ${toStage}${toStage === "Closing-Lost" ? " — menunggu approval HoD" : ""}` });
      router.refresh();
      return true;
    } catch {
      setMsg({ kind: "err", text: "koneksi gagal" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Hapus deal (admin). Konfirmasi via window.confirm; refresh + tutup modal.
  async function deleteDeal(dealId: string) {
    if (!window.confirm("Hapus deal ini permanen (termasuk riwayatnya)? Tindakan ini tidak bisa dibatalkan.")) return;
    setDeleting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: "err", text: body?.error || `gagal (${res.status})` }); return; }
      setMsg({ kind: "ok", text: "Deal dihapus" });
      setSel(null);
      router.refresh();
    } catch {
      setMsg({ kind: "err", text: "koneksi gagal" });
    } finally {
      setDeleting(false);
    }
  }

  // Drop kartu ke kolom stage. Closing-Lost → buka modal loss_reason dulu.
  function onDropStage(toStage: string) {
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    if (!id) return;
    const deal = allDeals.find((d) => d.deal_id === id);
    if (!deal || deal.stage === toStage) return;
    if (toStage === "Closing-Lost") {
      setLossModal({ deal, reason: "", note: "" });
      return;
    }
    // Setiap pemindahan wajib disertai keterangan → tercatat di Riwayat (spt_state_log).
    setMoveModal({ deal, toStage, note: "" });
  }

  const opts = useMemo(() => ({
    pcat: uniq(allDeals.map((d) => d.product_category)),
    cabang: uniq(allDeals.map((d) => d.cabang)),
    hod: uniq(allDeals.map((d) => d.pic_hod)),
    am: uniq(allDeals.map((d) => d.am_name)),
    brand: uniq(allDeals.map((d) => d.brand)),
    coop: uniq(allDeals.map((d) => d.coop_model)),
    year: uniq(allDeals.map((d) => (d.purchase_year ? String(d.purchase_year) : null))),
  }), [allDeals]);

  const filtered = useMemo(() => allDeals.filter((d) =>
    (!f.pcat || d.product_category === f.pcat) &&
    (!f.cabang || d.cabang === f.cabang) &&
    (!f.hod || d.pic_hod === f.hod) &&
    (!f.am || d.am_name === f.am) &&
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
        <Card className="p-3"><div className="text-xs text-muted-foreground">Nilai × Peluang</div><div className="text-xl font-semibold tabular-nums text-primary">{jt(sumW)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Mangkrak &gt;2mg</div><div className="text-xl font-semibold tabular-nums text-rose-600">{staleN}</div></Card>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)]">
        <input placeholder="Cari faskes/produk…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })}
          className="h-9 rounded-md border border-input bg-muted px-3 text-sm min-w-[200px] shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring" />
        <Sel label="Kategori" val={f.pcat} set={(v) => setF({ ...f, pcat: v })} options={opts.pcat} />
        <Sel label="Cabang" val={f.cabang} set={(v) => setF({ ...f, cabang: v })} options={opts.cabang} />
        <Sel label="HOD" val={f.hod} set={(v) => setF({ ...f, hod: v })} options={opts.hod} />
        <Sel label="AM" val={f.am} set={(v) => setF({ ...f, am: v })} options={opts.am} />
        <Sel label="Brand" val={f.brand} set={(v) => setF({ ...f, brand: v })} options={opts.brand} />
        <Sel label="Coop" val={f.coop} set={(v) => setF({ ...f, coop: v })} options={opts.coop} />
        <Sel label="Tahun" val={f.year} set={(v) => setF({ ...f, year: v })} options={opts.year} />
        {(f.pcat || f.cabang || f.hod || f.am || f.brand || f.coop || f.year || f.q) && (
          <button onClick={() => setF({ pcat: "", cabang: "", hod: "", am: "", brand: "", coop: "", year: "", q: "" })}
            className="text-sm text-muted-foreground hover:text-foreground underline">reset</button>
        )}
        <button onClick={() => setFormModal({ mode: "create" })}
          className="ml-auto inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90">
          + Deal Baru
        </button>
      </div>

      {/* Hint + status */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">💡 Seret kartu untuk pindah stage — tiap perpindahan minta <b>keterangan</b>. Drop ke <b>Closing-Lost</b> minta alasan.</span>
        {busy && <span className="text-muted-foreground animate-pulse">menyimpan…</span>}
        {msg && (
          <span className={`px-2 py-0.5 rounded ${msg.kind === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
            {msg.text}
          </span>
        )}
      </div>

      {/* Board kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {STAGES.map((stage) => {
          const deals = byStage.get(stage) ?? [];
          const w = deals.reduce((a, d) => a + d.weighted, 0);
          const isOver = overStage === stage && dragId !== null;
          const isTarget = dragId !== null && !isOver;
          return (
            <div key={stage}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overStage !== stage) setOverStage(stage); } }}
              onDragLeave={(e) => { if (overStage === stage && !e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null); }}
              onDrop={(e) => { e.preventDefault(); onDropStage(stage); }}
              className={`min-w-[240px] max-w-[240px] flex-shrink-0 rounded-lg border border-t-4 bg-card transition-colors ${STAGE_COLOR[stage] ?? "border-t-slate-300"} ${isOver ? "ring-2 ring-primary bg-primary/5" : isTarget ? "border-dashed" : ""}`}>
              <div className="p-2 border-b">
                <div className="font-medium text-sm">{stage}</div>
                <div className="text-xs text-muted-foreground">{deals.length} deal · {jt(w)} weighted</div>
              </div>
              <div className="p-2 space-y-2 max-h-[65vh] overflow-y-auto">
                {deals.length === 0 && <div className="text-xs text-muted-foreground italic py-2">{isTarget ? "drop di sini" : "—"}</div>}
                {deals.map((d) => (
                  <button key={d.deal_id} onClick={() => setSel(d)}
                    draggable={!busy}
                    onDragStart={(e) => { setDragId(d.deal_id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragId(null); setOverStage(null); }}
                    className={`w-full text-left rounded-md border bg-background p-2 hover:border-primary transition-colors cursor-grab active:cursor-grabbing ${dragId === d.deal_id ? "opacity-40" : ""}`}>
                    <div className="flex items-start justify-between gap-1">
                      <div className="text-sm font-medium leading-tight line-clamp-2">{d.facility_name || d.customer_name}</div>
                      {d.stale && <span title="Mangkrak >2 minggu" className="text-rose-500 text-xs shrink-0">●</span>}
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
              {sel.stale && <Badge variant="destructive">Mangkrak {sel.days_in_stage}h</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-4 text-sm">
              {([
                ["Brand", sel.brand], ["Produk", sel.product], ["Kerja Sama", coopLabel(sel.coop_model)],
                ["Perkiraan Nilai", jt(sel.estimate_amount)], ["Nilai × Peluang", jt(sel.weighted)],
                ["Peluang", sel.probability != null ? `${Math.round(sel.probability * 100)}%` : "—"],
                ["Cabang", sel.cabang], ["HOD", sel.pic_hod], ["AM", sel.am_name ?? sel.am_id],
                ["Kota", sel.city], ["Provinsi", sel.province], ["Tahun beli", sel.purchase_year],
                ["Hari di tahap ini", sel.days_in_stage],
              ] as [string, string | number | null][]).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="tabular-nums">{v ?? "—"}</dd></div>
              ))}
            </dl>
            {sel.notes && <div className="mt-4"><div className="text-xs text-muted-foreground">Catatan</div><div className="text-sm whitespace-pre-wrap mt-1">{sel.notes}</div></div>}

            {/* Riwayat perpindahan stage + approval (spt_state_log) */}
            <div className="mt-4 border-t pt-3">
              <div className="text-xs text-muted-foreground mb-2">Riwayat</div>
              {tlLoading && <div className="text-sm text-muted-foreground italic">memuat…</div>}
              {!tlLoading && tl && tl.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Belum ada perpindahan tercatat.</div>
              )}
              {!tlLoading && tl && tl.length > 0 && (
                <ol className="space-y-2">
                  {tl.map((t) => {
                    const moved = t.from_stage && t.from_stage !== t.to_stage;
                    return (
                      <li key={t.id} className="text-sm flex gap-2">
                        <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {moved ? (
                              <span className="font-medium">{t.from_stage} → {t.to_stage}</span>
                            ) : (
                              <span className="font-medium">{t.to_stage}</span>
                            )}
                            <span className="text-xs text-muted-foreground">{fmtDateTime(t.occurred_at)}</span>
                          </div>
                          {t.reason && <div className="text-xs text-muted-foreground mt-0.5 break-words">{t.reason}</div>}
                          {t.changed_by && <div className="text-[11px] text-muted-foreground/70 mt-0.5">oleh {t.changed_by}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">Seret kartu di board untuk pindah stage (isi keterangan tiap perpindahan).</span>
              <button onClick={() => { const d = sel; setSel(null); setFormModal({ mode: "edit", deal: d as DealFormInit }); }}
                className="ml-auto text-sm px-3 py-1 rounded-md border hover:bg-muted">Edit</button>
              {isAdmin && (
                <button disabled={deleting} onClick={() => deleteDeal(sel.deal_id)}
                  className="text-sm px-3 py-1 rounded-md border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                  {deleting ? "menghapus…" : "Hapus"}
                </button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Modal loss_reason (drop ke Closing-Lost) */}
      {lossModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setLossModal(null)}>
          <Card className="max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Tandai Closing-Lost</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              {lossModal.deal.facility_name || lossModal.deal.customer_name} → <b>Closing-Lost</b>. Pilih alasan (wajib, menunggu approval HoD).
            </p>
            <div className="mt-3 space-y-2">
              {LOSS_REASONS.map((r) => (
                <label key={r.val} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="loss-reason" value={r.val}
                    checked={lossModal.reason === r.val}
                    onChange={() => setLossModal({ ...lossModal, reason: r.val })} />
                  {r.label}
                </label>
              ))}
            </div>
            <textarea placeholder="Catatan (opsional)…" value={lossModal.note}
              onChange={(e) => setLossModal({ ...lossModal, note: e.target.value })}
              className="mt-3 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" rows={2} />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setLossModal(null)}
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted">Batal</button>
              <button disabled={!lossModal.reason || busy}
                onClick={async () => {
                  const ok = await patchStage(lossModal.deal.deal_id, "Closing-Lost", {
                    loss_reason: lossModal.reason, note: lossModal.note || undefined,
                  });
                  if (ok) setLossModal(null);
                }}
                className="text-sm px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                Tandai Lost
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal keterangan wajib tiap pemindahan stage (non-Lost) → tercatat di Riwayat */}
      {moveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMoveModal(null)}>
          <Card className="max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Pindah stage</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">
              {moveModal.deal.facility_name || moveModal.deal.customer_name}: <b>{moveModal.deal.stage}</b> → <b>{moveModal.toStage}</b>. Isi keterangan (wajib) — tercatat di Riwayat.
            </p>
            <textarea placeholder="Keterangan perpindahan… (mis. hasil follow-up / alasan pindah)" value={moveModal.note}
              onChange={(e) => setMoveModal({ ...moveModal, note: e.target.value })}
              autoFocus rows={3}
              className="mt-3 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setMoveModal(null)}
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted">Batal</button>
              <button disabled={!moveModal.note.trim() || busy}
                onClick={async () => {
                  const ok = await patchStage(moveModal.deal.deal_id, moveModal.toStage, { note: moveModal.note.trim() });
                  if (ok) setMoveModal(null);
                }}
                className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Pindah
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Form deal (create / edit) */}
      {formModal && (
        <DealFormModal
          mode={formModal.mode}
          deal={formModal.mode === "edit" ? formModal.deal : undefined}
          onClose={() => setFormModal(null)}
        />
      )}
    </div>
  );
}
