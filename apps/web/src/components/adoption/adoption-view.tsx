"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Info, Lock, RefreshCw, UserCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { httpFailure } from "@/lib/http-error";

// ── Tipe (cermin apps/api/src/repo/adoption.ts) ────────────────────────────
type Label = "champion" | "laggard" | "normal" | "baru";
interface Period { kind: "month" | "rolling30"; from: string; to: string; label: string; month: string | null }
interface Meta { empty: boolean; insufficient: boolean; partial: boolean; tracking_since: string | null; period: Period; audience: "all" | "team" }
interface FeatureSummary {
  feature_key: string; feature_name: string; eligible: number; champions: number; laggards: number; baru: number;
  actions: number; views: number; top: string[];
}
interface Row {
  user_id: string; feature_key: string; feature_name: string; name: string | null; email: string; title: string;
  cabang: string | null; actions: number; views: number; label: Label; peer_size: number; on_leave: boolean;
}
interface Summary extends Meta { features: FeatureSummary[] }
interface Training extends Meta { total: number; rows: Row[] }

type Phase =
  | { s: "loading" }
  | { s: "error"; message: string }
  | { s: "denied"; message: string }
  | { s: "pending" } // migrasi 212 belum diterapkan (503 migration_pending)
  | { s: "ok"; summary: Summary; training: Training };

const nowMonth = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7); // WIB, selaras server
const fmt = (n: number) => n.toLocaleString("id-ID");
const tgl = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }) : "—");

const LABEL: Record<Label, { text: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  champion: { text: "Champion", variant: "default" },
  laggard: { text: "Perlu training", variant: "destructive" },
  normal: { text: "Normal", variant: "secondary" },
  baru: { text: "Baru", variant: "outline" },
};

