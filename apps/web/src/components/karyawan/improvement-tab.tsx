"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SkeletonTable } from "@/components/ui/loading";
import { fmtDelta, fmtScore, fmtSisaHari, PIP_STATUS_LABEL, type PipStatus } from "@/components/karyawan/pip-format";

// F70 — tab "Improvement" di Karyawan 360: perubahan skor Raport antar periode per karyawan,
// plus penanda PIP aktif. Izin = fitur 'karyawan' (bukan menu baru). Detail & aksi PIP ada di
// halaman drilldown karyawan (PipPanel).

interface Point { period: string; overall: number | null; delta: number | null }
interface Row {
  am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null; has_spine: boolean;
  series: Point[]; delta: number | null; pip: { id: number; start_date: string; end_date: string } | null;
}
interface Imp { periods: { key: string; label: string }[]; rows: Row[] }
interface CaseRow {
  id: number; am_id: string | null; nama: string; start_date: string; end_date: string; status: PipStatus; days_left: number | null;
  goals: number; milestones: number; milestones_tercapai: number; checkins: number; last_checkin: string | null;
}

const deltaTone = (d: number | null) => (d == null || d === 0 ? "text-muted-foreground" : d > 0 ? "text-emerald-600" : "text-red-600");

export function ImprovementTab() {
  const [imp, setImp] = useState<Imp | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [state, setState] = useState<"loading" | "idle" | "error" | "forbidden" | "migration">("loading");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([fetch("/api/pip/improvement"), fetch("/api/pip/cases")])
      .then(async ([a, b]) => {
        if (a.status === 403 || b.status === 403) { if (alive) setState("forbidden"); return; }
        if (b.status === 503) { if (alive) setState("migration"); return; }
        if (!a.ok || !b.ok) throw new Error("gagal");
        const [i, c] = await Promise.all([a.json() as Promise<Imp>, b.json() as Promise<CaseRow[]>]);
        if (!alive) return;
        setImp(i); setCases(c); setState("idle");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = imp?.rows ?? [];
    return s ? all.filter((r) => r.nama.toLowerCase().includes(s) || (r.cabang ?? "").toLowerCase().includes(s) || r.role.toLowerCase().includes(s)) : all;
  }, [imp, q]);

  if (state === "loading") return <SkeletonTable />;
  if (state === "forbidden") return <p className="text-muted-foreground text-sm">Anda tidak punya akses ke data ini.</p>;
  if (state === "migration") return <p className="text-muted-foreground text-sm">Fitur PIP belum aktif: migrasi database (234) belum diterapkan.</p>;
  if (state === "error" || !imp) return <p className="text-destructive text-sm">Data improvement tidak dapat dimuat.</p>;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">PIP</h3>
        {cases.length === 0 ? (
          <p className="text-muted-foreground text-sm">Belum ada PIP tercatat. PIP dimulai dari halaman detail karyawan.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {cases.map((c) => (
              <Card key={c.id}>
                <CardContent className="space-y-1 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{c.nama}</span>
                    <Badge variant={c.status === "aktif" ? "default" : c.status === "terminate" ? "destructive" : "secondary"}>{PIP_STATUS_LABEL[c.status]}</Badge>
                  </div>
                  <div className="text-muted-foreground">{c.start_date} → {c.end_date}{c.days_left != null ? ` · ${fmtSisaHari(c.days_left)}` : ""}</div>
                  <div className="text-muted-foreground">
                    {c.goals} goal · milestone {c.milestones_tercapai}/{c.milestones} · {c.checkins} check-in{c.last_checkin ? ` (terakhir ${c.last_checkin})` : ""}
                  </div>
                  {c.am_id ? <Link href={`/karyawan/${encodeURIComponent(c.am_id)}`} className="text-primary hover:underline">Buka detail</Link> : <span className="text-muted-foreground">Belum tertaut ke Raport (am_id)</span>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Perubahan skor Raport antar periode</h3>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / cabang / jabatan" className="max-w-xs" />
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Karyawan</th>
                {imp.periods.map((p) => <th key={p.key} className="px-3 py-2 text-right whitespace-nowrap">{p.label}</th>)}
                <th className="px-3 py-2 text-right whitespace-nowrap">Δ terakhir</th>
                <th className="px-3 py-2">PIP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.am_id} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/karyawan/${encodeURIComponent(r.am_id)}`} className="text-primary font-medium hover:underline">{r.panggilan || r.nama}</Link>
                    <div className="text-muted-foreground text-xs">{r.role}{r.cabang ? ` · ${r.cabang}` : ""}</div>
                  </td>
                  {r.series.map((p) => (
                    <td key={p.period} className="px-3 py-2 text-right tabular-nums">
                      {fmtScore(p.overall)}
                      <div className={`text-xs ${deltaTone(p.delta)}`}>{fmtDelta(p.delta)}</div>
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${deltaTone(r.delta)}`}>{fmtDelta(r.delta)}</td>
                  <td className="px-3 py-2">
                    {r.pip ? <Badge>Aktif · s/d {r.pip.end_date}</Badge> : <span className="text-muted-foreground">–</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={imp.periods.length + 3} className="text-muted-foreground px-3 py-6 text-center">Tidak ada karyawan.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">Δ = skor periode ini dikurangi periode sebelumnya (skor komposit Raport 360). Kosong (–) bila salah satu periode belum punya skor. Tanpa ambang penilaian.</p>
      </section>
    </div>
  );
}
