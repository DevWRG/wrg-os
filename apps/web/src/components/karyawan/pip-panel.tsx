"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { fmtDelta, fmtScore, fmtSisaHari, MILESTONE_LABEL, PIP_STATUS_LABEL, type PipStatus } from "@/components/karyawan/pip-format";

// F70 — perjalanan improvement satu karyawan (drilldown /karyawan/[amId]): profil employee,
// deret skor Raport antar periode, dan PIP 90 hari (goal, milestone, check-in mingguan, outcome,
// jejak audit). Izin = fitur 'karyawan'; kalau server menolak (403) pesannya ditampilkan apa adanya.

interface Point { period: string; overall: number | null; delta: number | null }
interface CaseRow {
  id: number; start_date: string; end_date: string; status: PipStatus; alasan: string; outcome_note: string | null;
  days_left: number | null; goals: number; milestones: number; milestones_tercapai: number; checkins: number;
}
interface Journey {
  employee: { id: string; nama: string; panggilan: string | null; role: string | null; dept_label: string | null; cabang: string | null; okr_objective: string | null } | null;
  periods: { key: string; label: string }[]; series: Point[]; delta: number | null; cases: CaseRow[];
}
interface Detail extends CaseRow {
  goal_list: { id: number; goal: string; target: string | null }[];
  milestone_list: { id: number; judul: string; due_date: string; status: string; catatan: string | null; terlambat: boolean }[];
  checkin_list: { id: number; week_no: number; checkin_date: string; catatan: string; created_by: string | null }[];
  timeline: { event_type: string; actor: string | null; decision: string | null; occurred_at: string }[];
}