export function AdoptionView() {
  const [mode, setMode] = useState<"month" | "rolling30">("month");
  const [month, setMonth] = useState(nowMonth());
  const [result, setResult] = useState<{ key: string; phase: Phase } | null>(null);
  const [tick, setTick] = useState(0);
  // "loading" diturunkan: hasil yang tersimpan milik permintaan lain (atau belum ada) = sedang memuat.
  const key = `${mode}|${month}|${tick}`;
  const phase: Phase = result && result.key === key ? result.phase : { s: "loading" };

  const load = useCallback(async (signal: AbortSignal) => {
    const setPhase = (p: Phase) => { if (!signal.aborted) setResult({ key, phase: p }); };
    const qs = new URLSearchParams({ period: mode });
    if (mode === "month") qs.set("month", month);
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/adoption/summary?${qs}`, { signal }),
        fetch(`/api/adoption/training-needs?${qs}`, { signal }),
      ]);
      for (const res of [a, b]) {
        if (res.ok) continue;
        if (res.status === 401) return setPhase({ s: "denied", message: "Sesi berakhir, silakan masuk lagi." });
        if (res.status === 403) return setPhase({ s: "denied", message: "Anda tidak berwenang melihat data ini. Bila Anda HoD, minta admin mengatur wilayah tim Anda." });
        if (res.status === 503) {
          const body = (await res.clone().json().catch(() => ({}))) as { error?: string };
          if (body.error === "migration_pending") return setPhase({ s: "pending" });
        }
        return setPhase({ s: "error", message: (await httpFailure(res, "gagal memuat adopsi fitur")).message });
      }
      setPhase({ s: "ok", summary: (await a.json()) as Summary, training: (await b.json()) as Training });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setPhase({ s: "error", message: "Tidak dapat menghubungi server." });
    }
  }, [mode, month, key]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, tick]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "month" ? "default" : "outline"} onClick={() => setMode("month")}>Per bulan</Button>
          <Button size="sm" variant={mode === "rolling30" ? "default" : "outline"} onClick={() => setMode("rolling30")}>30 hari terakhir</Button>
        </div>
        {mode === "month" ? (
          <Input
            type="month" value={month} max={nowMonth()} aria-label="Bulan"
            className="w-44"
            onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setMonth(e.target.value); }}
          />
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setTick((t) => t + 1)} disabled={phase.s === "loading"}>
          <RefreshCw className="size-4" /> Muat ulang
        </Button>
      </div>

      <Body phase={phase} retry={() => setTick((t) => t + 1)} />
    </div>
  );
}

function Notice({ icon: Icon, children }: { icon: typeof Info; children: React.ReactNode }) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <Icon className="mt-0.5 size-4 shrink-0" /> <div>{children}</div>
    </div>
  );
}

function Body({ phase, retry }: { phase: Phase; retry: () => void }) {
  if (phase.s === "loading") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }
  if (phase.s === "denied") return <EmptyState icon={Lock} title="Akses ditolak" description={phase.message} />;
  if (phase.s === "pending") {
    return <EmptyState icon={AlertTriangle} title="Fitur belum siap" description="Migrasi database F58 (212_feature_usage_event.sql) belum diterapkan di environment ini." />;
  }
  if (phase.s === "error") {
    return (
      <EmptyState
        icon={AlertTriangle} title="Gagal memuat" description={phase.message}
        action={<Button size="sm" variant="outline" onClick={retry}>Coba lagi</Button>}
      />
    );
  }

  const { summary, training } = phase;
  if (summary.empty) {
    return <EmptyState icon={Info} title="Belum ada data pemakaian" description="Pencatatan dimulai sejak F58 aktif. Data muncul setelah user memakai fitur." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {summary.audience === "team" ? <Notice icon={Info}>Menampilkan tim Anda saja.</Notice> : null}
      <Notice icon={Info}>
        Pencatatan dimulai {tgl(summary.tracking_since)}. Periode: {summary.period.label}.
        {summary.partial ? " Sebagian periode ini belum tercatat (data baru), angka bisa lebih rendah dari kenyataan." : ""}
      </Notice>
      {summary.insufficient ? (
        <Notice icon={AlertTriangle}>Data pemakaian belum cukup (kurang dari 7 hari), jadi belum ada yang ditandai &quot;perlu training&quot;.</Notice>
      ) : null}
      <Tabs defaultValue="ringkasan">
        <TabsList>
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="training">Perlu Training ({fmt(training.total)})</TabsTrigger>
        </TabsList>
        <TabsContent value="ringkasan"><RingkasanTab rows={summary.features} /></TabsContent>
        <TabsContent value="training"><TrainingTab t={training} /></TabsContent>
      </Tabs>
    </div>
  );
}

function RingkasanTab({ rows }: { rows: FeatureSummary[] }) {
  const cols: DataColumn<FeatureSummary>[] = [
    { id: "fitur", header: "Fitur", sortable: true, accessor: (r) => r.feature_name, cell: (r) => <span className="font-medium">{r.feature_name}</span> },
    { id: "eligible", header: "Berizin", align: "right", sortable: true, accessor: (r) => r.eligible, searchable: false, cell: (r) => fmt(r.eligible) },
    { id: "champions", header: "Champion", align: "right", sortable: true, accessor: (r) => r.champions, searchable: false, cell: (r) => fmt(r.champions) },
    { id: "laggards", header: "Perlu training", align: "right", sortable: true, accessor: (r) => r.laggards, searchable: false, cell: (r) => fmt(r.laggards) },
    { id: "baru", header: "Baru", align: "right", accessor: (r) => r.baru, searchable: false, cell: (r) => fmt(r.baru) },
    { id: "actions", header: "Aksi", align: "right", sortable: true, accessor: (r) => r.actions, searchable: false, cell: (r) => fmt(r.actions) },
    { id: "views", header: "Dibuka", align: "right", sortable: true, accessor: (r) => r.views, searchable: false, cell: (r) => fmt(r.views) },
    { id: "top", header: "Champion teratas", accessor: (r) => r.top.join(", "), cell: (r) => (r.top.length ? r.top.join(", ") : <span className="text-muted-foreground">—</span>) },
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Per fitur</CardTitle></CardHeader>
      <CardContent>
        <DataTable
          columns={cols} data={rows} getKey={(r) => r.feature_key} searchPlaceholder="Cari fitur…"
          empty="Belum ada fitur yang bisa dinilai. Pastikan matriks Akses Grup memberi izin tulis (buat/ubah/hapus)."
        />
        <p className="text-muted-foreground mt-2 text-xs">
          Champion dan &quot;perlu training&quot; dinilai dari Aksi (menyimpan/mengubah data), bukan dari Dibuka. Hanya user yang berizin tulis pada fitur itu yang dihitung.
        </p>
      </CardContent>
    </Card>
  );
}

function TrainingTab({ t }: { t: Training }) {
  const cols: DataColumn<Row>[] = [
    { id: "nama", header: "Nama", sortable: true, accessor: (r) => r.name ?? r.email, cell: (r) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{r.name ?? r.email}</span>
        {r.on_leave ? <Badge variant="outline">Cuti</Badge> : null}
      </div>
    ) },
    { id: "jabatan", header: "Jabatan", sortable: true, accessor: (r) => r.title },
    { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => r.cabang ?? "—" },
    { id: "fitur", header: "Fitur", sortable: true, accessor: (r) => r.feature_name },
    { id: "actions", header: "Aksi", align: "right", sortable: true, accessor: (r) => r.actions, searchable: false, cell: (r) => fmt(r.actions) },
    { id: "views", header: "Dibuka", align: "right", sortable: true, accessor: (r) => r.views, searchable: false, cell: (r) => fmt(r.views) },
    { id: "peer", header: "Pembanding", align: "right", accessor: (r) => r.peer_size, searchable: false, cell: (r) => (
      <span title={r.peer_size < 3 ? "Pembanding kurang dari 3 orang" : undefined}>{fmt(r.peer_size)}{r.peer_size < 3 ? " ⓘ" : ""}</span>
    ) },
    { id: "status", header: "Status", accessor: (r) => LABEL[r.label].text, searchable: false, cell: (r) => <Badge variant={LABEL[r.label].variant}>{LABEL[r.label].text}</Badge> },
  ];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Daftar perlu training</CardTitle></CardHeader>
      <CardContent>
        {t.total === 0 ? (
          <EmptyState icon={UserCheck} title="Tidak ada yang perlu training" description={t.insufficient ? "Data pemakaian belum cukup untuk menilai." : "Semua user berizin sudah memakai fitur mereka."} />
        ) : (
          <>
            {t.rows.length < t.total ? <p className="text-muted-foreground mb-2 text-xs">Menampilkan {fmt(t.rows.length)} dari {fmt(t.total)} (aksi paling sedikit lebih dulu).</p> : null}
            <DataTable columns={cols} data={t.rows} getKey={(r) => `${r.user_id}:${r.feature_key}`} searchPlaceholder="Cari nama, jabatan, fitur…" />
            <p className="text-muted-foreground mt-2 text-xs">Laggard = berizin menulis tetapi aksinya nol atau sangat jarang pada periode ini. Yang bertanda Cuti tetap ditampilkan agar HR yang menilai.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
