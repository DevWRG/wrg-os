"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonLines } from "@/components/ui/loading";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_LABEL, fmtDelta, fmtScore, fmtSisaHari, fmtTgl, MILESTONE_LABEL, OUTCOME_LABEL, PIP_STATUS_LABEL, type PipStatus } from "@/components/karyawan/pip-format";

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
// Target diisi per baris (Target perbaikan + Ukuran berhasil) — dulu satu textarea
// berformat "goal | target" yang membingungkan pemakai.
function StartForm({ amId, onDone }: { amId: string; onDone: () => void }) {
  const [alasan, setAlasan] = useState("");
  const [mulai, setMulai] = useState(today());
  const [goals, setGoals] = useState<{ goal: string; target: string }[]>([{ goal: "", target: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ubah = (i: number, p: Partial<{ goal: string; target: string }>) => setGoals((l) => l.map((g, j) => (j === i ? { ...g, ...p } : g)));

  const submit = async () => {
    setBusy(true);
    const gl = goals.map((g) => ({ goal: g.goal.trim(), target: g.target.trim() })).filter((g) => g.goal);
    const e = await call("POST", "cases", { am_id: amId, alasan, start_date: mulai, goals: gl });
    setBusy(false);
    if (e) setErr(e); else onDone();
  };

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <h4 className="font-semibold">Mulai rencana perbaikan (90 hari)</h4>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Alasan</span>
          <span className="text-muted-foreground block text-xs">Kenapa karyawan ini perlu PIP — mis. skor Raport turun dua periode, target kunjungan tidak tercapai 3 bulan.</span>
          <Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Tanggal mulai</span>
          <span className="text-muted-foreground block text-xs">PIP berakhir otomatis 90 hari kemudian.</span>
          <Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} className="max-w-48" />
        </label>
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-medium">Target perbaikan</span>
            <span className="text-muted-foreground block text-xs">Apa yang harus membaik, dan bagaimana mengukurnya. Contoh: “Laporan kunjungan lengkap” — “≥ 90% tiap minggu”.</span>
          </div>
          {goals.map((g, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]">
              <Input placeholder="Target perbaikan" value={g.goal} onChange={(e) => ubah(i, { goal: e.target.value })} />
              <Input placeholder="Ukuran berhasil (opsional)" value={g.target} onChange={(e) => ubah(i, { target: e.target.value })} />
              {goals.length > 1
                ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Hapus baris" onClick={() => setGoals((l) => l.filter((_, j) => j !== i))}><Trash2 /></Button>
                : <span className="hidden sm:block sm:w-7" />}
            </div>
          ))}
          <Button type="button" size="sm" variant="soft" onClick={() => setGoals((l) => [...l, { goal: "", target: "" }])}><Plus /> Tambah target</Button>
        </div>
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
          <span className="font-medium">{fmtTgl(d.start_date)} – {fmtTgl(d.end_date)}</span>
          {aktif ? <span className="text-muted-foreground">{fmtSisaHari(d.days_left)}</span> : null}
        </div>
        <p><span className="text-muted-foreground">Alasan:</span> {d.alasan}</p>
        {d.outcome_note ? <p><span className="text-muted-foreground">Catatan hasil akhir:</span> {d.outcome_note}</p> : null}
        <Err msg={err} />

        <section className="space-y-1">
          <h5 className="font-semibold">Target perbaikan</h5>
          <ul className="list-disc pl-5">{d.goal_list.map((g) => <li key={g.id}>{g.goal}{g.target ? <span className="text-muted-foreground"> — ukuran berhasil: {g.target}</span> : null}</li>)}</ul>
          {aktif ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Input placeholder="Target perbaikan baru" value={goal.goal} onChange={(e) => setGoal({ ...goal, goal: e.target.value })} className="max-w-xs" />
              <Input placeholder="Ukuran berhasil (opsional)" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} className="max-w-xs" />
              <Button size="sm" variant="soft" onClick={() => run("POST", `cases/${id}/goals`, goal, () => setGoal({ goal: "", target: "" }))}>Tambah target</Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-1">
          <h5 className="font-semibold">Tahapan ({d.milestones_tercapai}/{d.milestones} tercapai)</h5>
          <p className="text-muted-foreground text-xs">Langkah antara dengan tenggat, supaya kemajuan terlihat sebelum 90 hari habis — mis. “Ikut pelatihan produk” sebelum minggu ke-3.</p>
          {d.milestone_list.length === 0 ? <p className="text-muted-foreground">Belum ada tahapan.</p> : null}
          {d.milestone_list.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2">
              <span>{m.judul}</span>
              <span className="text-muted-foreground">tenggat {fmtTgl(m.due_date)}</span>
              <Badge variant={m.status === "tercapai" ? "default" : m.status === "tidak_tercapai" ? "destructive" : "outline"}>{MILESTONE_LABEL[m.status] ?? m.status}</Badge>
              {m.terlambat ? <Badge variant="destructive">Terlambat</Badge> : null}
              {m.catatan ? <span className="text-muted-foreground">— {m.catatan}</span> : null}
              {aktif ? (
                <>
                  <Button size="xs" variant="soft" onClick={() => run("PATCH", `milestones/${m.id}`, { status: "tercapai" })}>Tercapai</Button>
                  <Button size="xs" variant="soft" onClick={() => {
                    const alasan = window.prompt("Alasan tahapan ini tidak tercapai:");
                    if (alasan) void run("PATCH", `milestones/${m.id}`, { status: "tidak_tercapai", catatan: alasan });
                  }}>Tidak tercapai</Button>
                  {m.status !== "belum" ? <Button size="xs" variant="ghost" onClick={() => run("PATCH", `milestones/${m.id}`, { status: "belum" })}>Buka lagi</Button> : null}
                </>
              ) : null}
            </div>
          ))}
          {aktif ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <Input placeholder="Tahapan baru" value={ms.judul} onChange={(e) => setMs({ ...ms, judul: e.target.value })} className="max-w-xs" />
              <Input type="date" value={ms.due} onChange={(e) => setMs({ ...ms, due: e.target.value })} className="max-w-44" />
              <Button size="sm" variant="soft" onClick={() => run("POST", `cases/${id}/milestones`, { judul: ms.judul, due_date: ms.due }, () => setMs({ judul: "", due: "" }))}>Tambah tahapan</Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-1">
          <h5 className="font-semibold">Evaluasi berkala ({d.checkins})</h5>
          <p className="text-muted-foreground text-xs">Catat hasil pertemuan atasan dengan karyawan (sebaiknya tiap minggu): apa yang sudah membaik, apa yang belum, dan langkah berikutnya.</p>
          {d.checkin_list.length === 0 ? <p className="text-muted-foreground">Belum ada evaluasi.</p> : null}
          {d.checkin_list.map((k) => (
            <p key={k.id}><span className="text-muted-foreground">Minggu ke-{k.week_no} · {fmtTgl(k.checkin_date)}{k.created_by ? ` · ${k.created_by}` : ""}:</span> {k.catatan}</p>
          ))}
          {aktif ? (
            <div className="space-y-2 pt-1">
              <Input type="date" max={today()} value={checkin.tanggal} onChange={(e) => setCheckin({ ...checkin, tanggal: e.target.value })} className="max-w-44" />
              <Textarea placeholder="Hasil evaluasi minggu ini" rows={2} value={checkin.catatan} onChange={(e) => setCheckin({ ...checkin, catatan: e.target.value })} />
              <Button size="sm" variant="soft" onClick={() => run("POST", `cases/${id}/checkins`, { checkin_date: checkin.tanggal, catatan: checkin.catatan }, () => setCheckin({ tanggal: today(), catatan: "" }))}>Simpan evaluasi</Button>
            </div>
          ) : null}
        </section>

        {aktif ? (
          <section className="space-y-2 border-t pt-3">
            <h5 className="font-semibold">Hasil akhir</h5>
            <p className="text-muted-foreground text-xs">Diisi di akhir 90 hari (atau lebih awal bila sudah jelas). Tercatat di riwayat dan tidak bisa diubah.</p>
            <div className="flex flex-wrap gap-2">
              <select className="border-input h-8 rounded-lg border bg-card px-2" value={outcome.outcome} onChange={(e) => setOutcome({ ...outcome, outcome: e.target.value })}>
                {(Object.keys(OUTCOME_LABEL) as (keyof typeof OUTCOME_LABEL)[]).map((k) => <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>)}
              </select>
              {outcome.outcome === "extend" ? <Input type="date" value={outcome.end_date} onChange={(e) => setOutcome({ ...outcome, end_date: e.target.value })} className="max-w-44" aria-label="Tanggal berakhir baru" title="Tanggal berakhir baru" /> : null}
            </div>
            <Textarea placeholder="Catatan hasil akhir (wajib) — dasar keputusan" rows={2} value={outcome.catatan} onChange={(e) => setOutcome({ ...outcome, catatan: e.target.value })} />
            <Button size="sm" variant={outcome.outcome === "terminate" ? "destructive" : "default"} onClick={() => {
              if (!window.confirm(`Catat hasil akhir: ${OUTCOME_LABEL[outcome.outcome as keyof typeof OUTCOME_LABEL]}? Tercatat di riwayat dan tidak bisa diubah.`)) return;
              void run("POST", `cases/${id}/outcome`, { outcome: outcome.outcome, catatan: outcome.catatan, end_date: outcome.outcome === "extend" ? outcome.end_date : undefined });
            }}>Catat hasil akhir</Button>
          </section>
        ) : null}

        <section className="space-y-1 border-t pt-3">
          <h5 className="font-semibold">Riwayat perubahan</h5>
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            {d.timeline.map((t, i) => <li key={i}>{fmtTgl(t.occurred_at)} {t.occurred_at.slice(11, 16)} · {EVENT_LABEL[t.event_type] ?? t.event_type}{t.actor ? ` · ${t.actor}` : ""}</li>)}
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
  if (state === "migration") return <p className="text-muted-foreground text-sm">Fitur PIP belum aktif: migrasi database (236) belum diterapkan.</p>;
  if (state === "error" || !j) return <p className="text-destructive text-sm">Perjalanan improvement tidak dapat dimuat.</p>;

  const hasActive = j.cases.some((c) => c.status === "aktif");
  const refresh = () => setRev((n) => n + 1);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Perkembangan &amp; Rencana Perbaikan Kinerja (PIP)</h3>
      <div className="flex gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
        <Info className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <p><span className="font-medium">PIP (Performance Improvement Plan)</span> adalah program 90 hari untuk karyawan yang kinerjanya di bawah harapan — tujuannya membantu memperbaiki, dengan target yang jelas.</p>
          <ol className="text-muted-foreground list-decimal space-y-0.5 pl-4">
            <li><span className="text-foreground">Mulai</span>: tulis alasannya dan target perbaikan beserta ukuran berhasilnya.</li>
            <li><span className="text-foreground">Selama 90 hari</span>: tetapkan tahapan bertenggat, lalu catat evaluasi berkala bersama karyawan.</li>
            <li><span className="text-foreground">Hasil akhir</span>: lulus, diperpanjang, atau tidak lulus — semua tercatat di riwayat.</li>
          </ol>
        </div>
      </div>
      <Card>
        <CardContent className="space-y-2 py-4 text-sm">
          {j.employee ? (
            <p><span className="font-medium">{j.employee.nama}</span> <span className="text-muted-foreground">· {j.employee.role ?? "–"}{j.employee.dept_label ? ` · ${j.employee.dept_label}` : ""}{j.employee.cabang ? ` · ${j.employee.cabang}` : ""}</span></p>
          ) : (
            <p className="text-muted-foreground">Karyawan ini belum tertaut ke profil karyawan — PIP belum bisa dimulai. Tautkan dulu lewat Kelola Profil.</p>
          )}
          <div className="flex flex-wrap gap-4">
            {j.series.map((p) => (
              <div key={p.period} className="tabular-nums">
                <div className="text-muted-foreground text-xs">{j.periods.find((x) => x.key === p.period)?.label ?? p.period}</div>
                <div>{fmtScore(p.overall)} <span className={`text-xs ${deltaTone(p.delta)}`}>{fmtDelta(p.delta)}</span></div>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">Skor gabungan Raport 360 per periode. Angka kecil di sebelahnya = naik (+) atau turun (−) dibanding periode sebelumnya.</p>
        </CardContent>
      </Card>

      {j.employee && !hasActive ? <StartForm amId={amId} onDone={refresh} /> : null}
      {j.cases.map((c) => <PipCase key={c.id} id={c.id} onChanged={refresh} />)}
    </div>
  );
}
