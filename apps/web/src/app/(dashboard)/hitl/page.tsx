"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Candidate {
  deal_id: string;
  customer_name: string;
  score: number;
}
interface ReportPayload {
  type?: "report_ambiguous_match";
  am_id: string;
  item: { customer: string; hasil: string; next_action: string };
  candidates: Candidate[];
  to_stage: string | null;
}
interface AuthenticityPayload {
  type: "pipeline_authenticity_flag";
  deal_id: string;
  customer_name: string | null;
  am_id: string;
  stage: string;
  estimated_value: number | null;
  flags: string[];
  score: number;
}
interface AnomalyPayload {
  type: "anomaly_flag";
  stream: string;
  entity_id: string;
  label: string | null;
  value: number;
  score: number;
  direction: string;
  median: number;
}
interface DupCandidate {
  kind: "deal" | "accurate_customer";
  ref_id: string;
  customer_name: string;
  am_id: string | null;
  cabang: string | null;
  score: number;
  exact: boolean;
}
interface DuplicateNamePayload {
  type: "duplicate_customer_name_flag";
  deal_id: string;
  customer_name: string;
  am_id: string | null;
  cabang: string | null;
  candidates: DupCandidate[];
}
type HitlPayload = ReportPayload | AuthenticityPayload | AnomalyPayload | DuplicateNamePayload;
interface HitlItem {
  id: string;
  r_tier: string;
  hitl_level: string;
  agent_id: string | null;
  payload: HitlPayload;
  created_at: string;
}

export default function HitlPage() {
  const [items, setItems] = useState<HitlItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hitl?status=pending", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat antrian");
      setItems(data.items ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch — inline async (setState hanya setelah await, hindari
  // set-state-in-effect). `load` dipakai tombol Refresh & setelah resolve.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/hitl?status=pending", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat antrian");
        setItems(data.items ?? []);
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

  async function resolve(
    id: string,
    decision: "approve" | "reject",
    chosenDealId?: string,
  ) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/hitl/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          decision,
          chosen_deal_id: chosenDealId,
          approver_id: "web-ui",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal resolve");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">HITL Review</h1>
          <p className="text-muted-foreground">
            Konfirmasi match #REPORT ambiguous (gate D6) — pilih deal yang benar atau tolak.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {loading ? (
        <p className="text-muted-foreground">Memuat…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">Tidak ada item pending. 🎉</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((it) =>
            it.payload.type === "anomaly_flag" ? (
              <Card key={it.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">
                    Anomali: {it.payload.label ?? it.payload.entity_id}
                  </CardTitle>
                  <div className="flex gap-1">
                    {it.agent_id && <Badge variant="outline">{it.agent_id}</Badge>}
                    <Badge variant="outline">{it.r_tier}</Badge>
                    <Badge variant="outline">{it.hitl_level}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm">
                    <p>
                      <span className="text-muted-foreground">Stream:</span>{" "}
                      <Badge variant="secondary">{it.payload.stream}</Badge>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Nilai:</span>{" "}
                      {it.payload.value.toLocaleString("id-ID")}{" "}
                      <Badge variant="destructive">
                        {it.payload.direction === "high" ? "↑" : "↓"} z={it.payload.score}
                      </Badge>
                    </p>
                    <p className="text-muted-foreground text-xs">
                      median {it.payload.median.toLocaleString("id-ID")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "approve")}
                    >
                      Akui & tindak lanjut
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "reject")}
                    >
                      False positive
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : it.payload.type === "pipeline_authenticity_flag" ? (
              <Card key={it.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">
                    Pipeline flag: {it.payload.customer_name ?? it.payload.deal_id}
                  </CardTitle>
                  <div className="flex gap-1">
                    {it.agent_id && <Badge variant="outline">{it.agent_id}</Badge>}
                    <Badge variant="outline">{it.r_tier}</Badge>
                    <Badge variant="outline">{it.hitl_level}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm">
                    <p>
                      <span className="text-muted-foreground">AM:</span> {it.payload.am_id}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Stage:</span>{" "}
                      <Badge variant="secondary">{it.payload.stage}</Badge>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {it.payload.flags.map((f) => (
                        <Badge key={f} variant="destructive">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "approve")}
                    >
                      Akui & tindak lanjut
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "reject")}
                    >
                      False positive
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : it.payload.type === "duplicate_customer_name_flag" ? (
              <Card key={it.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">
                    Nama mirip: {it.payload.customer_name}
                  </CardTitle>
                  <div className="flex gap-1">
                    <Badge variant="outline">{it.r_tier}</Badge>
                    <Badge variant="outline">{it.hitl_level}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    AM: {it.payload.am_id ?? "—"} {it.payload.cabang ? `· ${it.payload.cabang}` : ""}
                  </p>
                  <div className="space-y-1">
                    {it.payload.candidates.map((c) => (
                      <p key={c.ref_id} className="text-sm flex items-center justify-between gap-2">
                        <span className="truncate">
                          {c.customer_name}{" "}
                          {c.kind === "accurate_customer" && <Badge variant="outline">Accurate</Badge>}
                          {c.am_id && <span className="text-muted-foreground"> ({c.am_id})</span>}
                        </span>
                        <Badge variant={c.exact ? "destructive" : "secondary"}>
                          {c.exact ? "IDENTIK" : `${(c.score * 100).toFixed(0)}%`}
                        </Badge>
                      </p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "approve")}
                    >
                      Sudah dicek / bukan duplikat
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "reject")}
                    >
                      Tolak
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card key={it.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">
                    Report: {it.payload.item.customer}
                  </CardTitle>
                  <div className="flex gap-1">
                    <Badge variant="outline">{it.r_tier}</Badge>
                    <Badge variant="outline">{it.hitl_level}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm">
                    <p>
                      <span className="text-muted-foreground">Hasil:</span>{" "}
                      {it.payload.item.hasil}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Next:</span>{" "}
                      {it.payload.item.next_action || "—"}
                    </p>
                    {it.payload.to_stage && (
                      <p>
                        <span className="text-muted-foreground">Akan transisi ke:</span>{" "}
                        <Badge variant="secondary">{it.payload.to_stage}</Badge>
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs">Pilih deal yang cocok:</p>
                    {it.payload.candidates.map((c) => (
                      <Button
                        key={c.deal_id}
                        size="sm"
                        className="w-full justify-between"
                        disabled={busy === it.id}
                        onClick={() => void resolve(it.id, "approve", c.deal_id)}
                      >
                        <span className="truncate">{c.customer_name}</span>
                        <span className="opacity-70">{(c.score * 100).toFixed(0)}%</span>
                      </Button>
                    ))}
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      disabled={busy === it.id}
                      onClick={() => void resolve(it.id, "reject")}
                    >
                      Tolak (bukan keduanya)
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
