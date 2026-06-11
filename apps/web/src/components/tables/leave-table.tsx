"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { LeaveRowActions } from "@/components/crm/leave-row-actions";

interface Leave {
  id: string;
  am_id: string;
  start_date: string;
  end_date: string;
  jenis: string;
  keterangan: string | null;
  source: string;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const jenisTone = (j: string): "default" | "secondary" | "destructive" | "outline" =>
  j === "sakit" ? "destructive" : j === "cuti" ? "secondary" : "outline";
const clip = (s: string, n = 56) => (s.length > n ? `${s.slice(0, n)}…` : s);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const thisMonth = () => {
  const now = new Date();
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

export function LeaveTable({ leave, nameById }: { leave: Leave[]; nameById: Record<string, string> }) {
  const name = (id: string) => nameById[id] ?? id;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Filter rentang: tampilkan cuti yang periodenya BERIRISAN dengan [from,to].
  const filtered = useMemo(() => {
    if (!from && !to) return leave;
    return leave.filter((l) => (!to || l.start_date <= to) && (!from || l.end_date >= from));
  }, [leave, from, to]);

  const columns: DataColumn<Leave>[] = [
    { id: "karyawan", header: "Karyawan", sortable: true, accessor: (l) => name(l.am_id), cell: (l) => <span className="font-medium">{name(l.am_id)}</span> },
    { id: "jenis", header: "Jenis", sortable: true, accessor: (l) => l.jenis, cell: (l) => <Badge variant={jenisTone(l.jenis)}>{l.jenis}</Badge> },
    { id: "start", header: "Mulai", sortable: true, accessor: (l) => l.start_date, cell: (l) => <span className="text-muted-foreground whitespace-nowrap">{tgl(l.start_date)}</span> },
    { id: "end", header: "Selesai", sortable: true, accessor: (l) => l.end_date, cell: (l) => <span className="text-muted-foreground whitespace-nowrap">{tgl(l.end_date)}</span> },
    { id: "ket", header: "Keterangan", accessor: (l) => l.keterangan ?? "", cell: (l) => <span className="text-muted-foreground" title={l.keterangan ?? undefined}>{l.keterangan ? clip(l.keterangan) : "—"}</span> },
    { id: "source", header: "Sumber", sortable: true, accessor: (l) => l.source, cell: (l) => <Badge variant="outline">{l.source}</Badge> },
    { id: "aksi", header: "Aksi", align: "right", cell: (l) => <LeaveRowActions row={l} label={name(l.am_id)} /> },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="lv-from" className="text-muted-foreground text-xs">Dari</Label>
      <Input id="lv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" />
      <Label htmlFor="lv-to" className="text-muted-foreground text-xs">Sampai</Label>
      <Input id="lv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" />
      <Button variant="outline" size="sm" onClick={() => { const r = thisMonth(); setFrom(r.from); setTo(r.to); }}>Bulan ini</Button>
      {(from || to) && (
        <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Reset</Button>
      )}
    </div>
  );

  return (
    <DataTable columns={columns} data={filtered} getKey={(l) => l.id} searchPlaceholder="Cari karyawan / jenis…" pageSize={25} toolbar={toolbar} />
  );
}
