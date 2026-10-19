"use client";

import { useState } from "react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

// F90 Antrean Order (apps/api/src/repo/order-wa.ts). Pesanan AM dari WhatsApp #ORDER yang sudah
// dikonfirmasi; Admin Sales menginput SO di Accurate, sistem mencocokkan otomatis.

type Status = "antrean" | "diproses" | "selesai" | "batal";
interface Item { urut: number; kode: string | null; nama: string; qty: number; satuan: string | null; harga: number; harga_list: number; harga_nett: number; stok: number | null }
interface Order {
  id: string; status: Status; am: string; cabang: string; account_id: string; faskes: string; dibuat_at: string; dikonfirmasi_at: string | null;
  diproses_oleh: string | null; so_number: string | null; selesai_oleh: string | null; batal_alasan: string | null; catatan: string | null; item: Item[]; total: number;
}
export interface DataOrder { dicocokkan: number; ringkas: Record<Status, number>; order: Order[] }

const LABEL: Record<Status, string> = { antrean: "Antrean", diproses: "Diproses", selesai: "Masuk Accurate", batal: "Batal" };
const CLS: Record<Status, string> = {
  antrean: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  diproses: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  selesai: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  batal: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const wkt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "—");

export function OrderView({ awal, bisaUbah }: { awal: DataOrder | null; bisaUbah: boolean }) {
  const [data, setData] = useState<DataOrder | null>(awal);
  const [status, setStatus] = useState<Status | "">("");
  const [am, setAm] = useState("");
  const [buka, setBuka] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);

  async function ubah(o: Order, ke: Status) {
    const isi: Record<string, string> = { status: ke };
    if (ke === "selesai") { const so = prompt(`Nomor SO Accurate untuk O${o.id}?`)?.trim(); if (!so) return; isi.so_number = so; }
    if (ke === "batal") { const a = prompt(`Alasan membatalkan O${o.id}?`)?.trim(); if (!a) return; isi.alasan = a; }
    setSibuk(true); setPesan(null);
    try {
      const r = await fetch(`/api/order-wa/${o.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(isi) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${r.status}`);
      const n = await fetch(`/api/order-wa`, { cache: "no-store" });
      if (n.ok) setData((await n.json()) as DataOrder);
      setPesan({ ok: true, teks: `O${o.id} → ${LABEL[ke]}` });
    } catch (e) { setPesan({ ok: false, teks: (e as Error).message }); }
    finally { setSibuk(false); }
  }

  if (!data) return <p className="text-muted-foreground text-sm">Data antrean tidak tersedia — coba muat ulang.</p>;
  const opsiAm = [...new Set(data.order.map((o) => o.am))].sort().map((a) => ({ value: a, label: a }));
  const tampil = data.order.filter((o) => (!status || o.status === status) && (!am || o.am === am));

  const kolom: DataColumn<Order>[] = [
    { id: "no", header: "Pesanan", sortable: true, accessor: (o) => Number(o.id), cell: (o) => (
      <button type="button" onClick={() => setBuka(buka === o.id ? null : o.id)} className="text-left">
        <div className="font-semibold">O{o.id}</div><div className="text-muted-foreground text-xs">{wkt(o.dikonfirmasi_at)}</div>
      </button>) },
    { id: "faskes", header: "Faskes", sortable: true, accessor: (o) => o.faskes, cell: (o) => (
      <div className="min-w-48"><Link href={`/accounts/${o.account_id}`} className="font-medium hover:underline">{o.faskes}</Link>
        <div className="text-muted-foreground text-xs">AM {o.am}{o.cabang ? ` · ${o.cabang}` : ""} · {o.item.length} barang</div></div>) },
    { id: "total", header: "Total", align: "right", sortable: true, accessor: (o) => o.total, cell: (o) => <span className="tabular-nums">{rp(o.total)}</span> },
    { id: "status", header: "Status", sortable: true, accessor: (o) => ["antrean", "diproses", "selesai", "batal"].indexOf(o.status), cell: (o) => (
      <div><span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", CLS[o.status])}>{LABEL[o.status]}</span>
        <div className="text-muted-foreground mt-0.5 text-xs">{o.status === "selesai" ? `${o.so_number ?? ""}${o.selesai_oleh === "otomatis" ? " · dicocokkan otomatis" : ""}` : o.status === "diproses" ? `oleh ${o.diproses_oleh ?? "—"}` : o.status === "batal" ? o.batal_alasan ?? "" : ""}</div></div>) },
  ];
  if (bisaUbah) kolom.push({ id: "aksi", header: "Aksi", cell: (o) => (
    <div className="flex flex-wrap gap-1">
      {o.status === "antrean" && <button type="button" disabled={sibuk} onClick={() => void ubah(o, "diproses")} className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">Proses</button>}
      {(o.status === "antrean" || o.status === "diproses") && <button type="button" disabled={sibuk} onClick={() => void ubah(o, "selesai")} className="rounded border border-emerald-600 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10">Sudah di Accurate</button>}
      {(o.status === "antrean" || o.status === "diproses") && <button type="button" disabled={sibuk} onClick={() => void ubah(o, "batal")} className="rounded border px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-500/10">Batal</button>}
      {o.status === "selesai" && <button type="button" disabled={sibuk} onClick={() => void ubah(o, "diproses")} className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50">Buka lagi</button>}
    </div>) });

  const dipilih = buka ? data.order.find((o) => o.id === buka) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["antrean", "diproses", "selesai", "batal"] as Status[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? "" : s)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary", status === s && "border-primary-dark ring-2 ring-primary/30")}>
            <div className="text-muted-foreground text-xs">{LABEL[s]}</div>
            <div className={cn("mt-1 inline-block rounded px-1.5 text-xl font-bold tabular-nums", CLS[s])}>{data.ringkas[s]}</div>
          </button>
        ))}
      </div>
      {dipilih && (
        <Card><CardContent className="space-y-2 py-4">
          <div className="flex items-center justify-between"><div className="font-semibold">O{dipilih.id} — {dipilih.faskes}</div>
            <button type="button" onClick={() => setBuka(null)} className="text-muted-foreground text-xs hover:underline">tutup</button></div>
          <table className="w-full text-sm">
            <thead><tr className="text-muted-foreground text-left text-xs"><th className="py-1">Kode</th><th>Barang</th><th className="text-right">Qty</th><th className="text-right">Harga</th><th className="text-right">Lantai</th><th className="text-right">Stok saat pesan</th></tr></thead>
            <tbody>{dipilih.item.map((i) => (
              <tr key={i.urut} className="border-t">
                <td className="py-1 font-mono text-xs">{i.kode ?? "—"}</td><td>{i.nama}</td>
                <td className="text-right tabular-nums">{Number(i.qty).toLocaleString("id-ID")} {i.satuan ?? ""}</td>
                <td className="text-right tabular-nums">{rp(Number(i.harga))}</td><td className="text-muted-foreground text-right tabular-nums">{rp(Number(i.harga_nett))}</td>
                <td className={cn("text-right tabular-nums", i.stok != null && i.stok < Number(i.qty) && "text-amber-700 dark:text-amber-400")}>{i.stok == null ? "—" : Number(i.stok).toLocaleString("id-ID")}</td>
              </tr>))}</tbody>
          </table>
        </CardContent></Card>
      )}
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-muted-foreground text-xs">
            Pesanan AM lewat WhatsApp <b>#ORDER</b> yang sudah dikonfirmasi AM. Input SO-nya di Accurate seperti biasa — sistem mencocokkan otomatis (faskes sama, SO tertanggal sampai 14 hari sesudah konfirmasi, minimal satu kode barang sama) dan menandainya <b>Masuk Accurate</b>{data.dicocokkan ? ` (baru saja: ${data.dicocokkan})` : ""}. Klik nomor pesanan untuk rincian barang.
            {pesan && <span className={cn(" ml-1 font-medium", pesan.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{pesan.teks}</span>}
          </p>
          <DataTable columns={kolom} data={tampil} getKey={(o) => o.id} searchPlaceholder="Cari faskes…" pageSize={25}
            empty={data.order.length ? "Tidak ada pesanan dengan filter ini." : "Belum ada pesanan — AM mengirim lewat #ORDER di WhatsApp."}
            toolbar={<FilterSelect label="AM" value={am} onChange={setAm} options={opsiAm} />} />
        </CardContent>
      </Card>
    </div>
  );
}
