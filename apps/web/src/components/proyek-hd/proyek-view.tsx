"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calculator, Plus, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

import { ParamDialog } from "./param-dialog";
import { TambahProyekDialog } from "./tambah-proyek-dialog";
import { bulan, kirim, RAG_KELAS, rpRingkas, type Proyek, type Ringkasan } from "./types";

// Dashboard Proyek HD: KPI (dihitung SQL atas semua proyek), posisi per tahap (klik =
// saring tabel), dan daftar proyek. Data dimuat di klien lewat BFF berizin.
export function ProyekView({ bolehBuat, bolehParam }: { bolehBuat: boolean; bolehParam: boolean }) {
  const router = useRouter();
  const [ring, setRing] = useState<Ringkasan | null>(null);
  const [items, setItems] = useState<Proyek[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tahap, setTahap] = useState<string | null>(null);
  const [tambah, setTambah] = useState(0);
  const [param, setParam] = useState(false);

  const [versi, setVersi] = useState(0);
  const muat = useCallback(() => setVersi((v) => v + 1), []);
  useEffect(() => {
    let batal = false;
    Promise.all([kirim<Ringkasan>("/api/proyek-hd/ringkasan"), kirim<{ items: Proyek[] }>("/api/proyek-hd")])
      .then(([r, l]) => { if (!batal) { setRing(r); setItems(l.items); setErr(null); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [versi]);

  const rows = useMemo(() => (items ?? []).filter((p) => !tahap || p.tahap_kode === tahap), [items, tahap]);

  const columns: DataColumn<Proyek>[] = [
    { id: "nama_rs", header: "Customer / RS", sortable: true, searchable: true, accessor: (p) => `${p.nama_rs} ${p.kode}`,
      cell: (p) => (
        <div className="min-w-0">
          <div className="font-medium">{p.nama_rs}</div>
          <div className="text-muted-foreground text-xs">{[p.kode, p.tipe_proyek, p.kota].filter(Boolean).join(" · ")}</div>
        </div>
      ) },
    { id: "tahap", header: "Tahap", sortable: true, accessor: (p) => p.progres_pct,
      cell: (p) => (
        <div className="min-w-32 space-y-1">
          <div className="text-sm">{p.tahap_kode} · {p.tahap_nama}</div>
          <div className="bg-primary/15 h-1.5 overflow-hidden rounded-full"><div className="bg-primary h-1.5" style={{ width: `${p.progres_pct}%` }} /></div>
        </div>
      ) },
    { id: "unit", header: "Unit KSO / terinstal / running", align: "right", accessor: (p) => p.unit_kso,
      cell: (p) => `${p.unit_kso} / ${p.unit_terinstal} / ${p.unit_running}` },
    { id: "status_rag", header: "Status", sortable: true, accessor: (p) => p.status_rag,
      cell: (p) => <Badge className={RAG_KELAS[p.status_rag]}>{p.status_rag}</Badge> },
    { id: "golive", header: "Go-live", sortable: true, accessor: (p) => p.target_golive ?? "", cell: (p) => bulan(p.target_golive) },
    { id: "pic", header: "PIC", sortable: true, searchable: true, accessor: (p) => p.pic_nama ?? "", cell: (p) => p.pic_nama ?? "—" },
    { id: "next", header: "Langkah berikutnya", searchable: true, accessor: (p) => p.next_action ?? "",
      cell: (p) => <span className="line-clamp-2 text-sm">{p.next_action ?? "—"}</span> },
  ];

  const k = ring?.kpi;
  const kpi = k ? [
    { label: "Proyek on hand", nilai: String(k.proyek) },
    { label: "Unit KSO", nilai: String(k.kso), sub: `${k.terinstal} terinstal · ${k.kurang} kurang` },
    { label: "Unit running", nilai: String(k.running), sub: `${k.idle} idle (terinstal, belum jalan)` },
    { label: "Rasio running : idle", nilai: k.rasio == null ? "–" : `${k.rasio.toLocaleString("id-ID", { maximumFractionDigits: 1 })} : 1`,
      sub: k.target_rasio == null ? undefined : `Target ${k.target_rasio} : 1` },
    { label: "Kebutuhan dana mesin", nilai: rpRingkas(k.dana), sub: "di luar konstruksi" },
    { label: "Proyeksi omset / bln", nilai: k.omset == null ? "—" : rpRingkas(k.omset), sub: k.omset == null ? "tarif per tindakan belum diisi di Parameter" : "bila semua target tindakan tercapai" },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {bolehBuat && <Button onClick={() => setTambah((n) => n + 1)}><Plus />Tambah proyek</Button>}
        <Link href="/proyek-hd/simulator" className={buttonVariants({ variant: "soft" })}><Calculator />Simulator HD</Link>
        {bolehParam && <Button variant="soft" onClick={() => setParam(true)}><SlidersHorizontal />Parameter</Button>}
      </div>

      {err && <p className="text-destructive text-sm">{err}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(k ? kpi : Array.from({ length: 6 }, () => ({ label: "…", nilai: "…", sub: undefined }))).map((c, i) => (
          <Card key={i} className="gap-1 py-4">
            <CardContent className="space-y-1 px-4">
              <div className="text-muted-foreground text-xs font-medium">{c.label}</div>
              <div className="text-2xl font-semibold tracking-tight">{c.nilai}</div>
              {c.sub && <div className="text-muted-foreground text-xs">{c.sub}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Posisi RS per tahap</CardTitle>
          <span className="text-muted-foreground text-xs">Klik tahap untuk menyaring tabel · DED paling menentukan</span>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {(ring?.tahap ?? []).map((t) => {
            const on = tahap === t.kode;
            return (
              <button key={t.kode} type="button" aria-pressed={on} onClick={() => setTahap(on ? null : t.kode)}
                className={cn("flex min-h-20 flex-col items-start gap-1 rounded-lg border-2 p-2.5 text-left transition",
                  on ? "border-primary bg-primary text-primary-foreground"
                    : t.kode === "3" ? "border-destructive/60 bg-card hover:border-destructive" : "bg-card hover:border-foreground/30")}>
                <span className="text-xs font-bold opacity-80">{t.kode}</span>
                <span className="text-xs leading-tight font-semibold">{t.nama.replace(" — konstruksi", "")}</span>
                <span className="text-xl font-bold">{t.jumlah}</span>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Daftar proyek{tahap ? ` · tahap ${tahap}` : ""}</CardTitle>
          {tahap && <Button size="sm" variant="outline" onClick={() => setTahap(null)}>Semua tahap</Button>}
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={rows} getKey={(p) => String(p.id)} pageSize={10}
            searchPlaceholder="Cari RS, kode, PIC…" empty={items ? "Belum ada proyek." : "Memuat…"}
            onRowClick={(p) => router.push(`/proyek-hd/${p.id}`)} initialSort={{ id: "nama_rs", dir: "asc" }} />
        </CardContent>
      </Card>

      {tambah > 0 && <TambahProyekDialog key={tambah} open onClose={() => setTambah(0)} onSaved={(id) => router.push(`/proyek-hd/${id}`)} />}
      {param && <ParamDialog open onClose={() => { setParam(false); muat(); }} />}
    </div>
  );
}
