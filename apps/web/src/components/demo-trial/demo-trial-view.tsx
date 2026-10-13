"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import { DetailDemoTrialDialog, TambahDemoTrialDialog } from "./dialogs";
import { HASIL_CLS, HASIL_LABEL, JENIS_CLS, JENIS_LABEL, tglId, type AmOpsi, type BarisKonversi, type DaftarDT, type DemoTrial, type JenisDT } from "./types";

type Kartu = "terbuka" | "lewat" | "positif" | "ditutup";
const KARTU: { k: Kartu; l: string; cocok: (r: DemoTrial) => boolean; cls: string }[] = [
  { k: "terbuka", l: "Belum ada hasil", cocok: (r) => !r.hasil, cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300" },
  { k: "lewat", l: "Trial lewat tanggal selesai", cocok: (r) => r.lewat_selesai, cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  { k: "positif", l: "Hasil positif", cocok: (r) => r.hasil === "positif", cls: HASIL_CLS.positif },
  { k: "ditutup", l: "Sudah ditutup", cocok: (r) => !!r.hasil, cls: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
];

const pct = (b: BarisKonversi) => (b.rate == null ? "—" : `${b.rate.toLocaleString("id-ID")}%`);

// F18 Demo & Trial — daftar + kartu ringkasan + rekap konversi per produk.
// Data dari apps/api/src/repo/demo-trial.ts (sudah di-scope server).
export function DemoTrialView({ daftar, amOpsi, bolehTambah, bolehUbah }: { daftar: DaftarDT; amOpsi: AmOpsi[]; bolehTambah: boolean; bolehUbah: boolean }) {
  const [kartu, setKartu] = useState<Kartu | "">("");
  const [jenis, setJenis] = useState("");
  const [am, setAm] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const [tambah, setTambah] = useState({ open: false, n: 0 });
  const items = daftar.items;

  const amDiData = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of items) if (r.am_id) m.set(r.am_id, r.am_nama ?? r.am_id);
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const data = useMemo(() => items.filter((r) =>
    (!kartu || KARTU.find((k) => k.k === kartu)!.cocok(r)) && (!jenis || r.jenis === jenis) && (!am || r.am_id === am)), [items, kartu, jenis, am]);

  const columns: DataColumn<DemoTrial>[] = [
    { id: "faskes", header: "Faskes", sortable: true, accessor: (r) => r.facility_name, cell: (r) => (
      <div><div className="font-medium">{r.facility_name}</div><div className="text-muted-foreground text-xs">{r.kode}{r.account_id ? "" : " · calon pelanggan"}</div></div>) },
    { id: "jenis", header: "Jenis", sortable: true, accessor: (r) => r.jenis, cell: (r) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", JENIS_CLS[r.jenis])}>{JENIS_LABEL[r.jenis]}</span>) },
    { id: "alat", header: "Alat", sortable: true, accessor: (r) => r.alat },
    { id: "tgl", header: "Tanggal", sortable: true, accessor: (r) => r.tanggal, cell: (r) => (
      <div className="text-sm tabular-nums">{tglId(r.tanggal)}{r.tanggal_selesai && <div className={cn("text-xs", r.lewat_selesai ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>s/d {tglId(r.tanggal_selesai)}</div>}</div>) },
    { id: "hasil", header: "Hasil", sortable: true, accessor: (r) => r.hasil ?? "", cell: (r) => r.hasil
      ? <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", HASIL_CLS[r.hasil])}>{HASIL_LABEL[r.hasil]}</span>
      : <span className="text-muted-foreground text-sm">belum</span> },
    { id: "am", header: "AM", sortable: true, accessor: (r) => r.am_nama ?? "", cell: (r) => r.am_nama ?? <span className="text-muted-foreground">—</span> },
    { id: "deal", header: "Deal", accessor: (r) => r.deal_stage ?? "", cell: (r) => r.deal_id ? <span className="text-sm">{r.deal_stage ?? "tertaut"}</span> : <span className="text-muted-foreground text-sm">—</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          WhatsApp: <code>#DEMO faskes: alat</code> · <code>#TRIAL faskes: alat, 14 hari</code> · tutup dengan <code>#DEMO DM-0001 positif: alasan</code>. Tidak dihitung ke KPI kunjungan.
        </p>
        {bolehTambah && <Button size="sm" onClick={() => setTambah({ open: true, n: tambah.n + 1 })}>Catat demo / trial</Button>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {KARTU.map((k) => (
          <button key={k.k} type="button" onClick={() => setKartu(kartu === k.k ? "" : k.k)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", kartu === k.k && "border-primary-dark ring-2 ring-primary/30")}>
            <div className="text-muted-foreground text-xs">{k.l}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", k.cls)}>{items.filter(k.cocok).length}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={data}
            getKey={(r) => r.id}
            searchPlaceholder="Cari faskes / kode / alat…"
            pageSize={25}
            onRowClick={(r) => setBuka(r.id)}
            empty={items.length === 0 ? "Belum ada demo/trial. Kirim #DEMO dari WhatsApp atau klik Catat demo / trial." : "Tidak ada yang cocok dengan filter."}
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                <FilterSelect label="Jenis" value={jenis} onChange={setJenis}
                  options={(["demo", "trial"] as JenisDT[]).map((j) => ({ value: j, label: JENIS_LABEL[j] }))} />
                <FilterSelect label="AM" value={am} onChange={setAm} options={amDiData} />
              </div>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Konversi per produk</CardTitle>
          <p className="text-muted-foreground text-xs">
            Konversi = hasil positif ÷ demo/trial yang sudah ditutup (penilaian AM). Yang belum ditutup tidak ikut dibagi.
            {daftar.per_jenis.map((b) => ` ${JENIS_LABEL[b.jenis]}: ${pct(b)} dari ${b.ditutup} ditutup.`).join("")}
          </p>
        </CardHeader>
        <CardContent>
          <DataTable
            data={daftar.konversi}
            getKey={(b) => `${b.jenis}|${b.kunci}`}
            pageSize={15}
            searchPlaceholder="Cari produk…"
            empty="Belum ada data."
            columns={[
              { id: "produk", header: "Produk / brand", sortable: true, accessor: (b) => b.kunci },
              { id: "jenis", header: "Jenis", sortable: true, accessor: (b) => b.jenis, cell: (b) => (
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", JENIS_CLS[b.jenis])}>{JENIS_LABEL[b.jenis]}</span>) },
              { id: "total", header: "Total", align: "right", sortable: true, accessor: (b) => b.total },
              { id: "ditutup", header: "Ditutup", align: "right", sortable: true, accessor: (b) => b.ditutup },
              { id: "hasil", header: "Positif / Netral / Negatif", align: "right", accessor: (b) => b.positif, cell: (b) => (
                <span className="tabular-nums text-sm">{b.positif} / {b.netral} / {b.negatif}</span>) },
              { id: "rate", header: "Konversi", align: "right", sortable: true, accessor: (b) => b.rate ?? -1, cell: (b) => <span className="font-semibold tabular-nums">{pct(b)}</span> },
            ]}
          />
        </CardContent>
      </Card>

      <DetailDemoTrialDialog id={buka} onClose={() => setBuka(null)} bolehUbah={bolehUbah} />
      <TambahDemoTrialDialog key={tambah.n} open={tambah.open} onClose={() => setTambah({ ...tambah, open: false })} amOpsi={amOpsi} />
    </div>
  );
}
