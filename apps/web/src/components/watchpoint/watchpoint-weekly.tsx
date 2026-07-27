"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, Download, Save, Send, PencilLine, Database,
  TrendingUp, TrendingDown, Minus, RotateCcw, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// Tipe di-mirror dari apps/api/src/repo/watchpoint-weekly.ts.
type WatchStatus = "GREEN" | "YELLOW" | "RED" | "NA";
type WatchTrend = "improving" | "stable" | "declining";

interface WeeklyMetric {
  key: string;
  label: string;
  target: number | null;
  actual: number | null;
  prevActual: number | null;
  unit: string;
  direction: "higher" | "lower";
  source: "db" | "manual" | "live";
  pct: number | null;
  status: WatchStatus;
  trend: WatchTrend;
  note?: string;
}
interface WeeklyHod {
  key: string; name: string; role: string; status: WatchStatus; metrics: WeeklyMetric[];
}
export interface WeeklyBoard {
  isoYear: number; isoWeek: number; label: string; periode: string;
  from: string; to: string; isCurrent: boolean; saved: boolean; asOf: string;
  hods: WeeklyHod[];
  meta: { gate: string; legend: Record<WatchStatus, string> };
}
interface WeekRef {
  isoYear: number; isoWeek: number; label: string; periode: string;
  from: string; to: string; saved: boolean; isCurrent: boolean;
}

const STATUS_LABEL: Record<WatchStatus, string> = { GREEN: "Hijau", YELLOW: "Kuning", RED: "Merah", NA: "N/A" };
const STATUS_TONE: Record<WatchStatus, string> = {
  GREEN: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  YELLOW: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  RED: "bg-destructive/10 text-destructive",
  NA: "bg-muted text-muted-foreground",
};
const STATUS_DOT: Record<WatchStatus, string> = {
  GREEN: "bg-emerald-500", YELLOW: "bg-amber-500", RED: "bg-destructive", NA: "bg-muted-foreground/40",
};
const SEVERITY: Record<WatchStatus, number> = { RED: 0, YELLOW: 1, GREEN: 2, NA: 3 };
const STATUS_ORDER: WatchStatus[] = ["RED", "YELLOW", "GREEN", "NA"];

const TREND: Record<WatchTrend, { icon: LucideIcon; tone: string; label: string }> = {
  improving: { icon: TrendingUp, tone: "text-emerald-600 dark:text-emerald-500", label: "Naik" },
  stable: { icon: Minus, tone: "text-muted-foreground", label: "Stabil" },
  declining: { icon: TrendingDown, tone: "text-destructive", label: "Turun" },
};

// Milestone (target null) tak punya angka — nilainya state, sama seperti papan HoD.
const MILESTONE_VALUE: Record<WatchStatus, string> = { GREEN: "Live", YELLOW: "WIP", RED: "Off", NA: "—" };

function fmt(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "Rp") return "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v)}${unit ? " " + unit : ""}`;
}

const targetText = (m: WeeklyMetric) =>
  m.target === null ? "Milestone" : `${m.direction === "higher" ? "≥" : "≤"} ${fmt(m.target, m.unit)}`;

const weekQs = (b: { isoYear: number; isoWeek: number }) => `year=${b.isoYear}&week=${b.isoWeek}`;

