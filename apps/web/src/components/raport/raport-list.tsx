"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PeriodPicker, defaultPeriod } from "@/components/raport/period-picker";

interface Row {
  am_id: string; nama: string; panggilan: string | null; role: string; cabang: string | null; is_am: boolean;
  overall: number | null; rating: string;
  compliance: number | null; bsc: number | null; revenue: number; revenue_pct: number | null;
  active_days: number; leave_days: number;
}
interface ListResp { period: string; rows: Row[] }

const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const scoreTone = (s: number | null) =>
  s == null ? "text-muted-foreground" : s >= 95 ? "text-emerald-600" : s >= 80 ? "text-amber-600" : "text-red-600";

export function RaportList() {
  const [period, setPeriod] = useState<string>(defaultPeriod());
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error" | "forbidden">("loading");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch daftar saat ganti periode; disengaja.
    setState("loading");
    fetch(`/api/raport/list?period=${period}`)
      .then(async (r) => {
        if (r.status === 403) return { forbidden: true } as const;
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as ListResp;
      })
      .then((d) => {
        if (!alive) return;
        if ("forbidden" in d) { setState("forbidden"); return; }
        setRows(d.rows ?? []);
        setState("idle");
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [period]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.nama.toLowerCase().includes(s) || (r.cabang ?? "").toLowerCase().includes(s) || r.role.toLowerCase().includes(s));
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nama / cabang / role…"
          className="bg-card border-border h-8 w-64 max-w-full"
        />
        <PeriodPicker period={period} onChange={setPeriod} />
      </div>

      {state === "forbidden" ? (
        <p className="text-muted-foreground">Hanya HoD/admin yang dapat melihat daftar raport karyawan.</p>
      ) : state === "error" ? (
        <p className="text-muted-foreground">Gagal memuat daftar.</p>
      ) : state === "loading" && !rows.length ? (
        <p className="text-muted-foreground text-sm">Memuat…</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs">
                <tr>
                  <th className="px-4 py-2">Karyawan</th>
                  <th className="px-4 py-2">Cabang</th>
                  <th className="px-4 py-2 text-right">Skor</th>
                  <th className="px-4 py-2">Rating</th>
                  <th className="px-4 py-2 text-right">Compliance</th>
                  <th className="px-4 py-2 text-right">BSC</th>
                  <th className="px-4 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.am_id} className="hover:bg-muted/50 border-b">
                    <td className="px-4 py-2">
                      <Link href={`/raport/karyawan/${encodeURIComponent(r.am_id)}`} className="font-medium hover:underline">
                        {r.panggilan || r.nama}
                      </Link>
                      <div className="text-muted-foreground text-xs">{r.nama} · {r.role}{r.is_am ? "" : " (non-AM)"}</div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{r.cabang ?? "—"}</td>
                    <td className={`px-4 py-2 text-right font-semibold tabular-nums ${scoreTone(r.overall)}`}>{r.overall ?? "—"}</td>
                    <td className="px-4 py-2"><Badge variant="outline" className={scoreTone(r.overall)}>{r.rating}</Badge></td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.compliance != null ? `${r.compliance}%` : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.bsc ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.is_am ? rp(r.revenue) : "—"}</td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr><td colSpan={7} className="text-muted-foreground px-4 py-6 text-center">Tidak ada data.</td></tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
