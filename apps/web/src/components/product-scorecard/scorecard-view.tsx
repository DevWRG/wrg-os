"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

// F6 Product Scorecard (apps/api/src/repo/product-scorecard.ts). Angka dihitung di
// server; di sini memilih periode, menelusuri kategori → lini → brand → item, menampilkan.

export type Level = "kategori" | "lini" | "brand" | "item";
export interface BarisScorecard {
  key: string;
  label: string;
  sub: string | null;
  revenue: number;
  revenue_sebelum: number;
  revenue_tahun_lalu: number;
  tumbuh_sebelum: number | null;
  tumbuh_tahun_lalu: number | null;
  porsi: number;
  qty: number;
  customer: number;
  top1_nama: string | null;
  top1_porsi: number | null;
  top5_porsi: number | null;
  item: number;
  stok_bulan: number | null;
  stok_mati: number;
  kompetitor_faskes: number | null;
  kompetitor_vendor: string[] | null;
  gp?: number | null;
  gp_pct?: number | null;
  hpp_cakupan?: number | null;
}
export interface DataScorecard {
  level: Level;
  range: { from: string; to: string; dipotong: boolean };
  banding: { sebelum: { from: string; to: string }; tahun_lalu: { from: string; to: string }; hari: number };
  filter: { kategori: string | null; lini: string | null; brand: string | null };
  margin: boolean;
  periode_hpp: string | null;
  ringkas: { revenue: number; revenue_sebelum: number; revenue_tahun_lalu: number; terklasifikasi: number | null };
  rows: BarisScorecard[];
}

interface Langkah { level: Level; label: string; kategori?: string; lini?: string; brand?: string }

const TANPA = "__tanpa__";
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${BULAN[m - 1]} ${y}`; };
const rp = (n: number) => Math.abs(n) >= 1e9 ? `Rp ${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`
  : Math.abs(n) >= 1e6 ? `Rp ${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt` : `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const pct = (x: number | null | undefined, digit = 0) => x == null ? "—" : `${(x * 100).toLocaleString("id-ID", { maximumFractionDigits: digit })}%`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function preset(k: string): { from: string; to: string } {
  const now = new Date(Date.now() + 7 * 3600_000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (k === "bulan-lalu") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  if (k === "kuartal") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(now) }; }
  if (k === "kuartal-lalu") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q - 3, 1))), to: iso(new Date(Date.UTC(y, q, 0))) }; }
  if (k === "12-bulan") return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: iso(now) };
  return { from: `${y}-01-01`, to: iso(now) }; // ytd
}
const PRESET = [["ytd", "Tahun ini"], ["kuartal", "Kuartal ini"], ["kuartal-lalu", "Kuartal lalu"], ["bulan-lalu", "Bulan lalu"], ["12-bulan", "12 bulan"]] as const;
const NAMA_LEVEL: Record<Level, string> = { kategori: "Kategori", lini: "Lini", brand: "Brand", item: "Item" };

function Tumbuh({ x }: { x: number | null }) {
  if (x == null) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("tabular-nums", x >= 0.05 && "text-emerald-700 dark:text-emerald-400", x <= -0.05 && "text-rose-700 dark:text-rose-400")}>{x > 0 ? "+" : ""}{pct(x)}</span>;
}

