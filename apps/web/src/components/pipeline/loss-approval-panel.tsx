"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// F1-SPT panel approval Lost: HoD/admin memutus deal yg di-drag ke Closing-Lost
// (loss_status='pending'). Approve → tetap Lost. Reject → deal balik ke stage
// sebelum Lost. Self-fetch /api/deals/loss-approvals; sembunyi bila kosong.

interface LossPending {
  deal_id: string;
  customer_name: string;
  facility_name: string | null;
  am_id: string | null;
  brand: string | null;
  product: string | null;
  cabang: string | null;
  estimate_amount: number | null;
  loss_reason: string | null;
  requested_at: string;
  requested_by: string | null;
  requested_note: string | null;
  revert_stage: string;
}

const jt = (n: number | null) => {
  const v = n ?? 0;
  if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} jt`;
  return `Rp ${v.toLocaleString("id-ID")}`;
};
const fmtDate = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

export function LossApprovalPanel() {
  const router = useRouter();
  const [items, setItems] = useState<LossPending[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // deal_id yg lagi diproses
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Fetch antrean sekali saat mount. setState hanya setelah await (async boundary)
  // + guard `alive` → aman dari react-hooks/set-state-in-effect.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/deals/loss-approvals", { cache: "no-store" });
        const data = res.ok ? await res.json() : { pending: [] };
        if (alive) setItems(Array.isArray(data?.pending) ? data.pending : []);
      } catch {
        if (alive) setItems([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function decide(dealId: string, decision: "approved" | "rejected", note?: string) {
    setBusy(dealId);
    setMsg(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(dealId)}/loss-approval`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: "err", text: body?.error || `gagal (${res.status})` }); return; }
      setItems((prev) => (prev ?? []).filter((x) => x.deal_id !== dealId));
      setRejecting(null);
      setMsg({
        kind: "ok",
        text: decision === "approved" ? "Loss disetujui" : `Ditolak — deal balik ke ${body?.stage ?? "stage sebelumnya"}`,
      });
      router.refresh(); // board ikut ter-update (reject memindah deal balik)
    } catch {
      setMsg({ kind: "err", text: "koneksi gagal" });
    } finally {
      setBusy(null);
    }
  }

  // Sembunyi total kalau belum load / tak ada pending (mis. AM, atau HoD tanpa antrean).
  if (!items || items.length === 0) return null;

  return (
    <Card className="border-rose-200 bg-rose-50/40">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-3 text-left">
        <span className="font-medium text-sm flex items-center gap-2">
          <span className="text-rose-600">⚠️ Persetujuan Lost</span>
          <Badge variant="destructive">{items.length}</Badge>
          <span className="text-muted-foreground font-normal">menunggu keputusan Anda</span>
        </span>
        <span className="text-muted-foreground text-sm">{open ? "▲ tutup" : "▼ buka"}</span>
      </button>

      {msg && (
        <div className={`mx-3 mb-2 text-xs px-2 py-1 rounded ${msg.kind === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
          {msg.text}
        </div>
      )}

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {items.map((d) => (
            <div key={d.deal_id} className="rounded-md border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm leading-tight">{d.facility_name || d.customer_name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {[d.brand, d.product].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <span className="text-sm tabular-nums shrink-0">{jt(d.estimate_amount)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
                {d.loss_reason && <Badge variant="outline" className="border-rose-300 text-rose-700">alasan: {d.loss_reason}</Badge>}
                {d.cabang && <span className="text-muted-foreground">{d.cabang}</span>}
                {d.am_id && <span className="text-muted-foreground">· AM {d.am_id}</span>}
                <span className="text-muted-foreground">· diajukan {fmtDate(d.requested_at)}</span>
                <span className="text-muted-foreground">· tolak → balik ke <b>{d.revert_stage}</b></span>
              </div>

              {rejecting?.id === d.deal_id ? (
                <div className="mt-3 space-y-2">
                  <textarea placeholder="Alasan menolak (opsional)…" value={rejecting.note}
                    onChange={(e) => setRejecting({ id: d.deal_id, note: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm" rows={2} />
                  <div className="flex justify-end gap-2">
                    <button disabled={busy === d.deal_id} onClick={() => setRejecting(null)}
                      className="text-sm px-3 py-1 rounded-md border hover:bg-muted">Batal</button>
                    <button disabled={busy === d.deal_id}
                      onClick={() => decide(d.deal_id, "rejected", rejecting.note || undefined)}
                      className="text-sm px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                      Konfirmasi tolak → balik {d.revert_stage}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2 mt-3">
                  <button disabled={busy === d.deal_id}
                    onClick={() => setRejecting({ id: d.deal_id, note: "" })}
                    className="text-sm px-3 py-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                    Tolak
                  </button>
                  <button disabled={busy === d.deal_id}
                    onClick={() => decide(d.deal_id, "approved")}
                    className="text-sm px-3 py-1 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                    Setujui Lost
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
