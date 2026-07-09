"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SalesAlert {
  id: string;
  alert_name: string;
  metric_key: string;
  threshold_operator: string;
  threshold_value: number;
  window_days: number;
  wa_target_jid: string | null;
  active: boolean;
}
export interface AlertTargets {
  groups: { jid: string; name: string }[];
  users: { am_id: string; nama: string; wa_number: string }[];
}

const METRICS = ["revenue", "ar_gt_90", "customer_count", "new_customer_count", "churn_count"];
// absolut: gt/gte/lt/lte/eq · Δ% vs window sebelumnya · anomali z-score (σ)
const OPS: [string, string][] = [
  ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["eq", "="],
  ["delta_pct_gt", "Δ% naik >"], ["delta_pct_lt", "Δ% turun <"], ["anomaly_std_gt", "anomali σ >"],
];

const sel = "h-9 rounded-md border bg-background px-2 text-sm";

export function SalesAlertsManager({ initialAlerts, targets }: { initialAlerts: SalesAlert[]; targets: AlertTargets }) {
  const [alerts, setAlerts] = useState<SalesAlert[]>(initialAlerts);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [metric, setMetric] = useState(METRICS[0]);
  const [op, setOp] = useState("lt");
  const [value, setValue] = useState("");
  const [win, setWin] = useState("7");
  const [targetType, setTargetType] = useState<"grup" | "personal">("grup");
  const [targetVal, setTargetVal] = useState("");

  async function reload() {
    try { const r = await fetch("/api/sales-analytics/alerts"); if (r.ok) setAlerts(((await r.json()).alerts ?? []) as SalesAlert[]); } catch { /* abaikan */ }
  }
  async function add() {
    if (!name.trim() || value === "") { setErr("nama & nilai wajib"); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/sales-analytics/alerts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alert_name: name.trim(), metric_key: metric, threshold_operator: op,
          threshold_value: Number(value), window_days: Number(win) || 7,
          wa_target_jid: targetVal || null,
        }),
      });
      if (!r.ok) { setErr(String((await r.json().catch(() => ({}))).error ?? "gagal simpan")); return; }
      setName(""); setValue(""); setTargetVal("");
      await reload();
    } finally { setBusy(false); }
  }
  async function toggle(a: SalesAlert) {
    await fetch(`/api/sales-analytics/alerts/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !a.active }) });
    await reload();
  }
  async function del(id: string) {
    if (!confirm("Hapus alert ini?")) return;
    await fetch(`/api/sales-analytics/alerts/${id}`, { method: "DELETE" });
    await reload();
  }

  const targetLabel = (jid: string | null): string => {
    if (!jid) return "— (default HoD)";
    const g = targets.groups.find((x) => x.jid === jid);
    if (g) return `Grup: ${g.name}`;
    const u = targets.users.find((x) => x.wa_number === jid);
    if (u) return `Personal: ${u.nama}`;
    return jid;
  };

  return (
    <div className="space-y-4">
      {err ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</div> : null}

      <Card>
        <CardHeader><CardTitle className="text-base">Tambah alert</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1"><Label className="text-xs">Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama alert" className="h-9 w-44" /></div>
            <div className="grid gap-1"><Label className="text-xs">Metric</Label>
              <select value={metric} onChange={(e) => setMetric(e.target.value)} className={sel}>{METRICS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
            <div className="grid gap-1"><Label className="text-xs">Operator</Label>
              <select value={op} onChange={(e) => setOp(e.target.value)} className={sel}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="grid gap-1"><Label className="text-xs">Nilai</Label><Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="nilai" className="h-9 w-28" /></div>
            <div className="grid gap-1"><Label className="text-xs">Window (hari)</Label><Input type="number" value={win} onChange={(e) => setWin(e.target.value)} className="h-9 w-24" /></div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Tujuan notif</Label>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1.5"><input type="radio" name="tt" checked={targetType === "grup"} onChange={() => { setTargetType("grup"); setTargetVal(""); }} /> Grup</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="tt" checked={targetType === "personal"} onChange={() => { setTargetType("personal"); setTargetVal(""); }} /> Personal</label>
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{targetType === "grup" ? "Pilih grup" : "Pilih user"}</Label>
              <select value={targetVal} onChange={(e) => setTargetVal(e.target.value)} className={`${sel} min-w-[220px]`}>
                <option value="">— default (HoD Squad) —</option>
                {targetType === "grup"
                  ? targets.groups.map((g) => <option key={g.jid} value={g.jid}>{g.name}</option>)
                  : targets.users.map((u) => <option key={u.am_id} value={u.wa_number}>{u.nama} · {u.wa_number}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={() => void add()} disabled={busy}>Tambah</Button>
          </div>
          <p className="text-muted-foreground text-xs">Kosongkan tujuan → pakai default (`HOD_WA_TARGET`/`NOTIF_TUA_TARGET`). Δ%/anomali hanya utk revenue/customer_count/new_customer_count.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Alert ({alerts.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left"><tr className="border-b">
              <th className="py-2 pr-3">Nama</th><th className="pr-3">Kondisi</th><th className="pr-3">Window</th><th className="pr-3">Tujuan</th><th className="pr-3">Status</th><th>Aksi</th>
            </tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b align-top last:border-0">
                  <td className="py-2 pr-3 font-medium">{a.alert_name}</td>
                  <td className="pr-3"><code className="bg-muted rounded px-1">{a.metric_key} {a.threshold_operator} {a.threshold_value.toLocaleString("id-ID")}</code></td>
                  <td className="pr-3 text-muted-foreground">{a.window_days}h</td>
                  <td className="pr-3 text-muted-foreground text-xs">{targetLabel(a.wa_target_jid)}</td>
                  <td className="pr-3"><Badge variant={a.active ? "secondary" : "outline"}>{a.active ? "aktif" : "nonaktif"}</Badge></td>
                  <td className="space-x-1 whitespace-nowrap py-1">
                    <Button size="sm" onClick={() => void toggle(a)} className={a.active ? "bg-red-600 text-white hover:bg-red-700" : "bg-emerald-600 text-white hover:bg-emerald-700"}>{a.active ? "Nonaktifkan" : "Aktifkan"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void del(a.id)}>Hapus</Button>
                  </td>
                </tr>
              ))}
              {alerts.length === 0 && <tr><td colSpan={6} className="text-muted-foreground py-6 text-center">Belum ada alert.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
