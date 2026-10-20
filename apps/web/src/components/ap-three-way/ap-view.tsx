"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";

import {
  BARIS_CLS, BARIS_LABEL, FAKTUR_CLS, FAKTUR_LABEL, rupiah, tglId,
  type BarisRow, type FakturDetail, type FakturRow, type ListData, type StatusFaktur,
} from "./types";

const ORDE: StatusFaktur[] = ["SELISIH", "BELUM_LENGKAP", "PARSIAL", "MATCH", "DRAFT", "DIABAIKAN"];

// F152 — daftar faktur + hasil match; klik baris = rincian per baris barang (faktur vs PO vs penerimaan).
export function ApView({ data }: { data: ListData }) {
  const [status, setStatus] = useState("");
  const [buka, setBuka] = useState<number | null>(null);
  const [view, setView] = useState({ items: data.items, total: data.total });
  const [memuat, setMemuat] = useState(false);
  const [errList, setErrList] = useState<string | null>(null);
  const per = data.ringkasan.per_status;

  // Chip hasil disaring di SERVER: kartu menghitung SEMUA faktur, tetapi halaman awal hanya memuat 500 terbaru,
  // jadi menyaring di klien akan menyembunyikan faktur lama yang ikut terhitung di kartu. `urut` membuang
  // respons basi bila chip diganti cepat (balapan).
  const urut = useRef(0);
  function pilihStatus(s: string) {
    const n = ++urut.current;
    setStatus(s);
    setErrList(null);
    if (!s) { setView({ items: data.items, total: data.total }); setMemuat(false); return; }
    setMemuat(true);
    fetch(`/api/ap-three-way?status=${encodeURIComponent(s)}&limit=500`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
        return j as ListData;
      })
      .then((j) => { if (n === urut.current) setView({ items: j.items, total: j.total }); })
      .catch((e) => { if (n === urut.current) setErrList((e as Error).message); })
      .finally(() => { if (n === urut.current) setMemuat(false); });
  }
  const rows = view.items;

  const kolom: DataColumn<FakturRow>[] = [
    { id: "faktur", header: "Faktur", sortable: true, accessor: (r) => r.bill_number ?? r.number, cell: (r) => (
      <div><div className="font-medium">{r.bill_number ?? r.number}</div><div className="text-muted-foreground text-xs">{tglId(r.trans_date)} · jatuh tempo {tglId(r.due_date)}</div></div>) },
    { id: "vendor", header: "Vendor", sortable: true, accessor: (r) => r.vendor_name },
    { id: "po", header: "PO / SJ vendor", accessor: (r) => [...r.po_numbers, ...r.supplier_docs].join(" "), cell: (r) => (
      <div className="text-xs"><div>{r.po_numbers.join(", ") || "—"}</div><div className="text-muted-foreground">{r.supplier_docs.join(", ") || "—"}</div></div>) },
    { id: "total", header: "Total", align: "right", sortable: true, searchable: false, accessor: (r) => Number(r.total_amount ?? 0), cell: (r) => <span className="tabular-nums">{rupiah(r.total_amount)}</span> },
    { id: "status", header: "Hasil", sortable: true, accessor: (r) => r.hasil.status, cell: (r) => (
      <div>
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", FAKTUR_CLS[r.hasil.status])}>{FAKTUR_LABEL[r.hasil.status]}</span>
        {r.hasil.status === "DRAFT" && r.hasil.status_baris && r.hasil.status_baris !== "MATCH" && (
          <div className="text-muted-foreground mt-0.5 text-xs">pratinjau: {BARIS_LABEL[r.hasil.status_baris]}</div>)}
      </div>) },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {ORDE.map((s) => (
          <button key={s} type="button" onClick={() => pilihStatus(status === s ? "" : s)}
            className={cn("bg-card rounded-lg border p-3 text-left shadow-[var(--shadow-card)]", status === s && "ring-primary ring-2")}>
            <div className="text-muted-foreground text-xs">{FAKTUR_LABEL[s]}</div>
            <div className="mt-1 text-xl font-bold tabular-nums">{per[s]}</div>
          </button>
        ))}
      </div>

      {data.terpotong && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Hasil dipotong di 5.000 faktur terbaru; persempit pencarian.</p>}
      {errList && <p className="text-sm text-rose-600">Gagal memuat filter: {errList}</p>}
      {memuat && <p className="text-muted-foreground text-xs">Memuat…</p>}
      {view.total > view.items.length && <p className="text-muted-foreground text-xs">Menampilkan {view.items.length} dari {view.total} faktur terbaru; pencarian hanya atas yang tampil.</p>}
      {data.sinkron && <p className="text-muted-foreground text-xs">Sinkron Accurate terakhir: {data.sinkron.last_synced_at ? new Date(data.sinkron.last_synced_at).toLocaleString("id-ID") : "—"}{data.sinkron.last_run_ok === false ? " — GAGAL, data mungkin basi" : ""}</p>}

      <Card><CardContent className="pt-6">
        <DataTable
          columns={kolom} data={rows} getKey={(r) => String(r.accurate_id)} pageSize={25}
          searchPlaceholder="Cari faktur / vendor / PO / SJ…" onRowClick={(r) => setBuka(r.accurate_id)}
          empty={data.total === 0 && !status ? "Belum ada faktur pembelian tersinkron. Nyalakan ACCURATE_PO_SYNC_ENABLED lalu tunggu sinkron." : "Tidak ada yang cocok dengan filter."}
          toolbar={<div className="flex gap-2">
            <FilterSelect label="Hasil" value={status} onChange={pilihStatus}
              options={ORDE.map((s) => ({ value: s, label: FAKTUR_LABEL[s] }))} />
            <Button size="sm" variant="outline" onClick={() => unduhCsv(rows)} disabled={rows.length === 0}>Ekspor CSV</Button>
          </div>}
        />
      </CardContent></Card>

      {buka !== null && <DetailDialog id={buka} onClose={() => setBuka(null)} />}
    </div>
  );
}

function DetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<FakturDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    fetch(`/api/ap-three-way/${id}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
        return j as FakturDetail;
      })
      .then((j) => { if (!batal) setD(j); })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? `Faktur ${d.bill_number ?? d.number} — ${d.vendor_name}` : "Faktur pembelian"}</DialogTitle>
          <DialogDescription>{d ? `${d.number} · ${tglId(d.trans_date)} · ${d.status_name ?? "—"} · ${d.approval_status ?? "—"}` : "Memuat…"}</DialogDescription>
        </DialogHeader>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        {d && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", FAKTUR_CLS[d.hasil.status])}>{FAKTUR_LABEL[d.hasil.status]}</span>
              {d.hasil.alasan && <span className="text-muted-foreground">{d.hasil.alasan}</span>}
              <span className="ml-auto tabular-nums">{rupiah(d.total_amount)}</span>
            </div>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left"><tr>
                  <th className="p-2">Barang</th><th className="p-2 text-right">Qty</th><th className="p-2">Satuan</th>
                  <th className="p-2 text-right">Harga</th><th className="p-2">Diskon</th><th className="p-2">PO / Penerimaan / SJ</th><th className="p-2">Hasil</th>
                </tr></thead>
                <tbody>{d.baris.map((b) => <BarisTr key={b.accurate_detail_id} b={b} />)}</tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BarisTr({ b }: { b: BarisRow }) {
  return (
    <tr className="border-t align-top">
      <td className="p-2"><div className="font-medium">{b.item_no ?? "—"}</div><div className="text-muted-foreground">{b.item_desc}</div></td>
      <td className="p-2 text-right tabular-nums">{b.qty}{Number(b.return_qty) > 0 && <div className="text-muted-foreground">retur {b.return_qty}</div>}</td>
      <td className="p-2">{b.unit_name ?? "—"}</td>
      <td className="p-2 text-right tabular-nums">{rupiah(b.unit_price)}</td>
      <td className="p-2">{b.disc_raw ? `${b.disc_raw}%` : "—"}{Number(b.disc_amount) > 0 && <div className="text-muted-foreground">{rupiah(b.disc_amount)}</div>}</td>
      <td className="p-2"><div>{b.po_number ?? "—"}</div><div className="text-muted-foreground">{b.receive_number ?? "—"}</div><div className="text-muted-foreground">SJ: {b.supplier_doc_number ?? "—"}</div></td>
      <td className="p-2">
        <span className={cn("rounded px-1.5 py-0.5 font-semibold", BARIS_CLS[b.status])}>{BARIS_LABEL[b.status]}</span>
        {b.temuan.filter((t) => t.status !== "MATCH").map((t, i) => <div key={i} className="text-muted-foreground mt-0.5">{t.pesan}</div>)}
      </td>
    </tr>
  );
}

// CSV: `sep=,` + BOM UTF-8 supaya Excel lokal membuka mulus (gotcha CLAUDE.md). Mengikuti filter chip hasil.
function unduhCsv(rows: FakturRow[]) {
  // Sel teks diawali = + - @ (atau tab/CR) dibaca Excel sebagai rumus → awali tanda petik agar tampil sebagai teks.
  const aman = (v: string | null) => (v != null && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const baris = rows.map((r) => [aman(r.bill_number), aman(r.number), aman(r.vendor_name), r.trans_date, r.due_date, r.total_amount, aman(r.po_numbers.join(" | ")), aman(r.supplier_docs.join(" | ")), FAKTUR_LABEL[r.hasil.status]].map(esc).join(","));
  const isi = `﻿sep=,\n${["Nomor faktur vendor", "Nomor Accurate", "Vendor", "Tanggal", "Jatuh tempo", "Total", "PO", "SJ vendor", "Hasil"].map(esc).join(",")}\n${baris.join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([isi], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `3-way-match-ap-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
