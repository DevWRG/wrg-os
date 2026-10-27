"use client";

import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ExportButton, type ExportColumn } from "@/components/ui/export-button";
import { cn } from "@/lib/utils";

import { DocDetailDialog } from "./doc-detail-dialog";
import { KETERANGAN_STATE, LABEL_STATE, STATES, ambil, rp, type DocRow, type DocState, type DocTrackerList } from "./types";

type Saring = "semua" | "dikirim_belum_dibayar" | "billing" | "anomali";

const LABEL_SARING: Record<Exclude<Saring, "semua">, string> = {
  dikirim_belum_dibayar: "Dikirim, belum dibayar",
  billing: "Berisiko ditagih",
  anomali: "Dokumen kurang",
};

const kolom: DataColumn<DocRow>[] = [
  { id: "so", header: "Sales Order", sortable: true, accessor: (r) => r.so_number },
  { id: "customer", header: "Customer", sortable: true, accessor: (r) => r.customer },
  {
    id: "state", header: "State", sortable: true, accessor: (r) => STATES.indexOf(r.state),
    cell: (r) => <Badge variant={r.state === "closed" ? "outline" : "secondary"}>{LABEL_STATE[r.state]}</Badge>,
  },
  {
    id: "kirim", header: "Pengiriman", searchable: false,
    accessor: (r) => r.hitungan.bast,
    cell: (r) => (r.hitungan.sj === 0 ? "—" : <span className="whitespace-nowrap text-xs tabular-nums">SJ {r.hitungan.sj} · kirim {r.hitungan.kirim} · BAST {r.hitungan.bast}</span>),
  },
  {
    id: "faktur", header: "Faktur", searchable: false, accessor: (r) => r.hitungan.faktur,
    cell: (r) => (r.hitungan.faktur === 0 ? "—" : <span className="whitespace-nowrap text-xs tabular-nums">{r.hitungan.faktur} · lunas {r.hitungan.lunas}</span>),
  },
  {
    id: "umur", header: "Umur di state", align: "right", sortable: true, searchable: false, accessor: (r) => r.umur_hari ?? -1,
    cell: (r) => (r.umur_hari == null ? "—" : <span className="tabular-nums">{r.umur_hari} hari</span>),
  },
  {
    id: "peringatan", header: "Peringatan", searchable: false, accessor: (r) => r.anomali.length + (r.billing_risiko ? 1 : 0),
    cell: (r) => (
      <span className="flex flex-wrap gap-1">
        {r.billing_risiko && <Badge variant="destructive">Berisiko ditagih</Badge>}
        {r.dikirim_belum_dibayar && <Badge variant="secondary">Belum dibayar</Badge>}
        {r.anomali.length > 0 && <Badge variant="outline" className="border-amber-500 text-amber-700">{r.anomali.length} dokumen kurang</Badge>}
      </span>
    ),
  },
  { id: "tanggal", header: "Tgl SO", sortable: true, searchable: false, accessor: (r) => r.tanggal },
  { id: "total", header: "Nilai SO", align: "right", sortable: true, searchable: false, accessor: (r) => r.total ?? 0, cell: (r) => rp(r.total) },
];

const kolomExport: ExportColumn<DocRow>[] = [
  { header: "Sales Order", value: (r) => r.so_number },
  { header: "Customer", value: (r) => r.customer },
  { header: "Tgl SO", value: (r) => r.tanggal },
  { header: "State", value: (r) => LABEL_STATE[r.state] },
  { header: "Umur di state (hari)", value: (r) => r.umur_hari },
  { header: "SJ", value: (r) => r.hitungan.sj },
  { header: "BAST", value: (r) => r.hitungan.bast },
  { header: "Faktur", value: (r) => r.hitungan.faktur },
  { header: "Faktur lunas", value: (r) => r.hitungan.lunas },
  { header: "Berisiko ditagih", value: (r) => (r.billing_risiko ? "ya" : "tidak") },
  { header: "Dikirim belum dibayar", value: (r) => (r.dikirim_belum_dibayar ? "ya" : "tidak") },
  { header: "Dokumen kurang", value: (r) => r.anomali.join("; ") },
  { header: "Nilai SO", value: (r) => r.total },
];

