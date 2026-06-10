"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ScheduleJob {
  id: string;
  expr: string;
  valid: boolean;
}
interface ScheduleStatus {
  enabled: boolean;
  timezone: string;
  jobs: ScheduleJob[];
}

const AGENT_LABEL: Record<string, string> = {
  A1: "Distillation Cascade",
  A2: "AR Aging Watch",
  A3: "Sari Collection Drafter",
  A4: "Pipeline Authenticity",
  A5: "Anomaly Detection",
  A6: "Sales Doc Drafter",
};

// Ringkas hasil run-now per agen jadi satu baris status.
function summarize(agentId: string, data: Record<string, unknown>): string {
  if (agentId === "A1") {
    const s = (data.summary ?? {}) as Record<string, unknown>;
    return data.distilled
      ? `distilasi ${s.messages ?? 0} pesan / ${s.groups ?? 0} grup → digest`
      : "tidak ada pesan di window — no-op";
  }
  if (agentId === "A2") {
    const s = (data.summary ?? {}) as Record<string, unknown>;
    return `overdue ${s.overdue_invoices ?? 0} · critical ${s.critical_count ?? 0}`;
  }
  if (agentId === "A3") {
    return data.drafted
      ? `${data.count ?? 0} draft penagihan (${data.draft_type ?? "whatsapp"}) → review`
      : "tidak ada invoice overdue baru — no-op";
  }
  if (agentId === "A4") {
    const s = (data.summary ?? {}) as Record<string, unknown>;
    return `${s.flagged ?? 0} flagged · ${s.critical ?? 0} kritis → ${s.escalated ?? 0} eskalasi HITL`;
  }
  if (agentId === "A5") {
    const s = (data.summary ?? {}) as Record<string, unknown>;
    return `${s.anomalies ?? 0} anomali · ${s.critical ?? 0} kritis → ${s.escalated ?? 0} eskalasi HITL`;
  }
  if (agentId === "A6") {
    return data.drafted
      ? `${data.count ?? 0} dokumen penjualan → review`
      : "tidak ada deal butuh dokumen — no-op";
  }
  return "selesai";
}

export function AgentSchedulerCard() {
  const [status, setStatus] = useState<ScheduleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/schedule", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat status jadwal");
      setStatus(data as ScheduleStatus);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch — inline async (setState hanya setelah await; hindari
  // set-state-in-effect). `load` dipakai ulang tombol Refresh.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/agents/schedule", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "gagal memuat status jadwal");
        setStatus(data as ScheduleStatus);
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

  async function runNow(agentId: string) {
    setBusy(agentId);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId.toLowerCase()}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menjalankan agen");
      setLastRun((prev) => ({ ...prev, [agentId]: summarize(agentId, data) }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Agent Scheduler</CardTitle>
          <CardDescription>
            Jadwal cron agen Blueprint (in-process). Tiap run tercatat di audit_log.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {status &&
            (status.enabled ? (
              <Badge>aktif</Badge>
            ) : (
              <Badge variant="secondary">nonaktif</Badge>
            ))}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && <p className="text-destructive text-sm">{error}</p>}
        {loading ? (
          <p className="text-muted-foreground text-sm">Memuat…</p>
        ) : !status ? (
          <p className="text-muted-foreground text-sm">Status tidak tersedia.</p>
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              Timezone: <span className="font-mono">{status.timezone || "—"}</span>
              {!status.enabled && " · set AGENT_SCHEDULE_ENABLED=true untuk auto-run"}
            </p>
            {status.jobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{j.id}</span>
                    <span className="text-muted-foreground text-sm">
                      {AGENT_LABEL[j.id] ?? ""}
                    </span>
                    {!j.valid && <Badge variant="destructive">expr invalid</Badge>}
                  </div>
                  <p className="text-muted-foreground font-mono text-xs">{j.expr}</p>
                  {lastRun[j.id] && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      run terakhir: {lastRun[j.id]}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === j.id}
                  onClick={() => void runNow(j.id)}
                >
                  {busy === j.id ? "Menjalankan…" : "Run now"}
                </Button>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