async function call(method: "POST" | "PATCH", path: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const r = await fetch(`/api/pip/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return j.error ?? `gagal (${r.status})`;
  } catch {
    return "tidak dapat menghubungi server";
  }
}

const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const deltaTone = (d: number | null) => (d == null || d === 0 ? "text-muted-foreground" : d > 0 ? "text-emerald-600" : "text-red-600");

function Err({ msg }: { msg: string | null }) {
  return msg ? <p role="alert" className="text-destructive text-sm">{msg}</p> : null;
}

// ── Mulai PIP ────────────────────────────────────────────────────────────────
function StartForm({ amId, onDone }: { amId: string; onDone: () => void }) {
  const [alasan, setAlasan] = useState("");
  const [mulai, setMulai] = useState(today());
  const [goals, setGoals] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    // Satu goal per baris; format "goal | target" (target opsional).
    const gl = goals.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [g, ...t] = l.split("|");
      return { goal: g.trim(), target: t.join("|").trim() };
    });
    const e = await call("POST", "cases", { am_id: amId, alasan, start_date: mulai, goals: gl });
    setBusy(false);
    if (e) setErr(e); else onDone();
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h4 className="font-semibold">Mulai PIP 90 hari</h4>
        <label className="block space-y-1 text-sm">Alasan / konteks
          <Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} />
        </label>
        <label className="block space-y-1 text-sm">Tanggal mulai (berakhir 90 hari kemudian)
          <Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} className="max-w-48" />
        </label>
        <label className="block space-y-1 text-sm">Improvement goal — satu per baris, format <code>goal | target</code>
          <Textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={3} />
        </label>
        <Err msg={err} />
        <Button onClick={submit} disabled={busy}>{busy ? "Menyimpan…" : "Mulai PIP"}</Button>
      </CardContent>
    </Card>
  );
}

// ── Satu PIP ─────────────────────────────────────────────────────────────────
function PipCase({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [checkin, setCheckin] = useState({ tanggal: today(), catatan: "" });
  const [goal, setGoal] = useState({ goal: "", target: "" });
  const [ms, setMs] = useState({ judul: "", due: "" });
  const [outcome, setOutcome] = useState({ outcome: "graduate", catatan: "", end_date: "" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/pip/cases/${id}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return (await r.json()) as Detail; })
      .then((x) => { if (alive) { setD(x); setState("idle"); } })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [id, rev]);

  const run = useCallback(async (method: "POST" | "PATCH", path: string, body: Record<string, unknown>, after?: () => void) => {
    setErr(null);
    const e = await call(method, path, body);
    if (e) { setErr(e); return; }
    after?.();
    setRev((n) => n + 1);
    onChanged();
  }, [onChanged]);

  if (state === "loading") return <SkeletonLines />;
  if (state === "error" || !d) return <p className="text-destructive text-sm">Detail PIP tidak dapat dimuat.</p>;
  const aktif = d.status === "aktif";

  return (
    <Card>
      <CardContent className="space-y-4 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={aktif ? "default" : d.status === "terminate" ? "destructive" : "secondary"}>{PIP_STATUS_LABEL[d.status]}</Badge>
          <span className="font-medium">{d.start_date} → {d.end_date}</span>
          {aktif ? <span className="text-muted-foreground">{fmtSisaHari(d.days_left)}</span> : null}
        </div>
        <p><span className="text-muted-foreground">Alasan:</span> {d.alasan}</p>
        {d.outcome_note ? <p><span className="text-muted-foreground">Catatan outcome:</span> {d.outcome_note}</p> : null}
        <Err msg={err} />

        <section className="space-y-1">
          <h5 className="font-semibold">Improvement goal</h5>
          <ul className="list-disc pl-5">{d.goal_list.map((g) => <li key={g.id}>{g.goal}{g.target ? <span className="text-muted-foreground"> — target: {g.target}</span> : null}</li>)}</ul>
          {aktif ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Input placeholder="Goal baru" value={goal.goal} onChange={(e) => setGoal({ ...goal, goal: e.target.value })} className="max-w-xs" />
              <Input placeholder="Target (opsional)" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} className="max-w-xs" />
              <Button size="sm" variant="outline" onClick={() => run("POST", `cases/${id}/goals`, goal, () => setGoal({ goal: "", target: "" }))}>Tambah goal</Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-1">
          <h5 className="font-semibold">Milestone ({d.milestones_tercapai}/{d.milestones} tercapai)</h5>
          {d.milestone_list.length === 0 ? <p className="text-muted-foreground">Belum ada milestone.</p> : null}
          {d.milestone_list.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2">
              <span>{m.judul}</span>
              <span className="text-muted-foreground">tenggat {m.due_date}</span>
              <Badge variant={m.status === "tercapai" ? "default" : m.status === "tidak_tercapai" ? "destructive" : "outline"}>{MILESTONE_LABEL[m.status] ?? m.status}</Badge>
              {m.terlambat ? <Badge variant="destructive">Terlambat</Badge> : null}
              {m.catatan ? <span className="text-muted-foreground">— {m.catatan}</span> : null}
              {aktif ? (
                <>
                  <Button size="xs" variant="outline" onClick={() => run("PATCH", `milestones/${m.id}`, { status: "tercapai" })}>Tercapai</Button>
                  <Button size="xs" variant="outline" onClick={() => {
                    const alasan = window.prompt("Alasan milestone tidak tercapai:");
                    if (alasan) void run("PATCH", `milestones/${m.id}`, { status: "tidak_tercapai", catatan: alasan });
                  }}>Tidak tercapai</Button>
                  {m.status !== "belum" ? <Button size="xs" variant="ghost" onClick={() => run("PATCH", `milestones/${m.id}`, { status: "belum" })}>Buka lagi</Button> : null}
                </>
              ) : null}
            </div>
          ))}
          {aktif ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Input placeholder="Milestone baru" value={ms.judul} onChange={(e) => setMs({ ...ms, judul: e.target.value })} className="max-w-xs" />
              <Input type="date" value={ms.due} onChange={(e) => setMs({ ...ms, due: e.target.value })} className="max-w-44" />
              <Button size="sm" variant="outline" onClick={() => run("POST", `cases/${id}/milestones`, { judul: ms.judul, due_date: ms.due }, () => setMs({ judul: "", due: "" }))}>Tambah milestone</Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-1">
          <h5 className="font-semibold">Check-in mingguan ({d.checkins})</h5>
          {d.checkin_list.length === 0 ? <p className="text-muted-foreground">Belum ada check-in.</p> : null}
          {d.checkin_list.map((k) => (
            <p key={k.id}><span className="text-muted-foreground">Minggu {k.week_no} · {k.checkin_date}{k.created_by ? ` · ${k.created_by}` : ""}:</span> {k.catatan}</p>
          ))}
          {aktif ? (
            <div className="space-y-2 pt-1">
              <Input type="date" max={today()} value={checkin.tanggal} onChange={(e) => setCheckin({ ...checkin, tanggal: e.target.value })} className="max-w-44" />
              <Textarea placeholder="Catatan check-in" rows={2} value={checkin.catatan} onChange={(e) => setCheckin({ ...checkin, catatan: e.target.value })} />
              <Button size="sm" variant="outline" onClick={() => run("POST", `cases/${id}/checkins`, { checkin_date: checkin.tanggal, catatan: checkin.catatan }, () => setCheckin({ tanggal: today(), catatan: "" }))}>Simpan check-in</Button>
            </div>
          ) : null}
        </section>

        {aktif ? (
          <section className="space-y-2 border-t pt-3">
            <h5 className="font-semibold">Outcome</h5>
            <div className="flex flex-wrap gap-2">
              <select className="border-input h-8 rounded-lg border bg-transparent px-2" value={outcome.outcome} onChange={(e) => setOutcome({ ...outcome, outcome: e.target.value })}>
                <option value="graduate">Graduate</option>
                <option value="extend">Extend</option>
                <option value="terminate">Terminate</option>
              </select>
              {outcome.outcome === "extend" ? <Input type="date" value={outcome.end_date} onChange={(e) => setOutcome({ ...outcome, end_date: e.target.value })} className="max-w-44" aria-label="Tanggal berakhir baru" /> : null}
            </div>
            <Textarea placeholder="Catatan outcome (wajib)" rows={2} value={outcome.catatan} onChange={(e) => setOutcome({ ...outcome, catatan: e.target.value })} />
            <Button size="sm" variant={outcome.outcome === "terminate" ? "destructive" : "default"} onClick={() => {
              if (!window.confirm(`Catat outcome ${outcome.outcome.toUpperCase()}? Tercatat di jejak audit.`)) return;
              void run("POST", `cases/${id}/outcome`, { outcome: outcome.outcome, catatan: outcome.catatan, end_date: outcome.outcome === "extend" ? outcome.end_date : undefined });
            }}>Catat outcome</Button>
          </section>
        ) : null}

        <section className="space-y-1 border-t pt-3">
          <h5 className="font-semibold">Jejak audit</h5>
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            {d.timeline.map((t, i) => <li key={i}>{t.occurred_at.slice(0, 16)} · {t.event_type}{t.actor ? ` · ${t.actor}` : ""}</li>)}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
export function PipPanel({ amId }: { amId: string }) {
  const [j, setJ] = useState<Journey | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error" | "forbidden" | "migration">("loading");
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/api/pip/improvement/${encodeURIComponent(amId)}`)
      .then(async (r) => {
        if (r.status === 403) { if (alive) setState("forbidden"); return; }
        if (r.status === 503) { if (alive) setState("migration"); return; }
        if (!r.ok) throw new Error(String(r.status));
        const x = (await r.json()) as Journey;
        if (alive) { setJ(x); setState("idle"); }
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [amId, rev]);

  if (state === "loading") return <SkeletonLines />;
  if (state === "forbidden") return null;
  if (state === "migration") return <p className="text-muted-foreground text-sm">Fitur PIP belum aktif: migrasi database (234) belum diterapkan.</p>;
  if (state === "error" || !j) return <p className="text-destructive text-sm">Perjalanan improvement tidak dapat dimuat.</p>;

  const hasActive = j.cases.some((c) => c.status === "aktif");
  const refresh = () => setRev((n) => n + 1);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Improvement &amp; PIP</h3>
      <Card>
        <CardContent className="space-y-2 py-4 text-sm">
          {j.employee ? (
            <p><span className="font-medium">{j.employee.nama}</span> <span className="text-muted-foreground">· {j.employee.role ?? "–"}{j.employee.dept_label ? ` · ${j.employee.dept_label}` : ""}{j.employee.cabang ? ` · ${j.employee.cabang}` : ""}</span></p>
          ) : (
            <p className="text-muted-foreground">Karyawan ini belum tertaut ke profil employee (am_id) — PIP belum bisa dimulai. Tautkan dulu di Kelola Profil.</p>
          )}
          <div className="flex flex-wrap gap-4">
            {j.series.map((p) => (
              <div key={p.period} className="tabular-nums">
                <div className="text-muted-foreground text-xs">{j.periods.find((x) => x.key === p.period)?.label ?? p.period}</div>
                <div>{fmtScore(p.overall)} <span className={`text-xs ${deltaTone(p.delta)}`}>{fmtDelta(p.delta)}</span></div>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">Skor komposit Raport 360 per periode; Δ = selisih dengan periode sebelumnya (tanpa ambang).</p>
        </CardContent>
      </Card>

      {j.employee && !hasActive ? <StartForm amId={amId} onDone={refresh} /> : null}
      {j.cases.map((c) => <PipCase key={c.id} id={c.id} onChanged={refresh} />)}
    </div>
  );
}