// ── Papan mingguan ────────────────────────────────────────────────
export function WatchPointWeeklyView() {
  const [weeks, setWeeks] = useState<WeekRef[]>([]);
  const [sel, setSel] = useState<{ isoYear: number; isoWeek: number } | null>(null);
  const [board, setBoard] = useState<WeeklyBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<WatchStatus | "ALL">("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // Daftar minggu (sekali di awal) — menentukan minggu default = minggu berjalan.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/watchpoint/weekly/weeks");
        const data = await res.json();
        if (!alive) return;
        const rows: WeekRef[] = data.rows ?? [];
        setWeeks(rows);
        const cur = rows.find((w) => w.isCurrent) ?? rows[0];
        if (cur) setSel({ isoYear: cur.isoYear, isoWeek: cur.isoWeek });
      } catch {
        if (alive) setErr("Daftar minggu gagal dimuat.");
      }
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (w: { isoYear: number; isoWeek: number }) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/watchpoint/weekly?${weekQs(w)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal memuat");
      setBoard(data as WeeklyBoard);
    } catch (e) {
      setBoard(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState saat fetch; disengaja.
    if (sel) void load(sel);
  }, [sel, load]);

  const idx = useMemo(
    () => (sel ? weeks.findIndex((w) => w.isoYear === sel.isoYear && w.isoWeek === sel.isoWeek) : -1),
    [weeks, sel],
  );
  // weeks terurut terbaru→terlama: "minggu sebelumnya" = index+1.
  const goPrev = () => { const w = weeks[idx + 1]; if (w) setSel({ isoYear: w.isoYear, isoWeek: w.isoWeek }); };
  const goNext = () => { const w = weeks[idx - 1]; if (w) setSel({ isoYear: w.isoYear, isoWeek: w.isoWeek }); };

  const counts = useMemo(() => {
    const c: Record<WatchStatus, number> = { RED: 0, YELLOW: 0, GREEN: 0, NA: 0 };
    for (const h of board?.hods ?? []) c[h.status]++;
    return c;
  }, [board]);

  const visible = useMemo(() => {
    const sorted = [...(board?.hods ?? [])].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status]);
    return filter === "ALL" ? sorted : sorted.filter((h) => h.status === filter);
  }, [board, filter]);

  async function snapshot() {
    if (!board) return;
    setBusy("snapshot");
    setToast(null);
    try {
      const res = await fetch("/api/watchpoint/weekly/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year: board.isoYear, week: board.isoWeek }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal simpan");
      setToast({ ok: true, text: `${data.saved} metric ${board.label} dibekukan.` });
      await load({ isoYear: board.isoYear, isoWeek: board.isoWeek });
    } catch (e) {
      setToast({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!sel && !err) {
    return <Card><CardContent className="text-muted-foreground py-10 text-center text-sm">Memuat…</CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      {/* Toolbar: navigasi minggu + aksi */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={goPrev} disabled={idx < 0 || idx + 1 >= weeks.length} aria-label="Minggu sebelumnya">
            <ChevronLeft />
          </Button>
          <Select
            value={sel ? `${sel.isoYear}-${sel.isoWeek}` : ""}
            onValueChange={(v) => {
              const [y, w] = String(v ?? "").split("-").map(Number);
              if (Number.isFinite(y) && Number.isFinite(w)) setSel({ isoYear: y, isoWeek: w });
            }}
          >
            <SelectTrigger size="sm" className="bg-card border-border w-[268px]" aria-label="Pilih minggu">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={`${w.isoYear}-${w.isoWeek}`} value={`${w.isoYear}-${w.isoWeek}`}>
                  {w.label} · {w.periode}{w.isCurrent ? " (berjalan)" : w.saved ? "" : " · kosong"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon-sm" onClick={goNext} disabled={idx <= 0} aria-label="Minggu berikutnya">
            <ChevronRight />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={snapshot} disabled={!board || busy === "snapshot"}>
            <Save /> {busy === "snapshot" ? "Menyimpan…" : "Simpan Snapshot"}
          </Button>
          <Button
            size="sm"
            disabled={!board}
            render={<a href={board ? `/api/watchpoint/weekly/pptx?${weekQs(board)}` : "#"} />}
            nativeButton={false}
          >
            <Download /> Export PPTX
          </Button>
        </div>
      </div>

      {board ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-foreground font-medium">{board.label} · {board.periode}</span>
          <span>{board.isCurrent ? "minggu berjalan (angka live, belum final)" : board.saved ? "tersimpan" : "belum ada data tersimpan"}</span>
          <span>Gate: {board.meta.gate}</span>
          <span className="flex items-center gap-1"><Database className="size-3" /> = dari DB</span>
          <span className="flex items-center gap-1"><PencilLine className="size-3" /> = manual</span>
        </div>
      ) : null}

      {toast && (
        <p className={cn("text-sm", toast.ok ? "text-emerald-600 dark:text-emerald-500" : "text-destructive")}>{toast.text}</p>
      )}
      {err && <p className="text-destructive text-sm">{err}</p>}

      {/* Filter status */}
      {board && (
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} label="Semua" count={board.hods.length} />
          {STATUS_ORDER.map((s) => (
            <FilterChip
              key={s}
              active={filter === s}
              onClick={() => setFilter(filter === s ? "ALL" : s)}
              label={STATUS_LABEL[s]}
              count={counts[s]}
              dotClass={STATUS_DOT[s]}
              title={board.meta.legend[s]}
            />
          ))}
        </div>
      )}

      {loading ? (
        <Card><CardContent className="text-muted-foreground py-10 text-center text-sm">Memuat minggu…</CardContent></Card>
      ) : board ? (
        visible.length ? (
          <div className="space-y-4">
            {visible.map((h) => (
              <HodWeeklyCard key={h.key} board={board} hod={h} onChanged={() => load({ isoYear: board.isoYear, isoWeek: board.isoWeek })} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              Tidak ada HoD berstatus {filter !== "ALL" ? STATUS_LABEL[filter] : ""}.
            </CardContent>
          </Card>
        )
      ) : null}
    </div>
  );
}

// ── Kartu 1 HoD = tabel WatchPoint minggu tsb (susunan kolom mengikuti deck) ──
function HodWeeklyCard({ board, hod, onChanged }: { board: WeeklyBoard; hod: WeeklyHod; onChanged: () => void }) {
  const [edit, setEdit] = useState<WeeklyMetric | null>(null);
  const [wa, setWa] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base font-semibold tracking-tight">{hod.name}</CardTitle>
          <p className="text-muted-foreground text-xs">{hod.role}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", STATUS_TONE[hod.status])}>
            {STATUS_LABEL[hod.status]}
          </span>
          <Button variant="ghost" size="xs" onClick={() => setWa(true)}><Send /> Kirim WA</Button>
          <Button
            variant="ghost"
            size="xs"
            render={<a href={`/api/watchpoint/weekly/pptx?${weekQs(board)}&hod=${encodeURIComponent(hod.key)}`} />}
            nativeButton={false}
          >
            <Download /> PPTX
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[190px]">WATCHPOINT</TableHead>
                <TableHead className="min-w-[110px]">TARGET</TableHead>
                <TableHead className="min-w-[130px]">AKTUAL {board.label}</TableHead>
                <TableHead className="min-w-[90px]">STATUS</TableHead>
                <TableHead className="min-w-[90px]">TREND</TableHead>
                <TableHead className="min-w-[200px]">KETERANGAN</TableHead>
                <TableHead className="w-[44px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {hod.metrics.map((m) => {
                const t = TREND[m.trend];
                const TrendIcon = t.icon;
                const SourceIcon = m.source === "db" ? Database : PencilLine;
                return (
                  <TableRow key={m.key}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[m.status])} />
                        {m.label}
                        <SourceIcon className="text-muted-foreground/50 size-3 shrink-0" aria-label={m.source} />
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{targetText(m)}</TableCell>
                    <TableCell className="tabular-nums">
                      {m.target === null ? (
                        <span className="font-medium">{MILESTONE_VALUE[m.status]}</span>
                      ) : (
                        <span className="font-medium">
                          {fmt(m.actual, m.unit)}
                          {m.pct !== null ? <span className="text-muted-foreground"> ({Math.round(m.pct)}%)</span> : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", STATUS_TONE[m.status])}>
                        {STATUS_LABEL[m.status]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn("inline-flex items-center gap-1 text-xs", t.tone)}
                        title={m.prevActual === null ? "Belum ada data minggu sebelumnya" : `Minggu lalu: ${fmt(m.prevActual, m.unit)}`}
                      >
                        <TrendIcon className="size-3.5" /> {t.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{m.note ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-xs" onClick={() => setEdit(m)} aria-label={`Ubah ${m.label}`}>
                        <PencilLine />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {edit && (
        <EditMetricDialog
          board={board}
          hod={hod}
          metric={edit}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); onChanged(); }}
        />
      )}
      {wa && <SendWaDialog board={board} hod={hod} onClose={() => setWa(false)} />}
    </Card>
  );
}

// ── Dialog input manual per metric per minggu ─────────────────────
function EditMetricDialog({
  board, hod, metric, onClose, onSaved,
}: { board: WeeklyBoard; hod: WeeklyHod; metric: WeeklyMetric; onClose: () => void; onSaved: () => void }) {
  const [actual, setActual] = useState(metric.actual === null ? "" : String(metric.actual));
  const [status, setStatus] = useState<WatchStatus | "AUTO">(metric.target === null ? metric.status : "AUTO");
  const [note, setNote] = useState(metric.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isMilestone = metric.target === null;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/watchpoint/weekly", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hod_key: hod.key,
          metric_key: metric.key,
          year: board.isoYear,
          week: board.isoWeek,
          target: metric.target,
          actual: isMilestone || actual.trim() === "" ? null : Number(actual),
          status: status === "AUTO" ? null : status,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal simpan");
      onSaved();
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
      const qs = `${weekQs(board)}&hod_key=${encodeURIComponent(hod.key)}&metric_key=${encodeURIComponent(metric.key)}`;
      const res = await fetch(`/api/watchpoint/weekly?${qs}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const data = await res.json();
        throw new Error(data.error ?? "gagal reset");
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{metric.label} — {board.label}</DialogTitle>
          <DialogDescription>
            {hod.name} · {board.periode}. Nilai yang disimpan di sini menimpa angka otomatis untuk minggu ini saja.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          {!isMilestone && (
            <div className="grid gap-1.5">
              <Label htmlFor="wp-actual">Aktual {board.label} {metric.unit ? `(${metric.unit})` : ""}</Label>
              <Input
                id="wp-actual"
                inputMode="decimal"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder={metric.actual === null ? "kosong = N/A" : String(metric.actual)}
              />
              <p className="text-muted-foreground text-xs">Target: {targetText(metric)}</p>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="wp-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as WatchStatus | "AUTO")}>
              <SelectTrigger id="wp-status" size="sm" className="bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!isMilestone && <SelectItem value="AUTO">Otomatis dari target</SelectItem>}
                <SelectItem value="GREEN">Hijau</SelectItem>
                <SelectItem value="YELLOW">Kuning</SelectItem>
                <SelectItem value="RED">Merah</SelectItem>
                <SelectItem value="NA">N/A</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wp-note">Keterangan</Label>
            <Input id="wp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="konteks 1 kalimat (masuk ke deck PPT)" />
          </div>
          {err && <p className="text-destructive text-sm">{err}</p>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={save} disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          <Button variant="outline" onClick={reset} disabled={busy}><RotateCcw /> Reset ke otomatis</Button>
          <DialogClose render={<Button type="button" variant="ghost" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog kirim WA (ringkasan mingguan 1 HoD) ────────────────────
function SendWaDialog({ board, hod, onClose }: { board: WeeklyBoard; hod: WeeklyHod; onClose: () => void }) {
  // Ingat target terakhir (dialog hanya mount setelah klik user, jadi tak ada
  // risiko mismatch hidrasi dari pembacaan localStorage saat init).
  const [to, setTo] = useState(() => {
    try {
      return localStorage.getItem("wp:wa:lastTarget") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const target = to.trim();
    try {
      const res = await fetch(`/api/watchpoint/weekly/${hod.key}/send-wa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: target, year: board.isoYear, week: board.isoWeek }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal kirim");
      try { localStorage.setItem("wp:wa:lastTarget", target); } catch { /* abaikan */ }
      const mode = data.stub ? "stub (gateway belum diset)" : data.dryRun ? "dry-run (tak kirim live)" : "live ✓";
      setResult({ ok: true, text: `Terkirim ke ${data.to} — mode: ${mode}` });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Kirim WatchPoint {board.label} — {hod.name}</DialogTitle>
          <DialogDescription>Ringkasan {board.periode} ke nomor/JID WA tujuan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`wa-week-${hod.key}`}>Nomor / JID tujuan *</Label>
              <Input
                id={`wa-week-${hod.key}`}
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

function FilterChip({
  active, onClick, label, count, dotClass, title,
}: { active: boolean; onClick: () => void; label: string; count: number; dotClass?: string; title?: string }) {
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
