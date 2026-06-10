"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Draft {
  id: string;
  customer_id: string;
  invoice_no: string | null;
  draft_text: string;
  draft_type: string | null;
  status: string;
  generated_by: string | null;
  approved_by: string | null;
  created_at: string;
}

const STATUSES = ["all", "draft", "approved", "sent", "canceled"] as const;
type StatusFilter = (typeof STATUSES)[number];

const STATUS_BADGE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  approved: "default",
  sent: "outline",
  canceled: "destructive",
};

export default function CollectionDraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toInputs, setToInputs] = useState<Record<string, string>>({});

  const url = useCallback(
    (f: StatusFilter) =>
      f === "all" ? "/api/ar/collection-drafts" : `/api/ar/collection-drafts?status=${f}`,
    [],
  );

  const load = useCallback(
    async (f: StatusFilter) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url(f), { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "gagal memuat draft");
        setDrafts(data.drafts ?? []);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [url],
  );

  // Initial fetch — inline async (setState hanya setelah await).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/ar/collection-drafts", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat draft");
        setDrafts(data.drafts ?? []);
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

  async function act(id: string, action: "approve" | "send" | "cancel") {
    setBusy(id);
    setError(null);
    try {
      const body: Record<string, string> = { approver_id: "web-ui" };
      if (action === "send") {
        const to = (toInputs[id] ?? "").trim();
        if (!to) throw new Error("isi tujuan WA (nomor/jid) dulu");
        body.to = to;
      }
      const res = await fetch(`/api/ar/collection-drafts/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? `gagal ${action}`);
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
          <h1 className="text-2xl font-semibold">Collection Drafts</h1>
          <p className="text-muted-foreground">
            Draft penagihan A3 (Sari) — review, approve, lalu kirim via gateway WA.
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
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
              {s === "all" ? "Semua" : s}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : drafts.length === 0 ? (
        <p className="text-muted-foreground">Tidak ada draft. 🎉</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {drafts.map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">{d.customer_id}</CardTitle>
                  <p className="text-muted-foreground text-xs">
                    {d.invoice_no ?? "—"} · {d.draft_type ?? "whatsapp"}
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[d.status] ?? "secondary"}>{d.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="bg-muted/50 max-h-40 overflow-auto rounded-md p-3 text-sm whitespace-pre-wrap">
                  {d.draft_text}
                </p>
                {d.status === "draft" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy === d.id}
                      onClick={() => void act(d.id, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === d.id}
                      onClick={() => void act(d.id, "cancel")}
                    >
                      Batalkan
                    </Button>
                  </div>
                )}
                {d.status === "approved" && (
                  <div className="space-y-2">
                    <Input
                      placeholder="Tujuan WA (mis. 628xxx@c.us)"
                      value={toInputs[d.id] ?? ""}
                      onChange={(e) =>
                        setToInputs((prev) => ({ ...prev, [d.id]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busy === d.id}
                        onClick={() => void act(d.id, "send")}
                      >
                        Kirim
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === d.id}
                        onClick={() => void act(d.id, "cancel")}
                      >
                        Batalkan
                      </Button>
                    </div>
                  </div>
                )}
                {(d.status === "sent" || d.status === "canceled") && (
                  <p className="text-muted-foreground text-xs">
                    {d.status === "sent" ? "Terkirim" : "Dibatalkan"}
                    {d.approved_by ? ` · oleh ${d.approved_by}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
