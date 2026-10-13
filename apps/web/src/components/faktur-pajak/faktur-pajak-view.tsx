"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import { AjukanDialog, DetailDialog } from "./dialogs";
import { STATUS_CLS, STATUS_LABEL, rupiah, tglId, type FpRow, type FpStatus, type Ringkasan } from "./types";

// F27 Faktur Pajak / CoreTax — daftar tracker FP. Data dari apps/api/src/repo/faktur-pajak.ts.
export function FakturPajakView({ items, ringkasan, bolehAjukan, bolehUbah }: {
  items: FpRow[]; ringkasan: Ringkasan; bolehAjukan: boolean; bolehUbah: boolean;
}) {
  const [status, setStatus] = useState("");
  const [masa, setMasa] = useState("");
  const [buka, setBuka] = useState<number | null>(null);
  const [ajukan, setAjukan] = useState(false);

  const masaOpsi = useMemo(() => [...new Set(items.map((i) => i.masa_pajak))].sort().reverse().map((m) => ({ value: m, label: m })), [items]);
  const data = useMemo(() => items.filter((i) => (!status || i.status === status) && (!masa || i.masa_pajak === masa)), [items, status, masa]);
  const aktif = ringkasan.per_status.diminta + ringkasan.per_status.diinput_coretax + ringkasan.per_status.disetujui;

  const kolom: DataColumn<FpRow>[] = [
    { id: "inv", header: "Invoice", sortable: true, accessor: (r) => r.invoice_number, cell: (r) => (
      <div><div className="font-medium">{r.invoice_number}</div><div className="text-muted-foreground text-xs">{tglId(r.tanggal_invoice)} · masa {r.masa_pajak}</div></div>) },
    { id: "cust", header: "Customer", sortable: true, accessor: (r) => r.customer_name ?? "", cell: (r) => (
      <div><div>{r.customer_name ?? "—"}</div><div className="text-muted-foreground text-xs">{r.customer_npwp ? `NPWP ${r.customer_npwp}` : "NPWP belum ada"}</div></div>) },
    { id: "ppn", header: "PPN", align: "right", sortable: true, accessor: (r) => r.ppn, searchable: false, cell: (r) => <span className="tabular-nums">{rupiah(r.ppn)}</span> },
    { id: "nomor", header: "Nomor FP", accessor: (r) => r.nomor_fp ?? "", cell: (r) => r.nomor_fp ?? <span className="text-muted-foreground">—</span> },
    { id: "batas", header: "Batas terbit", sortable: true, accessor: (r) => r.batas_terbit, cell: (r) => (
      <span className={cn("text-sm tabular-nums", r.terlambat && "font-medium text-rose-700 dark:text-rose-400")}>{tglId(r.batas_terbit)}{r.terlambat ? " · terlambat" : ""}</span>) },
    { id: "status", header: "Status", sortable: true, accessor: (r) => r.status, cell: (r) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[r.status])}>{STATUS_LABEL[r.status]}</span>) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {([["Berjalan", aktif], ["Terlambat", ringkasan.terlambat], ["Disetujui (tunggu bukti)", ringkasan.per_status.disetujui], ["Selesai", ringkasan.per_status.selesai]] as const).map(([l, n]) => (
            <div key={l} className="bg-card rounded-lg border p-3 shadow-[var(--shadow-card)]">
              <div className="text-muted-foreground text-xs">{l}</div><div className="mt-1 text-xl font-bold tabular-nums">{n}</div>
            </div>
          ))}
        </div>
        {bolehAjukan && <Button size="sm" onClick={() => setAjukan(true)}>Ajukan faktur pajak</Button>}
      </div>
      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={kolom} data={data} getKey={(r) => String(r.id)} pageSize={25}
            searchPlaceholder="Cari invoice / customer / nomor FP…" onRowClick={(r) => setBuka(r.id)}
            empty={items.length === 0 ? "Belum ada faktur pajak. Klik Ajukan faktur pajak untuk memilih invoice." : "Tidak ada yang cocok dengan filter."}
            toolbar={<div className="flex gap-2">
              <FilterSelect label="Status" value={status} onChange={setStatus}
                options={(Object.keys(STATUS_LABEL) as FpStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
              <FilterSelect label="Masa pajak" value={masa} onChange={setMasa} options={masaOpsi} />
            </div>}
          />
        </CardContent>
      </Card>
      {bolehAjukan && <AjukanDialog open={ajukan} onClose={() => setAjukan(false)} />}
      {buka != null && <DetailDialog key={buka} id={buka} onClose={() => setBuka(null)} bolehUbah={bolehUbah} />}
    </div>
  );
}
