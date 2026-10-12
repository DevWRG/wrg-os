"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import { LeadDialog, TambahLeadDialog } from "./lead-dialog";
import { BANT_LOLOS, STATUS_CLS, STATUS_LABEL, SUMBER_LABEL, type AmOpsi, type Lead, type StatusLead, type SumberLead } from "./types";

type Kartu = "baru" | "basi" | "dihubungi" | "siap" | "dikonversi";
const KARTU: { k: Kartu; l: string; cocok: (l: Lead) => boolean; cls: string }[] = [
  { k: "baru", l: "Baru", cocok: (l) => l.status === "baru", cls: STATUS_CLS.baru },
  { k: "basi", l: "Perlu ditindaklanjuti", cocok: (l) => l.basi != null, cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  { k: "dihubungi", l: "Dihubungi", cocok: (l) => l.status === "dihubungi", cls: STATUS_CLS.dihubungi },
  { k: "siap", l: "Siap dikonversi", cocok: (l) => (l.status === "baru" || l.status === "dihubungi") && l.bant_skor >= BANT_LOLOS, cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
  { k: "dikonversi", l: "Jadi deal", cocok: (l) => l.status === "dikonversi", cls: STATUS_CLS.dikonversi },
];

// F65 Leads — daftar + kartu ringkasan. Data dari apps/api/src/repo/lead.ts
// (sudah di-scope server; hari kerja & status basi dihitung di sana).
export function LeadsView({ leads, amOpsi, bolehTambah, bolehUbah }: { leads: Lead[]; amOpsi: AmOpsi[]; bolehTambah: boolean; bolehUbah: boolean }) {
  const [kartu, setKartu] = useState<Kartu | "">("");
  const [status, setStatus] = useState("");
  const [sumber, setSumber] = useState("");
  const [am, setAm] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const [tambah, setTambah] = useState({ open: false, n: 0 });

  const amDiData = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) if (l.am_id) m.set(l.am_id, l.am_nama ?? l.am_id);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [leads]);

  const data = useMemo(() => leads.filter((l) =>
    (!kartu || KARTU.find((k) => k.k === kartu)!.cocok(l))
    && (!status ? l.status === "baru" || l.status === "dihubungi" || kartu === "dikonversi" : status === "SEMUA" || l.status === status)
    && (!sumber || l.source === sumber)
    && (!am || (am === "-" ? !l.am_id : l.am_id === am))), [leads, kartu, status, sumber, am]);

  const columns: DataColumn<Lead>[] = [
    { id: "faskes", header: "Faskes", sortable: true, accessor: (r) => r.facility_name, cell: (r) => (
      <div><div className="font-medium">{r.facility_name}</div>
        <div className="text-muted-foreground text-xs">{[r.kode, r.city].filter(Boolean).join(" · ")}</div></div>) },
    { id: "butuh", header: "Kebutuhan", accessor: (r) => r.kebutuhan ?? "", cell: (r) => (
      <span className="line-clamp-2 max-w-xs text-sm">{r.kebutuhan ?? <span className="text-muted-foreground">—</span>}</span>) },
    { id: "bant", header: "BANT", align: "center", sortable: true, accessor: (r) => r.bant_skor, cell: (r) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        r.bant_skor >= BANT_LOLOS ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300")}>{r.bant_skor}/4</span>) },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => (
      <div><span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[r.status])}>{STATUS_LABEL[r.status]}</span>
        {r.basi && <div className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">{r.hari_kerja_baru} hari kerja</div>}</div>) },
    { id: "am", header: "AM", sortable: true, accessor: (r) => r.am_nama ?? "", cell: (r) => r.am_nama
      ? <div><div className="text-sm">{r.am_nama}</div><div className="text-muted-foreground text-xs">{r.cabang}</div></div>
      : <div><div className="text-sm text-amber-700 dark:text-amber-400">Belum ada AM</div><div className="text-muted-foreground text-xs">{r.cabang ?? "cabang belum terpetakan"}</div></div> },
    { id: "sumber", header: "Sumber", sortable: true, accessor: (r) => r.source, cell: (r) => <span className="text-sm">{SUMBER_LABEL[r.source]}</span> },
    { id: "masuk", header: "Masuk", sortable: true, accessor: (r) => r.created_at, cell: (r) => (
      <span className="text-sm tabular-nums">{new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" }).format(new Date(r.created_at))}</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Dari WhatsApp: <code>#LEADS nama faskes, kota: kebutuhan</code>. Lead berstatus Baru diingatkan ke AM setelah 3 hari kerja dan ke HoD setelah 7.
        </p>
        {bolehTambah && <Button size="sm" onClick={() => setTambah({ open: true, n: tambah.n + 1 })}>Tambah lead</Button>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {KARTU.map((k) => (
          <button key={k.k} type="button" onClick={() => setKartu(kartu === k.k ? "" : k.k)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", kartu === k.k && "border-primary-dark ring-2 ring-primary/30")}>
            <div className="text-muted-foreground text-xs">{k.l}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", k.cls)}>{leads.filter(k.cocok).length}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data}
            getKey={(r) => r.id}
            searchPlaceholder="Cari faskes / kode lead…"
            pageSize={25}
            onRowClick={(r) => setBuka(r.id)}
            empty={leads.length === 0 ? "Belum ada lead. Kirim #LEADS dari WhatsApp atau klik Tambah lead." : "Tidak ada lead yang cocok dengan filter."}
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                <FilterSelect label="Status" value={status} onChange={setStatus} semua="Baru & dihubungi"
                  options={[{ value: "SEMUA", label: "Semua status" }, ...(Object.keys(STATUS_LABEL) as StatusLead[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
                <FilterSelect label="Sumber" value={sumber} onChange={setSumber}
                  options={(Object.keys(SUMBER_LABEL) as SumberLead[]).map((s) => ({ value: s, label: SUMBER_LABEL[s] }))} />
                <FilterSelect label="AM" value={am} onChange={setAm} options={[{ value: "-", label: "Belum ada AM" }, ...amDiData]} />
              </div>
            }
          />
        </CardContent>
      </Card>

      <LeadDialog id={buka} onClose={() => setBuka(null)} amOpsi={amOpsi} bolehUbah={bolehUbah} />
      <TambahLeadDialog key={tambah.n} open={tambah.open} onClose={() => setTambah({ ...tambah, open: false })} amOpsi={amOpsi} />
    </div>
  );
}
