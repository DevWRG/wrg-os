"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Database, PencilLine, RotateCcw, Send, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

// Tipe di-mirror dari apps/api/src/repo/watchpoint.ts.
type WatchStatus = "GREEN" | "YELLOW" | "RED" | "NA";
type WatchTrend = "improving" | "stable" | "declining";

type TargetMode = "default" | "value" | "milestone";

interface WatchMetric {
  key: string;
  label: string;
  target: number | null;
  actual: number | null;
  unit: string;
  direction: "higher" | "lower";
  source: "db" | "manual";
  pct: number | null;
  status: WatchStatus;
  trend: WatchTrend;
  note?: string;
  targetMode: TargetMode;
  defaultTarget: number | null;
}
interface HodWatch {
  key: string;
  name: string;
  role: string;
  status: WatchStatus;
  metrics: WatchMetric[];
}
export interface WatchBoard {
  source: "computed";
  generatedFor: string;
  asOf: string;
  hods: HodWatch[];
  meta: { gate: string; legend: Record<WatchStatus, string>; pending: string[] };
}

const STATUS_LABEL: Record<WatchStatus, string> = { GREEN: "Hijau", YELLOW: "Kuning", RED: "Merah", NA: "N/A" };
const STATUS_DOT: Record<WatchStatus, string> = {
  GREEN: "bg-emerald-500",
  YELLOW: "bg-amber-500",
  RED: "bg-destructive",
  NA: "bg-muted-foreground/40",
};
const STATUS_TONE: Record<WatchStatus, string> = {
  GREEN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  YELLOW: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  RED: "bg-destructive/10 text-destructive",
  NA: "bg-muted text-muted-foreground",
};
const SEVERITY: Record<WatchStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2, NA: 3 };
const STATUS_ORDER: WatchStatus[] = ["RED", "YELLOW", "GREEN", "NA"];

const TREND: Record<WatchTrend, { icon: LucideIcon; tone: string }> = {
  improving: { icon: TrendingUp, tone: "text-emerald-600 dark:text-emerald-500" },
  stable: { icon: Minus, tone: "text-muted-foreground" },
  declining: { icon: TrendingDown, tone: "text-destructive" },
};

// Metric milestone (target null) tak punya angka — nilainya = state dari status.
const MILESTONE_VALUE: Record<WatchStatus, string> = {
  GREEN: "Live", YELLOW: "WIP", RED: "Off", NA: "—",
};

// Kelas warna teks dari STATUS_TONE (buang bg, sisakan text-*).
function statusText(status: WatchStatus): string {
  return STATUS_TONE[status].split(" ").slice(1).join(" ");
}

