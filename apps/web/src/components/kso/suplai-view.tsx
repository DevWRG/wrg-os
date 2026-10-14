"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

// F7 — kontrol suplai reagen KSO (apps/api/src/repo/kso-suplai.ts). Status, ritme, dan
// kebutuhan dihitung di server; di sini hanya memilih periode, menyaring, menampilkan.

export type StatusOrder = "TELAT" | "TANPA_KIRIMAN" | "RUTIN";
export type StatusStok = "KRITIS" | "PERLU_PO" | "STOK_0" | "AMAN";

export interface BarisOrder {
  account_id: string;
  nama: string;
  cabang: string | null;
  pemilik: string | null;
  jenis: string;
  alat: number;
  skema: string[];
  terakhir: string | null;
  gelombang_jendela: number;
  qty_jendela: number;
  status: StatusOrder;
  ritme_hari: number | null;
  batas_hari: number | null;
  lewat_hari: number | null;
  perkiraan_order: string | null;
}
export interface BarisItem {
  item_no: string;
  nama: string;
  jenis: string;
  unit: string | null;
  kebutuhan_kso_bln: number;
  kebutuhan_total_bln: number;
  faskes_kso: number;
  stok: number;
  po_sisa: number;
  status: StatusStok;
  cukup_bulan: number | null;
  saran_po: number;
}
export interface DataSuplai {
  hari_ini: string;
  jendela: { bulan: number; dari: string; sampai: string; bulan_efektif: number; terpotong: boolean };
  data_do: { sejak: string | null; sampai: string | null };
  stok_per: string | null;
  aturan: { telat_tanpa_ritme: number; cakupan_po_bulan: number; po_basi_hari: number };
  ringkas: {
    order: { total: number; telat: number; tanpa_kiriman: number; rutin: number; faskes: number };
    item: { total: number; kritis: number; perlu_po: number; stok_0: number; aman: number };
  };
  order: BarisOrder[];
  item: BarisItem[];
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const bln = (iso: string) => { const [y, m] = iso.split("-").map(Number); return `${BULAN[m - 1]} ${y}`; };
const tgl = (iso: string | null) => { if (!iso) return "—"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
const bulanSebelum = (iso: string) => { const [y, m] = iso.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 10); };
const angka = (n: number) => Math.round(n).toLocaleString("id-ID");

const MERAH = "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300";
const KUNING = "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
const ABU = "bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300";
const HIJAU = "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";

const KARTU_ORDER: { s: StatusOrder; l: string; cls: string; n: (d: DataSuplai) => number }[] = [
  { s: "TELAT", l: "Telat order", cls: MERAH, n: (d) => d.ringkas.order.telat },
  { s: "TANPA_KIRIMAN", l: "Tanpa kiriman", cls: ABU, n: (d) => d.ringkas.order.tanpa_kiriman },
  { s: "RUTIN", l: "Rutin", cls: HIJAU, n: (d) => d.ringkas.order.rutin },
];
const KARTU_STOK: { s: StatusStok; l: string; cls: string; n: (d: DataSuplai) => number }[] = [
  { s: "KRITIS", l: "Kritis (< 1 bln)", cls: MERAH, n: (d) => d.ringkas.item.kritis },
  { s: "PERLU_PO", l: "Perlu PO", cls: KUNING, n: (d) => d.ringkas.item.perlu_po },
  { s: "STOK_0", l: "Stok 0 di Accurate", cls: ABU, n: (d) => d.ringkas.item.stok_0 },
  { s: "AMAN", l: "Aman", cls: HIJAU, n: (d) => d.ringkas.item.aman },
];
const LABEL_ORDER: Record<StatusOrder, [string, string]> = { TELAT: ["Telat order", MERAH], TANPA_KIRIMAN: ["Tanpa kiriman", ABU], RUTIN: ["Rutin", HIJAU] };
const LABEL_STOK: Record<StatusStok, [string, string]> = { KRITIS: ["Kritis", MERAH], PERLU_PO: ["Perlu PO", KUNING], STOK_0: ["Stok 0", ABU], AMAN: ["Aman", HIJAU] };
const OPSI_BULAN = [1, 2, 3, 4, 6].map((n) => ({ value: String(n), label: `${n} bulan terakhir` }));

function KartuStatus<S extends string>({ kartu, aktif, onPilih, data }: {
  kartu: { s: S; l: string; cls: string; n: (d: DataSuplai) => number }[]; aktif: S | ""; onPilih: (s: S | "") => void; data: DataSuplai;
}) {
  return (
    <div className={cn("grid gap-2", kartu.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
      {kartu.map((k) => (
        <button key={k.s} type="button" onClick={() => onPilih(aktif === k.s ? "" : k.s)}
          className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", aktif === k.s && "border-primary-dark ring-2 ring-primary/30")}>
          <div className="text-muted-foreground text-xs">{k.l}</div>
          <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", k.cls)}>{k.n(data)}</div>
        </button>
      ))}
    </div>
  );
}

export function KsoSuplaiPanel({ data: awal }: { data: DataSuplai | null }) {
  const [data, setData] = useState<DataSuplai | null>(awal);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [bagian, setBagian] = useState<"order" | "stok">("order");
  const [stOrder, setStOrder] = useState<StatusOrder | "">("");
  const [stStok, setStStok] = useState<StatusStok | "">("");
  const [cabang, setCabang] = useState("");
  const [jenis, setJenis] = useState("");

  const opsiCabang = useMemo(() => [...new Set((data?.order ?? []).map((o) => o.cabang).filter((c): c is string => !!c))].sort().map((c) => ({ value: c, label: c })), [data]);
  const opsiJenis = useMemo(() => [...new Set([...(data?.order ?? []).map((o) => o.jenis), ...(data?.item ?? []).map((i) => i.jenis)])].sort().map((j) => ({ value: j, label: j })), [data]);

  async function gantiBulan(v: string) {
    setMemuat(true);
    setGalat(null);
    try {
      const r = await fetch(`/api/kso/suplai?bulan=${encodeURIComponent(v)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as DataSuplai);
    } catch (e) {
      setGalat(`Gagal memuat ulang (${(e as Error).message}) — angka di bawah masih periode sebelumnya.`);
    } finally {
      setMemuat(false);
    }
  }

  if (!data) return <p className="text-muted-foreground text-sm">Data suplai tidak tersedia — coba muat ulang.</p>;

  const j = data.jendela;
  const periode = `${bln(j.dari)}–${bln(bulanSebelum(j.sampai))}`;
  const order = data.order.filter((o) => (!stOrder || o.status === stOrder) && (!cabang || o.cabang === cabang) && (!jenis || o.jenis === jenis));
  const item = data.item.filter((i) => (!stStok || i.status === stStok) && (!jenis || i.jenis === jenis));

  const kolomOrder: DataColumn<BarisOrder>[] = [
    { id: "faskes", header: "Faskes", sortable: true, accessor: (o) => o.nama, cell: (o) => (
      <div>
        <Link href={`/accounts/${o.account_id}`} className="font-medium hover:underline">{o.nama}</Link>
        <div className="text-muted-foreground text-xs">{[o.cabang, o.pemilik ? `AM ${o.pemilik}` : "belum ada pemilik"].filter(Boolean).join(" · ")}</div>
      </div>) },
    { id: "jenis", header: "Jenis alat", sortable: true, accessor: (o) => o.jenis, cell: (o) => (
      <div><div>{o.jenis}</div><div className="text-muted-foreground text-xs">{o.alat} alat · {o.skema.join(", ")}</div></div>) },
    { id: "status", header: "Status", sortable: true, accessor: (o) => ["TELAT", "TANPA_KIRIMAN", "RUTIN"].indexOf(o.status), cell: (o) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap", LABEL_ORDER[o.status][1])}>{LABEL_ORDER[o.status][0]}</span>) },
    { id: "terakhir", header: "Kiriman terakhir", sortable: true, accessor: (o) => o.lewat_hari ?? 99999, cell: (o) => o.terakhir
      ? <div><div className="tabular-nums">{tgl(o.terakhir)}</div><div className="text-muted-foreground text-xs">{o.lewat_hari} hari lalu</div></div>
      : <span className="text-muted-foreground text-xs">belum ada sejak {tgl(data.data_do.sejak)}</span> },
    { id: "ritme", header: "Ritme", align: "right", sortable: true, accessor: (o) => o.ritme_hari ?? -1, cell: (o) => (
      <div className="text-right">
        <div className="tabular-nums">{o.ritme_hari ? `±${o.ritme_hari} hari` : <span className="text-muted-foreground text-xs">belum terbaca</span>}</div>
        {o.perkiraan_order && o.status !== "TANPA_KIRIMAN" ? <div className="text-muted-foreground text-xs">order berikut ±{tgl(o.perkiraan_order)}</div> : null}
      </div>) },
    { id: "qty", header: `Dikirim ${periode}`, align: "right", sortable: true, accessor: (o) => o.qty_jendela, cell: (o) => (
      <div className="text-right"><div className="tabular-nums">{angka(o.qty_jendela)}</div><div className="text-muted-foreground text-xs">{o.gelombang_jendela}× kirim</div></div>) },
  ];

  const kolomItem: DataColumn<BarisItem>[] = [
    { id: "item", header: "Item reagen", sortable: true, accessor: (i) => i.nama, cell: (i) => (
      <div><div className="font-medium">{i.nama}</div><div className="text-muted-foreground text-xs">{i.item_no} · {i.jenis}</div></div>) },
    { id: "status", header: "Status", sortable: true, accessor: (i) => ["KRITIS", "PERLU_PO", "STOK_0", "AMAN"].indexOf(i.status), cell: (i) => (
      <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap", LABEL_STOK[i.status][1])}>{LABEL_STOK[i.status][0]}</span>) },
    { id: "butuh", header: "Kebutuhan / bln", align: "right", sortable: true, accessor: (i) => i.kebutuhan_total_bln, cell: (i) => (
      <div className="text-right"><div className="tabular-nums">{angka(i.kebutuhan_total_bln)} {i.unit ?? ""}</div>
        <div className="text-muted-foreground text-xs">KSO {angka(i.kebutuhan_kso_bln)} · {i.faskes_kso} faskes</div></div>) },
    { id: "stok", header: "Stok", align: "right", sortable: true, accessor: (i) => i.cukup_bulan ?? -1, cell: (i) => (
      <div className="text-right"><div className="tabular-nums">{angka(i.stok)}</div>
        <div className="text-muted-foreground text-xs">{i.cukup_bulan == null ? "—" : `cukup ±${i.cukup_bulan.toLocaleString("id-ID", { maximumFractionDigits: 1 })} bln`}</div></div>) },
    { id: "po", header: "PO jalan", align: "right", sortable: true, accessor: (i) => i.po_sisa, cell: (i) => (
      <span className="tabular-nums">{i.po_sisa > 0 ? angka(i.po_sisa) : "—"}</span>) },
    { id: "saran", header: `Saran PO (${data.aturan.cakupan_po_bulan} bln)`, align: "right", sortable: true, accessor: (i) => i.saran_po, cell: (i) => (
      <span className={cn("tabular-nums", i.saran_po > 0 && "font-semibold")}>{i.saran_po > 0 ? angka(i.saran_po) : "—"}</span>) },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Bagian suplai">
            {([["order", "Kontrol order faskes"], ["stok", "Kebutuhan vs stok"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={bagian === k} onClick={() => setBagian(k)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium transition-colors", bagian === k ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent")}>{l}</button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">Rata-rata dari</span>
            <select value={String(j.bulan)} disabled={memuat} onChange={(e) => void gantiBulan(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50">
              {OPSI_BULAN.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {memuat && <span className="text-muted-foreground text-xs">Memuat…</span>}
          {galat && <span className="text-xs text-rose-700 dark:text-rose-400">{galat}</span>}
        </CardContent>
      </Card>

      {bagian === "order" ? (
        <>
          <KartuStatus kartu={KARTU_ORDER} aktif={stOrder} onPilih={setStOrder} data={data} />
          <Card>
            <CardContent className="space-y-2 pt-6">
              <p className="text-muted-foreground text-xs">
                Per faskes × jenis alat KSO yang terpasang ({data.ringkas.order.faskes} faskes). Sumber: <b>Surat Jalan (DO) Accurate</b> — reagen yang benar-benar dikirim, termasuk ke faskes PER_TEST.
                Ritme = median jeda antar-kiriman {periode}; <b>telat</b> bila sudah lewat 1,5× ritme (minimal ritme + 14 hari), atau {data.aturan.telat_tanpa_ritme} hari bila ritme belum terbaca.
                “Tanpa kiriman” = belum ada DO jenis itu sejak {tgl(data.data_do.sejak)}: alat menganggur, atau reagen dikirim atas nama customer lain.
              </p>
              <DataTable columns={kolomOrder} data={order} getKey={(o) => `${o.account_id}|${o.jenis}`} searchPlaceholder="Cari faskes…" pageSize={25}
                empty={data.order.length === 0 ? "Tidak ada faskes KSO dalam cakupan Anda." : "Tidak ada baris dengan filter ini."}
                toolbar={<>
                  <FilterSelect label="Cabang" value={cabang} onChange={setCabang} options={opsiCabang} />
                  <FilterSelect label="Jenis alat" value={jenis} onChange={setJenis} options={opsiJenis} />
                </>} />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <KartuStatus kartu={KARTU_STOK} aktif={stStok} onPilih={setStStok} data={data} />
          <Card>
            <CardContent className="space-y-2 pt-6">
              <p className="text-muted-foreground text-xs">
                Item reagen yang dikirim ke faskes KSO {periode}. Kebutuhan/bln = rata-rata kiriman ke <b>semua customer</b> (stok melayani semua), kebutuhan KSO ditampilkan di bawahnya.
                Stok = Accurate{data.stok_per ? ` per ${new Date(data.stok_per).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}` : ""}; PO jalan = PO Accurate yang belum selesai, maksimal {data.aturan.po_basi_hari} hari.
                <b> Stok 0</b> padahal rutin dikirim biasanya berarti stok tidak dicatat di Accurate (kirim langsung principal/konsinyasi) — cek dulu sebelum PO.
              </p>
              <DataTable columns={kolomItem} data={item} getKey={(i) => i.item_no} searchPlaceholder="Cari item…" pageSize={25}
                empty="Tidak ada item dengan filter ini."
                toolbar={<FilterSelect label="Jenis alat" value={jenis} onChange={setJenis} options={opsiJenis} />} />
            </CardContent>
          </Card>
        </>
      )}
      {j.terpotong && <p className="text-muted-foreground text-xs">Data kiriman baru tersedia sejak {tgl(data.data_do.sejak)}, jadi rata-rata memakai {j.bulan_efektif} bulan, bukan {j.bulan}.</p>}
    </div>
  );
}