export function DocTrackerView({ data: awal, canEdit }: { data: DocTrackerList; canEdit: boolean }) {
  const [data, setData] = useState(awal);
  const [state, setState] = useState<DocState | null>(null);
  const [saring, setSaring] = useState<Saring>("semua");
  const [buka, setBuka] = useState<number | null>(null);

  const segarkan = useCallback(async () => {
    try {
      setData(await ambil<DocTrackerList>(`/api/doc-tracker?hari=${awal.hari}`));
    } catch {
      /* daftar lama tetap tampil; dialog menampilkan galat aksinya sendiri */
    }
  }, [awal.hari]);

  const tampil = data.rows
    .filter((r) => (state ? r.state === state : true))
    .filter((r) => (saring === "dikirim_belum_dibayar" ? r.dikirim_belum_dibayar : saring === "billing" ? r.billing_risiko : saring === "anomali" ? r.anomali.length > 0 : true));
  const chip = (aktif: boolean) =>
    cn("cursor-pointer rounded-md border px-3 py-1.5 text-sm", aktif ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent");

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="text-sm font-semibold">Tahap transaksi</h3>
          <span className="text-muted-foreground text-xs">Klik salah satu tahap untuk menyaring tabel di bawah · klik lagi untuk membatalkan</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          {STATES.map((s, i) => {
            const aktif = state === s;
            const n = data.funnel[s];
            return (
              <button
                key={s} type="button" aria-pressed={aktif} onClick={() => setState(aktif ? null : s)}
                className={cn(
                  "cursor-pointer rounded-lg border p-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                  aktif ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-card hover:border-primary/60 hover:bg-accent",
                  n === 0 && !aktif && "opacity-60",
                )}
              >
                <div className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
                  <span className="bg-muted inline-flex size-4 items-center justify-center rounded-full text-[10px]">{i + 1}</span>
                  {LABEL_STATE[s]}
                </div>
                <div className="text-xl font-semibold tabular-nums">{n}</div>
                <div className="text-muted-foreground text-[11px] leading-tight">{KETERANGAN_STATE[s]}</div>
              </button>
            );
          })}
        </div>
      </section>

      {(state || saring !== "semua") && (
        <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm">
          <span>
            Menampilkan <strong className="tabular-nums">{tampil.length}</strong> dari {data.ringkas.total} transaksi
          </span>
          {state && <Badge variant="secondary">Tahap: {LABEL_STATE[state]}</Badge>}
          {saring !== "semua" && <Badge variant="secondary">{LABEL_SARING[saring]}</Badge>}
          <button type="button" onClick={() => { setState(null); setSaring("semua"); }} className="ml-auto cursor-pointer underline underline-offset-2">
            Hapus filter
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">Perlu perhatian:</span>
        <button type="button" aria-pressed={saring === "dikirim_belum_dibayar"} onClick={() => setSaring(saring === "dikirim_belum_dibayar" ? "semua" : "dikirim_belum_dibayar")} className={chip(saring === "dikirim_belum_dibayar")}>
          Dikirim, belum dibayar <span className="tabular-nums">{data.ringkas.dikirim_belum_dibayar}</span>
        </button>
        <button type="button" aria-pressed={saring === "billing"} onClick={() => setSaring(saring === "billing" ? "semua" : "billing")} className={chip(saring === "billing")}>
          Berisiko ditagih (&gt; {data.hari_billing_risiko} hari sejak BAST) <span className="tabular-nums">{data.ringkas.billing_risiko}</span>
        </button>
        <button type="button" aria-pressed={saring === "anomali"} onClick={() => setSaring(saring === "anomali" ? "semua" : "anomali")} className={chip(saring === "anomali")}>
          Dokumen kurang <span className="tabular-nums">{data.ringkas.anomali}</span>
        </button>
        <span className="text-muted-foreground ml-auto text-xs">{data.hari} hari terakhir · maks. 500 SO terbaru</span>
      </div>

      <div className="flex justify-end">
        <ExportButton filename="document-tracker" columns={kolomExport} data={tampil} label="Export CSV" />
      </div>
      <DataTable
        columns={kolom} data={tampil} getKey={(r) => String(r.so_id)} pageSize={25}
        searchPlaceholder="Cari nomor SO atau customer…" empty="Tidak ada transaksi pada filter ini."
        onRowClick={(r) => setBuka(r.so_id)} initialSort={{ id: "tanggal", dir: "desc" }}
      />

      <p className="text-muted-foreground text-xs">
        State dihitung dari data yang sudah ada — SO, SJ, pengiriman/BAST (F12/F42), dan faktur — ditambah stempel Review/Approved dan checklist
        dokumen yang dicatat di sini. SO sebelum {data.stempel_mulai} dianggap Review/Approved tersirat bila tahap berikutnya sudah ada. Tahap
        berurutan: bukti di tahap lanjut tanpa tahap sebelumnya ditandai &quot;dokumen kurang&quot;. TTF tidak dilacak (keputusan Direktur).
      </p>

      <DocDetailDialog key={buka ?? "tutup"} soId={buka} canEdit={canEdit} onClose={() => setBuka(null)} onBerubah={segarkan} />
    </div>
  );
}
