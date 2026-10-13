"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useConfirm } from "@/components/ui/use-confirm";
import { cn } from "@/lib/utils";

import { KampanyeFormDialog, type OpsiKampanye } from "./kampanye-form";
import { BilahProgres, LabelPacing } from "./progres";
import { STATUS_CLS, angka, kirim, periode, persen, rp, tgl, type BarisAm, type DetailKampanye } from "./types";

function Kpi({ label, nilai, sub }: { label: string; nilai: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-lg border p-3 shadow-[var(--shadow-card)]">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{nilai}</div>
      {sub && <div className="text-muted-foreground mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

export function KampanyeDetailView({ d, opsi, bolehUbah }: { d: DetailKampanye; opsi: OpsiKampanye; bolehUbah: boolean }) {
  const router = useRouter();
  const k = d.kampanye;
  const r = d.ringkasan;
  const f = d.corong;
  const [ubah, setUbah] = useState({ open: false, n: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boleh = bolehUbah && d.boleh_ubah;
  const { confirm, dialog } = useConfirm();

  async function setBatal(dibatalkan: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await kirim(`/api/kampanye/${k.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ dibatalkan }) });
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const kolom: DataColumn<BarisAm>[] = [
    { id: "am", header: "AM", sortable: true, accessor: (a) => a.nama, cell: (a) => (
      <div><div className={cn("font-medium", !a.am_id && "text-muted-foreground")}>{a.nama}</div>
        {a.cabang && <div className="text-muted-foreground text-xs">{a.cabang}</div>}</div>) },
    { id: "target", header: "Target", align: "right", sortable: true, accessor: (a) => a.target_rp, cell: (a) => (
      <span className="tabular-nums">{a.target_rp > 0 ? rp(a.target_rp) : <span className="text-muted-foreground">—</span>}</span>) },
    { id: "netto", header: "Realisasi faktur", align: "right", sortable: true, accessor: (a) => a.netto, cell: (a) => <span className="font-medium tabular-nums">{rp(a.netto)}</span> },
    { id: "capai", header: "Capaian", sortable: true, accessor: (a) => a.pacing.capai_pct ?? -1, cell: (a) => a.target_rp > 0 ? (
      <div className="w-36 space-y-1"><div className="flex justify-between text-xs"><span className="font-semibold tabular-nums">{persen(a.pacing.capai_pct)}</span><LabelPacing pacing={a.pacing} /></div>
        <BilahProgres pacing={a.pacing} /></div>) : <span className="text-muted-foreground text-xs">tanpa target</span> },
    ...(k.satuan_qty ? [{ id: "qty", header: `Qty (${k.satuan_qty})`, align: "right" as const, sortable: true, accessor: (a: BarisAm) => a.qty, cell: (a: BarisAm) => (
      <span className="tabular-nums">{angka(a.qty)}{a.target_qty != null ? <span className="text-muted-foreground"> / {angka(a.target_qty)}</span> : null}</span>) }] : []),
    { id: "so", header: "SO", align: "right", sortable: true, accessor: (a) => a.so_netto, cell: (a) => <span className="tabular-nums">{rp(a.so_netto)}</span> },
    { id: "ly", header: "Tahun lalu", align: "right", sortable: true, accessor: (a) => a.tahun_lalu, cell: (a) => <span className="text-muted-foreground tabular-nums">{rp(a.tahun_lalu)}</span> },
    { id: "faktur", header: "Faktur · Faskes", align: "right", accessor: (a) => a.faktur, cell: (a) => <span className="tabular-nums">{a.faktur} · {a.customer}</span> },
  ];

  const corong: { l: string; n: number; sub?: string }[] = [
    { l: "Lead", n: f.lead, sub: `${f.lead_dikonversi} jadi deal` },
    { l: "Deal", n: f.deal, sub: `${f.deal_menang} menang · terbuka ${rp(f.pipeline_terbuka)}` },
    { l: "Aktivitas", n: f.aktivitas, sub: "kunjungan ke deal ini" },
    { l: "Demo & Trial", n: f.demo_trial, sub: `${f.demo_positif} positif` },
    { l: "SO", n: f.so },
    { l: "Faktur", n: f.faktur },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[k.status])}>{k.status}</span>
            <span className="text-muted-foreground">{k.kode} · {periode(k)}{k.status === "berjalan" ? ` · hari ${r.pacing.hari_ke} dari ${r.pacing.hari_total}` : ""}</span>
          </div>
          {k.deskripsi && <p className="max-w-3xl text-sm">{k.deskripsi}</p>}
          <p className="text-muted-foreground text-xs">
            Cakupan: {[...k.brands.map((b) => `brand ${b}`), ...k.items.map((i) => i.nama ?? i.no ?? `item ${i.item_id}`)].join(" · ")} — jalur non-KSO.
            {" "}Data s/d {tgl(d.dihitung_sampai)}.
          </p>
        </div>
        {boleh && (
          <div className="flex gap-2">
            {k.dibatalkan
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setBatal(false)}>Aktifkan lagi</Button>
              : <>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm(
                    { title: `Batalkan ${k.kode}?`, description: "Kampanye tetap tersimpan dan bisa diaktifkan lagi.", destructive: true },
                    () => { void setBatal(true); })}>Batalkan</Button>
                  <Button size="sm" onClick={() => setUbah({ open: true, n: ubah.n + 1 })}>Ubah</Button>
                </>}
          </div>
        )}
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Kpi label="Realisasi faktur (netto)" nilai={rp(r.netto)} sub={`${r.faktur} faktur · ${r.customer} faskes`} />
        <Kpi label="Target" nilai={r.target_rp > 0 ? rp(r.target_rp) : "—"} sub={r.target_rp > 0 ? <>capaian <b>{persen(r.pacing.capai_pct)}</b></> : "belum ada target"} />
        <Kpi label="SO non-KSO" nilai={rp(r.so_netto)} sub={`${r.so} SO`} />
        {k.satuan_qty
          ? <Kpi label={`Qty (${k.satuan_qty})`} nilai={angka(r.qty)} sub={r.target_qty != null ? `target ${angka(r.target_qty)}` : "tanpa target qty"} />
          : <Kpi label="Faskes membeli" nilai={String(r.customer)} />}
        <Kpi label="Periode sama tahun lalu" nilai={r.tahun_lalu == null ? "—" : rp(r.tahun_lalu)}
          sub={r.tahun_lalu ? `${r.netto >= r.tahun_lalu ? "+" : ""}${persen(Math.round(((r.netto - r.tahun_lalu) / r.tahun_lalu) * 1000) / 10)}` : undefined} />
      </div>

      {r.target_rp > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span><b className="tabular-nums">{rp(r.netto)}</b> dari {rp(r.target_rp)}</span>
              <LabelPacing pacing={r.pacing} />
            </div>
            <BilahProgres pacing={r.pacing} />
            <p className="text-muted-foreground text-xs">Garis tegak = capaian yang diharapkan hari ini bila penjualan merata sepanjang periode.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Corong kampanye</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {corong.map((c) => (
              <div key={c.l} className="rounded-md border p-3">
                <div className="text-muted-foreground text-xs">{c.l}</div>
                <div className="text-xl font-bold tabular-nums">{c.n}</div>
                {c.sub && <div className="text-muted-foreground text-xs">{c.sub}</div>}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Lead, deal, dan demo dihitung bila brand-nya {d.brand_corong.length ? d.brand_corong.join(" / ") : "—"} dan dibuat dalam periode. Lead dari WhatsApp #LEADS belum membawa brand, jadi belum ikut terhitung.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Per AM</CardTitle></CardHeader>
        <CardContent>
          <DataTable columns={kolom} data={d.per_am} getKey={(a) => a.am_id || "tanpa"} searchPlaceholder="Cari AM…" pageSize={25}
            empty="Belum ada target maupun realisasi." />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Item terjual</CardTitle></CardHeader>
        <CardContent>
          {d.per_item.length === 0 ? <p className="text-muted-foreground text-sm">Belum ada faktur yang cocok.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left"><th className="py-1.5 font-medium">Item</th><th className="py-1.5 font-medium">Brand</th>
                <th className="py-1.5 text-right font-medium">Qty</th><th className="py-1.5 text-right font-medium">Netto</th></tr></thead>
              <tbody>
                {d.per_item.map((i) => (
                  <tr key={i.item_id} className="border-b last:border-0">
                    <td className="py-1.5">{i.nama}</td><td className="text-muted-foreground py-1.5">{i.brand ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{angka(i.qty)}</td><td className="py-1.5 text-right tabular-nums">{rp(i.netto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-muted-foreground mt-2 text-xs">25 item teratas menurut netto.</p>
        </CardContent>
      </Card>

      {boleh && (
        <KampanyeFormDialog key={ubah.n} open={ubah.open} onClose={() => setUbah({ ...ubah, open: false })} opsi={opsi}
          awal={{ kampanye: k, targets: d.per_am.filter((a) => a.am_id) }} />
      )}
      {dialog}
    </div>
  );
}