// Format nilai metric sesuai unit.
function fmt(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "Rp") {
    return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  }
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v)}${unit ? " " + unit : ""}`;
}

function MetricRow({ m, onEdit }: { m: WatchMetric; onEdit?: () => void }) {
  const t = TREND[m.trend];
  const TrendIcon = t.icon;
  const SourceIcon = m.source === "db" ? Database : PencilLine;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[m.status])} />
        <span className="truncate text-xs" title={m.note}>{m.label}</span>
        <SourceIcon className="text-muted-foreground/50 size-3 shrink-0" aria-label={m.source} />
        {m.targetMode !== "default" && (
          <span
            className="text-muted-foreground border-border shrink-0 rounded border px-1 text-[10px] leading-4"
            title={`Target diubah dari default (${m.defaultTarget === null ? "milestone" : fmt(m.defaultTarget, m.unit)})`}
          >
            ubah
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs tabular-nums">
        {m.target === null ? (
          // Milestone: tampilkan state (Live/WIP/Off) ganti angka actual/target.
          <span className={cn("font-medium", statusText(m.status))}>{MILESTONE_VALUE[m.status]}</span>
        ) : (
          <>
            <span className="font-medium">{fmt(m.actual, m.unit)}</span>
            <span className="text-muted-foreground">/ {fmt(m.target, m.unit)}</span>
            {m.pct !== null ? (
              <span className={cn("w-10 text-right", statusText(m.status))}>{Math.round(m.pct)}%</span>
            ) : (
              <span className="w-10 text-right">—</span>
            )}
          </>
        )}
        <TrendIcon className={cn("size-3.5 shrink-0", t.tone)} />
        {onEdit && (
          <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`Ubah ${m.label}`}>
            <PencilLine />
          </Button>
        )}
      </div>
    </div>
  );
}

function HodCard({ hod, canEdit }: { hod: HodWatch; canEdit: boolean }) {
  const [edit, setEdit] = useState<WatchMetric | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base font-semibold tracking-tight">{hod.name}</CardTitle>
          <p className="text-muted-foreground text-xs">{hod.role}</p>
        </div>
        <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", STATUS_TONE[hod.status])}>
          {STATUS_LABEL[hod.status]}
        </span>
      </CardHeader>
      <CardContent className="divide-border/60 divide-y pt-0">
        {hod.metrics.map((m) => (
          <MetricRow key={m.key} m={m} onEdit={canEdit ? () => setEdit(m) : undefined} />
        ))}
        <div className="flex justify-end pt-2">
          <SendWaButton hod={hod} />
        </div>
      </CardContent>
      {edit && <EditMetricDialog hod={hod} metric={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

// ── Dialog ubah target & nilai manual satu metric ─────────────────
// Target = kesepakatan Direktur–HoD, jadi disimpan sebagai OVERRIDE di DB
// (watchpoint_metric, migrasi 080); angka brief Juni 2026 di kode tetap jadi
// default dan bisa dipulihkan lewat "Kembalikan ke default".
const MODE_LABEL: Record<string, string> = {
  default: "Pakai default", value: "Angka sendiri", milestone: "Tanpa angka (milestone)",
};
const STATUS_PICK_LABEL: Record<string, string> = {
  AUTO: "Otomatis dari target", GREEN: "Hijau / Live", YELLOW: "Kuning / WIP", RED: "Merah / Off", NA: "N/A",
};

function errText(status: number, raw?: string): string {
  if (status === 401) return "Perlu login dulu untuk mengubah metric.";
  if (status === 403) return "Hanya Direktur atau admin yang boleh mengubah target/nilai metric.";
  if (status === 503) return "Database sedang tidak aktif — perubahan tak bisa disimpan.";
  return raw?.trim() || `Gagal (HTTP ${status}).`;
}

function EditMetricDialog({ hod, metric, onClose }: { hod: HodWatch; metric: WatchMetric; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<TargetMode>(metric.targetMode);
  const [target, setTarget] = useState(
    metric.targetMode === "value" && metric.target !== null ? String(metric.target) : "",
  );
  const [actual, setActual] = useState(metric.actual === null ? "" : String(metric.actual));
  const [status, setStatus] = useState<WatchStatus | "AUTO">(metric.target === null ? metric.status : "AUTO");
  const [note, setNote] = useState(metric.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Milestone = target efektif tak berangka → status diisi manual, aktual tak relevan.
  const isMilestone = mode === "milestone" || (mode === "default" && metric.defaultTarget === null);
  const isComputed = metric.source === "db";

  function done() {
    router.refresh();
    onClose();
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/watchpoint/metric", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hod_key: hod.key,
          metric_key: metric.key,
          target_mode: mode,
          target_override: mode === "value" ? Number(target) : null,
          actual: isMilestone || isComputed || actual.trim() === "" ? null : Number(actual),
          status: status === "AUTO" ? null : status,
          note: note.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(res.status, data.error));
      done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setErr(null);
    try {
      const qs = `hod_key=${encodeURIComponent(hod.key)}&metric_key=${encodeURIComponent(metric.key)}`;
      const res = await fetch(`/api/watchpoint/metric?${qs}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        throw new Error(errText(res.status, data.error));
      }
      done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const targetInvalid = mode === "value" && (target.trim() === "" || !Number.isFinite(Number(target)));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{metric.label} — {hod.name}</DialogTitle>
          <DialogDescription>
            Target berlaku untuk papan ini seterusnya (bukan per minggu). Default:{" "}
            {metric.defaultTarget === null ? "milestone tanpa angka" : fmt(metric.defaultTarget, metric.unit)}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="wpb-mode">Target</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as TargetMode)}>
              <SelectTrigger id="wpb-mode" size="sm" className="bg-card border-border">
                <SelectValue>{(v) => MODE_LABEL[String(v)] ?? "Pilih"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Pakai default</SelectItem>
                <SelectItem value="value">Angka sendiri</SelectItem>
                <SelectItem value="milestone">Tanpa angka (milestone)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "value" && (
            <div className="grid gap-1.5">
              <Label htmlFor="wpb-target">
                Nilai target {metric.unit ? `(${metric.unit})` : ""} — arah {metric.direction === "higher" ? "makin besar makin baik" : "makin kecil makin baik"}
              </Label>
              <Input
                id="wpb-target"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={metric.defaultTarget === null ? "mis. 95" : String(metric.defaultTarget)}
              />
              <p className="text-muted-foreground text-xs">Tulis angka penuh, tanpa titik ribuan (Rp 2,5 M = 2500000000).</p>
            </div>
          )}

          {!isMilestone && (
            isComputed ? (
              <p className="text-muted-foreground text-xs">
                Aktual metric ini dihitung otomatis dari database, jadi tak bisa diisi manual di sini.
              </p>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="wpb-actual">Aktual {metric.unit ? `(${metric.unit})` : ""}</Label>
                <Input
                  id="wpb-actual"
                  inputMode="decimal"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  placeholder="kosong = N/A"
                />
              </div>
            )
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="wpb-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as WatchStatus | "AUTO")}>
              <SelectTrigger id="wpb-status" size="sm" className="bg-card border-border">
                <SelectValue>{(v) => STATUS_PICK_LABEL[String(v)] ?? "Pilih status"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {!isMilestone && <SelectItem value="AUTO">Otomatis dari target</SelectItem>}
                <SelectItem value="GREEN">Hijau / Live</SelectItem>
                <SelectItem value="YELLOW">Kuning / WIP</SelectItem>
                <SelectItem value="RED">Merah / Off</SelectItem>
                <SelectItem value="NA">N/A</SelectItem>
              </SelectContent>
            </Select>
            {!isMilestone && (
              <p className="text-muted-foreground text-xs">Status manual hanya dipakai untuk metric tanpa angka target.</p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="wpb-note">Keterangan</Label>
            <Input id="wpb-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="konteks 1 kalimat" />
          </div>

          {err && <p className="text-destructive text-sm">{err}</p>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={save} disabled={busy || targetInvalid}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          <Button variant="outline" onClick={reset} disabled={busy}><RotateCcw /> Kembalikan ke default</Button>
          <DialogClose render={<Button type="button" variant="ghost" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tombol "Kirim WA": dialog isi nomor/jid tujuan → POST /api/watchpoint/:hod/send-wa.
// Pengiriman patuh WA_DRY_RUN di server (default dry-run → aman). Ingat target
// terakhir di localStorage biar tak ketik ulang.
function SendWaButton({ hod }: { hod: HodWatch }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const target = to.trim();
    try {
      const res = await fetch(`/api/watchpoint/${hod.key}/send-wa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal kirim");
      try {
        localStorage.setItem("wp:wa:lastTarget", target);
      } catch {}
      const mode = data.stub
        ? "stub (gateway belum diset)"
        : data.dryRun
          ? "dry-run (tak kirim live)"
          : "live ✓";
      setResult({ ok: true, text: `Terkirim ke ${data.to} — mode: ${mode}` });
    } catch (err) {
      setResult({ ok: false, text: String(err instanceof Error ? err.message : err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setResult(null);
          if (!to) {
            try {
              const v = localStorage.getItem("wp:wa:lastTarget");
              if (v) setTo(v);
            } catch {}
          }
        }
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="xs" />}>
        <Send /> Kirim WA
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kirim WatchPoint — {hod.name}</DialogTitle>
          <DialogDescription>Kirim ringkasan status {hod.name} ke nomor/JID WA tujuan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`wa-${hod.key}`}>Nomor / JID tujuan *</Label>
              <Input
                id={`wa-${hod.key}`}
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="62812… atau 1203…@g.us"
              />
            </div>
            {result && (
              <p className={cn("text-sm", result.ok ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>
                {result.text}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !to.trim()}>{busy ? "Mengirim…" : "Kirim"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WatchPointBoardView({ initial, canEdit = false }: { initial: WatchBoard | null; canEdit?: boolean }) {
  const [filter, setFilter] = useState<WatchStatus | "ALL">("ALL");

  const counts = useMemo(() => {
    const c: Record<WatchStatus, number> = { RED: 0, YELLOW: 0, GREEN: 0, NA: 0 };
    for (const h of initial?.hods ?? []) c[h.status]++;
    return c;
  }, [initial]);

  const visible = useMemo(() => {
    const sorted = [...(initial?.hods ?? [])].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
    return filter === "ALL" ? sorted : sorted.filter((h) => h.status === filter);
  }, [initial, filter]);

  if (!initial) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-10 text-center text-sm">
          Data WatchPoint tidak tersedia (backend tak terjangkau).
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>Gate: {initial.meta.gate}</span>
        <span className="flex items-center gap-1"><Database className="size-3" /> = dari DB</span>
        <span className="flex items-center gap-1"><PencilLine className="size-3" /> = manual</span>
      </div>

      {initial.meta.pending.length ? (
        <div className="bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-start gap-2 rounded-lg border border-amber-500/30 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><strong>Catatan:</strong> {initial.meta.pending.join(" · ")}</span>
        </div>
      ) : null}

      {/* Summary strip + filter */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label="Semua" count={initial.hods.length} />
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(filter === s ? "ALL" : s)}
            label={STATUS_LABEL[s]}
            count={counts[s]}
            dotClass={STATUS_DOT[s]}
            title={initial.meta.legend[s]}
          />
        ))}
      </div>

      {visible.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((h) => (
            <HodCard key={h.key} hod={h} canEdit={canEdit} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Tidak ada HoD berstatus {filter !== "ALL" ? STATUS_LABEL[filter] : ""}.
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        {initial.generatedFor} · diperbarui {new Date(initial.asOf).toLocaleString("id-ID")}
      </p>
    </div>
  );
}

function FilterChip({
  active, onClick, label, count, dotClass, title,
}: {
  active: boolean; onClick: () => void; label: string; count: number; dotClass?: string; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-foreground/20 bg-foreground text-background" : "border-border text-foreground hover:bg-muted",
      )}
    >
      {dotClass ? <span className={cn("size-2 rounded-full", dotClass)} /> : null}
      {label}
      <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}
