"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SkeletonCardGrid } from "@/components/ui/loading";

interface Suggestion {
  id: string;
  itemName: string;
  warehouseNama: string;
  reasons: string[];
  currentQty: number;
  bufferQty: number | null;
  nearestEdDate: string | null;
  avgMonthlyQty6m: number | null;
  pipelineHotCount: number;
  suggestedQty: number;
  finalQty: number | null;
  notes: string | null;
  status: string;
  approvalRequestId: string | null;
  approvalStatus: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  createdAt: string;
}

interface VendorOpt {
  id: string;
  name: string | null;
}

const REASON_LABEL: Record<string, string> = {
  near_buffer: "⚠️ Mendekati/di bawah buffer",
  near_ed: "⏳ Ada batch mendekati ED",
};
const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  submitted: "default",
  dismissed: "outline",
  ordered: "default",
};
const STATUSES = ["draft", "submitted", "ordered", "dismissed"] as const;
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function ForecastSubmissionPage() {
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>("draft");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { finalQty: string; notes: string }>>({});
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [poForm, setPoForm] = useState<
    Record<string, { vendorId: string; lini: "" | "IVD" | "Medical"; poNumber: string }>
  >({});

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/forecast/suggestions?status=${status}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat data");
      const rows: Suggestion[] = data.suggestions ?? [];
      setSuggestions(rows);
      setDrafts(Object.fromEntries(rows.map((s) => [s.id, { finalQty: String(s.finalQty ?? s.suggestedQty), notes: s.notes ?? "" }])));
      setPoForm((prev) => ({
        ...Object.fromEntries(rows.map((s) => [s.id, prev[s.id] ?? { vendorId: "", lini: "" as const, poNumber: `PR-${s.id.slice(0, 8)}` }])),
      }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch("/api/vendors", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVendors(d?.rows ?? []))
      .catch(() => {});
  }, []);

  // Inline IIFE (bukan `void load()` langsung) — hindari lint react-hooks set-state-in-effect.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/forecast/suggestions?status=draft", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat data");
        const rows: Suggestion[] = data.suggestions ?? [];
        setSuggestions(rows);
        setDrafts(Object.fromEntries(rows.map((s) => [s.id, { finalQty: String(s.finalQty ?? s.suggestedQty), notes: s.notes ?? "" }])));
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/forecast/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal generate");
      await load(filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function saveEdit(id: string) {
    setBusy(id);
    try {
      const d = drafts[id];
      const res = await fetch(`/api/forecast/suggestions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ finalQty: d.finalQty ? Number(d.finalQty) : null, notes: d.notes || null }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan");
      await load(filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/forecast/suggestions/${id}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewedBy: "web-ui" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal dismiss");
      await load(filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit(id: string) {
    setBusy(id);
    try {
      await saveEdit(id); // pastikan final_qty tersimpan dulu sebelum ajukan
      const res = await fetch(`/api/forecast/suggestions/${id}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submittedBy: "web-ui" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal mengajukan");
      await load(filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function draftPo(id: string) {
    const f = poForm[id];
    if (!f?.vendorId) {
      setError("pilih vendor dulu");
      return;
    }
    if (!f.lini) {
      setError("pilih lini bisnis dulu");
      return;
    }
    if (!f.poNumber.trim()) {
      setError("nomor PO wajib diisi");
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/forecast/suggestions/${id}/draft-po`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorId: f.vendorId, lini: f.lini, poNumber: f.poNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal draft PO");
      await load(filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Forecast Submission</h1>
          <p className="text-muted-foreground">
            F19 — usulan otomatis dari stok gudang (vs buffer & ED) + konteks pipeline HOT. Review/edit di sini,
            lalu ajukan ke approval berjenjang.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={filter === s ? "default" : "outline"}
              onClick={() => {
                setFilter(s);
                void load(s);
              }}
            >
              {s}
            </Button>
          ))}
          <Button size="sm" variant="soft" render={<Link href="/forecast-submission/config" />} nativeButton={false}>
            Setup Buffer
          </Button>
          <Button size="sm" onClick={() => void generate()} disabled={generating}>
            {generating ? "Men-generate…" : "Generate Usulan"}
          </Button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <SkeletonCardGrid count={4} />
      ) : suggestions.length === 0 ? (
        <p className="text-muted-foreground">Tidak ada usulan status &quot;{filter}&quot;.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {suggestions.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {s.itemName} — {s.warehouseNama}
                  </CardTitle>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.reasons.map((r) => (
                      <span key={r} className="text-muted-foreground text-xs">
                        {REASON_LABEL[r] ?? r}
                      </span>
                    ))}
                  </div>
                </div>
                <Badge variant={STATUS_BADGE[s.status] ?? "secondary"}>{s.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="text-muted-foreground grid grid-cols-2 gap-1 text-xs">
                  <div>Stok saat ini: {s.currentQty}</div>
                  <div>Buffer: {s.bufferQty ?? "-"}</div>
                  <div>ED terdekat: {s.nearestEdDate ? new Date(s.nearestEdDate).toLocaleDateString("id-ID") : "-"}</div>
                  <div>Rata² terjual/bln (6bln): {s.avgMonthlyQty6m ?? "-"}</div>
                  <div className="col-span-2">
                    Deal HOT aktif (konteks): {s.pipelineHotCount} · Usulan sistem: {s.suggestedQty}
                  </div>
                </div>

                {s.status === "draft" ? (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="w-28">
                        <Label className="mb-1 block text-xs">Qty Final</Label>
                        <Input
                          type="number"
                          min={0}
                          value={drafts[s.id]?.finalQty ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], finalQty: e.target.value } }))}
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="mb-1 block text-xs">Catatan Supply Chain</Label>
                        <Input
                          value={drafts[s.id]?.notes ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], notes: e.target.value } }))}
                          placeholder="opsional"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => void saveEdit(s.id)}>
                        Simpan
                      </Button>
                      <Button size="sm" className="flex-1" disabled={busy === s.id} onClick={() => void submit(s.id)}>
                        Ajukan ke Approval
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy === s.id} onClick={() => void dismiss(s.id)}>
                        Abaikan
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs">
                      Qty final: {s.finalQty ?? s.suggestedQty}
                      {s.notes ? ` · ${s.notes}` : ""}
                      {s.approvalRequestId && (
                        <>
                          {" "}
                          ·{" "}
                          <Link href={`/approval-requests/${s.approvalRequestId}`} className="text-primary underline">
                            Lihat status approval
                          </Link>
                        </>
                      )}
                    </div>

                    {s.status === "ordered" && s.purchaseOrderId && (
                      <div className="text-muted-foreground text-xs">
                        {/* Tidak ada route detail per-ID di PO Tracker (dialog di tabel list,
                            lihat purchase-order-table.tsx) — jadi arahkan ke tabel dgn
                            filter ?q= nomor PO, bukan link langsung ke ID yang 404. */}
                        ✅ Sudah didraft jadi PO {s.purchaseOrderNumber ?? ""} —{" "}
                        <Link
                          href={`/purchase-orders?q=${encodeURIComponent(s.purchaseOrderNumber ?? "")}`}
                          className="text-primary underline"
                        >
                          Lihat di PO Tracker
                        </Link>
                      </div>
                    )}

                    {s.status === "submitted" && s.approvalStatus === "approved" && !s.purchaseOrderId && (
                      <div className="space-y-2 border-t pt-2">
                        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                          Draft PO (F153) — vendor & lini dipilih manual
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="grid gap-1">
                            <Label className="text-xs">Vendor</Label>
                            <select
                              className={selectCls}
                              value={poForm[s.id]?.vendorId ?? ""}
                              onChange={(e) =>
                                setPoForm((prev) => ({ ...prev, [s.id]: { ...prev[s.id], vendorId: e.target.value } }))
                              }
                            >
                              <option value="">Pilih vendor…</option>
                              {vendors.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.name ?? `Vendor #${v.id}`}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs">Lini</Label>
                            <select
                              className={selectCls}
                              value={poForm[s.id]?.lini ?? ""}
                              onChange={(e) =>
                                setPoForm((prev) => ({
                                  ...prev,
                                  [s.id]: { ...prev[s.id], lini: e.target.value as "" | "IVD" | "Medical" },
                                }))
                              }
                            >
                              <option value="">Pilih lini…</option>
                              <option value="IVD">IVD</option>
                              <option value="Medical">Medical</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs">No. PO</Label>
                          <Input
                            value={poForm[s.id]?.poNumber ?? ""}
                            onChange={(e) =>
                              setPoForm((prev) => ({ ...prev, [s.id]: { ...prev[s.id], poNumber: e.target.value } }))
                            }
                          />
                        </div>
                        <Button size="sm" className="w-full" disabled={busy === s.id} onClick={() => void draftPo(s.id)}>
                          {busy === s.id ? "Men-draft…" : "Draft PO Sekarang"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