export function ProductScorecardView({ awal }: { awal: DataScorecard | null }) {
  const [data, setData] = useState<DataScorecard | null>(awal);
  const [jejak, setJejak] = useState<Langkah[]>([{ level: "kategori", label: "Semua kategori" }]);
  const [rentang, setRentang] = useState<{ from: string; to: string }>(awal ? { from: awal.range.from, to: awal.range.to } : preset("ytd"));
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function muat(l: Langkah, r: { from: string; to: string }) {
    setMemuat(true);
    setGalat(null);
    try {
      const q = new URLSearchParams({ level: l.level, from: r.from, to: r.to });
      if (l.kategori) q.set("kategori", l.kategori);
      if (l.lini) q.set("lini", l.lini);
      if (l.brand) q.set("brand", l.brand);
      const res = await fetch(`/api/product-scorecard?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as DataScorecard);
      return true;
    } catch (e) {
      setGalat(`Gagal memuat (${(e as Error).message}).`);
      return false;
    } finally {
      setMemuat(false);
    }
  }

  async function telusuri(r: BarisScorecard) {
    const kini = jejak[jejak.length - 1];
    let next: Langkah | null = null;
    if (kini.level === "kategori") next = r.key === TANPA ? { level: "item", label: r.label, kategori: TANPA } : { level: "lini", label: r.label, kategori: r.key };
    else if (kini.level === "lini") next = r.key === TANPA ? { level: "item", label: r.label, kategori: TANPA } : { level: "brand", label: r.label, kategori: r.key.split(".")[0], lini: r.key };
    else if (kini.level === "brand") next = { level: "item", label: r.label, kategori: kini.kategori, lini: kini.lini, brand: r.key };
    if (next && await muat(next, rentang)) setJejak([...jejak, next]);
  }
  async function mundur(i: number) {
    const l = jejak[i];
    if (await muat(l, rentang)) setJejak(jejak.slice(0, i + 1));
  }
  async function gantiRentang(r: { from: string; to: string }) {
    if (!r.from || !r.to) return;
    if (await muat(jejak[jejak.length - 1], r)) setRentang(r);
  }

  if (!data) return <p className="text-muted-foreground text-sm">Data scorecard tidak tersedia — coba muat ulang.</p>;
  const level = data.level;
  const bisaTelusur = level !== "item";
  const s = data.ringkas;

  const kolom: DataColumn<BarisScorecard>[] = [
    { id: "nama", header: NAMA_LEVEL[level], sortable: true, accessor: (r) => r.label, cell: (r) => (
      <div className="min-w-48">
        {bisaTelusur
          ? <button type="button" onClick={() => void telusuri(r)} className="text-left font-medium hover:underline">{r.label}</button>
          : <span className="font-medium">{r.label}</span>}
        {r.sub ? <div className="text-muted-foreground text-xs">{r.sub}</div> : null}
      </div>) },
    { id: "rev", header: "Revenue", align: "right", sortable: true, accessor: (r) => r.revenue, cell: (r) => (
      <div className="text-right"><div className="tabular-nums">{rp(r.revenue)}</div><div className="text-muted-foreground text-xs">{pct(r.porsi, 1)} dari total</div></div>) },
    { id: "sebelum", header: "vs periode lalu", align: "right", sortable: true, accessor: (r) => r.tumbuh_sebelum ?? -99, cell: (r) => (
      <div className="text-right"><Tumbuh x={r.tumbuh_sebelum} /><div className="text-muted-foreground text-xs">{rp(r.revenue_sebelum)}</div></div>) },
    { id: "ly", header: "vs tahun lalu", align: "right", sortable: true, accessor: (r) => r.tumbuh_tahun_lalu ?? -99, cell: (r) => (
      <div className="text-right"><Tumbuh x={r.tumbuh_tahun_lalu} /><div className="text-muted-foreground text-xs">{rp(r.revenue_tahun_lalu)}</div></div>) },
    { id: "cust", header: "Customer", align: "right", sortable: true, accessor: (r) => r.customer, cell: (r) => (
      <div className="text-right">
        <div className="tabular-nums">{r.customer.toLocaleString("id-ID")}</div>
        {r.top1_porsi != null && <div className={cn("text-xs", r.top1_porsi >= 0.3 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")} title={r.top1_nama ?? undefined}>
          terbesar {pct(r.top1_porsi)} · top-5 {pct(r.top5_porsi)}</div>}
      </div>) },
    { id: "stok", header: "Stok", align: "right", sortable: true, accessor: (r) => r.stok_bulan ?? -1, cell: (r) => (
      <div className="text-right">
        <div className="tabular-nums">{r.stok_bulan == null ? "—" : `±${r.stok_bulan.toLocaleString("id-ID", { maximumFractionDigits: 1 })} bln`}</div>
        {r.stok_mati > 0 && <div className="text-xs text-amber-700 dark:text-amber-400">{r.stok_mati} item stok mati</div>}
      </div>) },
  ];
  if (level === "kategori" || level === "lini") {
    kolom.push({ id: "kom", header: "Kompetitor", sortable: true, accessor: (r) => r.kompetitor_faskes ?? -1, cell: (r) => r.kompetitor_faskes
      ? <div className="max-w-56 text-sm"><div className="tabular-nums">{r.kompetitor_faskes} faskes</div><div className="text-muted-foreground text-xs">{(r.kompetitor_vendor ?? []).join(", ")}</div></div>
      : <span className="text-muted-foreground text-xs">—</span> });
  }
  if (data.margin) {
    kolom.push({ id: "gp", header: "GP%", align: "right", sortable: true, accessor: (r) => r.gp_pct ?? -99, cell: (r) => (
      <div className="text-right">
        <div className="tabular-nums">{pct(r.gp_pct, 1)}</div>
        <div className={cn("text-xs", (r.hpp_cakupan ?? 0) < 0.8 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>HPP {pct(r.hpp_cakupan)} revenue</div>
      </div>) });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          {PRESET.map(([k, l]) => (
            <button key={k} type="button" disabled={memuat} onClick={() => void gantiRentang(preset(k))}
              className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">{l}</button>
          ))}
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">Dari
            <input type="date" value={rentang.from} disabled={memuat} onChange={(e) => void gantiRentang({ ...rentang, from: e.target.value })}
              className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs" />
          </label>
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">s/d
            <input type="date" value={rentang.to} disabled={memuat} onChange={(e) => void gantiRentang({ ...rentang, to: e.target.value })}
              className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs" />
          </label>
          {memuat && <span className="text-muted-foreground text-xs">Memuat…</span>}
          {galat && <span className="text-xs text-rose-700 dark:text-rose-400">{galat}</span>}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={`Revenue ${tgl(data.range.from)} – ${tgl(data.range.to)}`} value={rp(s.revenue)} />
        <Stat label="vs periode sebelumnya" value={<Tumbuh x={s.revenue_sebelum > 0 ? (s.revenue - s.revenue_sebelum) / s.revenue_sebelum : null} />} hint={`${tgl(data.banding.sebelum.from)} – ${tgl(data.banding.sebelum.to)}`} />
        <Stat label="vs tahun lalu" value={<Tumbuh x={s.revenue_tahun_lalu > 0 ? (s.revenue - s.revenue_tahun_lalu) / s.revenue_tahun_lalu : null} />} hint={`${tgl(data.banding.tahun_lalu.from)} – ${tgl(data.banding.tahun_lalu.to)}`} />
        <Stat label="Revenue terklasifikasi" value={pct(s.terklasifikasi)} hint="item yang punya kode di Klasifikasi Produk" />
      </div>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <nav aria-label="Jejak telusur" className="flex flex-wrap items-center gap-1 text-sm">
            {jejak.map((l, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">›</span>}
                {i < jejak.length - 1
                  ? <button type="button" disabled={memuat} onClick={() => void mundur(i)} className="text-primary-dark hover:underline">{l.label}</button>
                  : <span className="font-semibold">{l.label}</span>}
              </span>
            ))}
            <span className="text-muted-foreground ml-2 text-xs">— per {NAMA_LEVEL[level].toLowerCase()}{bisaTelusur ? ", klik nama untuk menelusuri" : ""}</span>
          </nav>
          <p className="text-muted-foreground text-xs">
            Revenue netto (tanpa PPN), dialokasikan per baris faktur. Stok = stok Accurate dibanding rata kiriman 3 bulan terakhir (median item); stok mati = ada stok tapi tanpa kiriman &amp; faktur 90 hari.
            {(level === "kategori" || level === "lini") && " Kompetitor = faskes yang menyebut vendor pesaing di kategori itu dalam setahun (laporan kunjungan)."}
            {data.margin && ` GP% hanya dari item dengan HPP tunggal di price book ${data.periode_hpp}; cakupan HPP < 80% ditandai.`}
            {data.range.dipotong && " Rentang dipotong ke 366 hari terakhir."}
          </p>
          <DataTable columns={kolom} data={data.rows} getKey={(r) => r.key} searchPlaceholder={`Cari ${NAMA_LEVEL[level].toLowerCase()}…`} pageSize={25}
            empty="Tidak ada penjualan di periode & cakupan ini." />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs">{label}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
