"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingInline } from "@/components/ui/loading";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface InboundReceivingRow {
  id: string;
  vendor_id: string | null;
  vendor_name: string;
  po_number: string | null;
  received_date: string;
  cabang: string | null;
  received_by: string | null;
  status: "in_progress" | "completed";
  overall_notes: string | null;
  completed_at: string | null;
  checked_count: number;
  item_count: number;
  /** manual = diketik di WRG-OS (pra-206), accurate = Penerimaan Barang Accurate. */
  source: "manual" | "accurate";
  /** Nomor INBOUND Accurate (draft = "DFT.n [nomor]"). */
  accurate_number: string | null;
  /** Nomor surat jalan / DO vendor. */
  supplier_doc_number: string | null;
  accurate_status: string | null;
  synced_at: string | null;
}

interface LineRow {
  id: string;
  item_no: string | null;
  item_desc: string;
  qty: number;
  unit: string | null;
  warehouse_name: string | null;
  po_number: string | null;
  purchase_order_id: string | null;
  notes: string | null;
}

interface ItemRow {
  id: string;
  label: string;
  is_checked: boolean;
  notes: string | null;
}

interface Detail extends InboundReceivingRow {
  items: ItemRow[];
  lines: LineRow[];
}

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

// timestamptz::text dari Postgres ("2026-10-12 10:30:12.1+00") → jam WIB.
const tglJam = (s: string) => {
  const d = new Date(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
};

function StatusBadge({ row }: { row: InboundReceivingRow }) {
  if (row.status === "completed") return <Badge className="bg-success/10 text-success">Selesai</Badge>;
  if (row.item_count > 0 && row.checked_count === row.item_count) return <Badge className="bg-warning/10 text-warning">Siap ditutup</Badge>;
  return <Badge variant="outline">Proses</Badge>;
}

const columns: DataColumn<InboundReceivingRow>[] = [
  {
    id: "inbound",
    header: "No. Inbound",
    sortable: true,
    accessor: (r) => r.accurate_number ?? "",
    cell: (r) => <span className="font-medium whitespace-nowrap">{r.accurate_number ?? "—"}</span>,
  },
  { id: "vendor", header: "Supplier", sortable: true, accessor: (r) => r.vendor_name },
  { id: "po", header: "PO", sortable: true, accessor: (r) => r.po_number ?? "", cell: (r) => r.po_number ?? "—" },
  {
    id: "sj",
    header: "SJ Vendor",
    accessor: (r) => r.supplier_doc_number ?? "",
    cell: (r) => <span className="text-muted-foreground">{r.supplier_doc_number ?? "—"}</span>,
  },
  {
    id: "received_date",
    header: "Tgl Terima",
    sortable: true,
    accessor: (r) => r.received_date,
    cell: (r) => <span className="whitespace-nowrap">{tgl(r.received_date)}</span>,
  },
  { id: "cabang", header: "Gudang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
  {
    id: "checklist",
    header: "Checklist",
    cell: (r) => <span className="text-muted-foreground text-xs tabular-nums">{r.checked_count}/{r.item_count} tercentang</span>,
  },
  { id: "status", header: "Status", cell: (r) => <StatusBadge row={r} /> },
];

export function InboundReceivingTable({ rows, initialQuery }: { rows: InboundReceivingRow[]; initialQuery?: string }) {
  const router = useRouter();
  const [sel, setSel] = useState<InboundReceivingRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  function openDetail(r: InboundReceivingRow) {
    setSel(r);
    setDetail(null);
    setDetailErr(false);
    setActionErr(null);
    setNewLabel("");
    reload(r.id);
  }

  function reload(id: string) {
    fetch(`/api/inbound-receiving/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: Detail) => setDetail(d))
      .catch(() => setDetailErr(true));
  }

  async function toggleItem(item: ItemRow) {
    if (!sel) return;
    setBusy(true);
    setActionErr(null);
    try {
      const res = await fetch(`/api/inbound-receiving/${sel.id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_checked: !item.is_checked }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal mengubah checklist");
      reload(sel.id);
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Gagal mengubah checklist");
    } finally {
      setBusy(false);
    }
  }

  async function addItem() {
    if (!sel || !newLabel.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbound-receiving/${sel.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewLabel("");
      reload(sel.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function removeItem(item: ItemRow) {
    if (!sel) return;
    confirm({ title: "Hapus poin checklist?", description: `"${item.label}" akan dihapus.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/inbound-receiving/${sel.id}/items/${item.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        reload(sel.id);
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  async function markCompleted() {
    if (!sel) return;
    setBusy(true);
    setActionErr(null);
    try {
      const res = await fetch(`/api/inbound-receiving/${sel.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal menandai selesai");
      reload(sel.id);
      router.refresh();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Gagal menandai selesai");
    } finally {
      setBusy(false);
    }
  }

  // BUG-18 — backend (updateInboundReceiving) sudah izinkan balik ke
  // in_progress (guard BUG-05 di updateInboundReceivingItem eksplisit
  // menyuruh "kembalikan status ke in_progress dulu" utk bisa un-centang
  // checklist), tapi sebelumnya tak ada tombol ini di UI sama sekali.
  async function markInProgress() {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbound-receiving/${sel.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });
      if (!res.ok) throw new Error();
      reload(sel.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function deleteReceiving() {
    if (!sel) return;
    confirm(
      { title: "Hapus checklist penerimaan?", description: `Data dari "${sel.vendor_name}" akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/inbound-receiving/${sel.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error();
          setSel(null);
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    );
  }

  return (
    <>
      {dialog}
      <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari no. inbound / supplier / PO / SJ…" pageSize={25} onRowClick={openDetail} initialQuery={initialQuery} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Inbound Receiving</div>
                <DialogTitle>{sel.accurate_number ?? sel.vendor_name}</DialogTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {sel.accurate_number ? `${sel.vendor_name} · ` : ""}
                    {tgl(sel.received_date)}
                    {sel.supplier_doc_number ? ` · SJ ${sel.supplier_doc_number}` : sel.po_number ? ` · ${sel.po_number}` : ""}
                  </span>
                  <StatusBadge row={detail ?? sel} />
                </div>
              </DialogHeader>
              <DialogBody className="space-y-4 text-sm">
                {detailErr ? (
                  <div className="text-muted-foreground py-1 text-xs">Gagal memuat detail.</div>
                ) : !detail ? (
                  <LoadingInline label="Memuat checklist…" className="py-1 text-xs" />
                ) : (
                  <>
                    {detail.source === "accurate" && (
                      <div>
                        <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Barang Diterima (Accurate)</div>
                        <ul className="divide-border divide-y rounded-lg border">
                          {detail.lines.map((l) => (
                            <li key={l.id} className="px-3 py-2">
                              <div>
                                {l.item_no ? <span className="text-muted-foreground mr-1.5 text-xs">{l.item_no}</span> : null}
                                {l.item_desc}
                              </div>
                              <div className="text-muted-foreground text-xs tabular-nums">
                                {l.qty} {l.unit ?? ""}
                                {l.warehouse_name ? ` · ${l.warehouse_name}` : ""}
                                {l.po_number ? (
                                  <>
                                    {" · PO "}
                                    <Link href={`/purchase-orders?q=${encodeURIComponent(l.po_number)}`} className="text-primary underline">
                                      {l.po_number}
                                    </Link>
                                  </>
                                ) : null}
                              </div>
                              {l.notes && <div className="text-muted-foreground mt-0.5 text-xs whitespace-pre-line">{l.notes}</div>}
                            </li>
                          ))}
                          {detail.lines.length === 0 && (
                            <li className="text-muted-foreground px-3 py-2 text-xs">Baris barang belum tersinkron dari Accurate.</li>
                          )}
                        </ul>
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          Status Accurate: {detail.accurate_status ?? "—"}
                          {detail.synced_at ? ` · sinkron ${tglJam(detail.synced_at)}` : ""}. Barang, PO, dan gudang diubah di Accurate.
                        </p>
                      </div>
                    )}
                    <div>
                      <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Checklist Verifikasi</div>
                      <ul className="divide-border divide-y rounded-lg border">
                        {detail.items.map((it) => (
                          <li key={it.id} className="flex items-start gap-3 px-3 py-2">
                            <Checkbox checked={it.is_checked} disabled={busy} onCheckedChange={() => toggleItem(it)} className="mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className={it.is_checked ? "line-through text-muted-foreground" : ""}>{it.label}</div>
                              {it.notes && <div className="text-muted-foreground text-xs">{it.notes}</div>}
                            </div>
                            {detail.status !== "completed" && (
                              <Button variant="ghost" size="icon-sm" aria-label="Hapus poin" disabled={busy} onClick={() => removeItem(it)} className="text-danger hover:text-danger">
                                <Trash2 />
                              </Button>
                            )}
                          </li>
                        ))}
                        {detail.items.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">Belum ada poin checklist.</li>}
                      </ul>
                      {detail.status !== "completed" && (
                      <div className="mt-2 flex gap-2">
                        <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Tambah poin checklist…" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())} />
                        <Button type="button" variant="outline" size="icon" disabled={busy || !newLabel.trim()} onClick={addItem} aria-label="Tambah poin">
                          <Plus />
                        </Button>
                      </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Diterima oleh</Label>
                        <div>{sel.received_by ?? "—"}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{detail.source === "accurate" ? "Gudang" : "Cabang"}</Label>
                        <div>{sel.cabang ?? "—"}</div>
                      </div>
                    </div>
                    {sel.overall_notes && (
                      <div>
                        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Catatan</div>
                        <div>{sel.overall_notes}</div>
                      </div>
                    )}
                  </>
                )}
              </DialogBody>
              {actionErr && <p className="text-danger px-1 text-xs">{actionErr}</p>}
              <DialogFooter className="justify-between">
                {(detail ?? sel).source !== "accurate" ? (
                  <Button type="button" variant="ghost" disabled={busy} onClick={deleteReceiving} className="text-danger hover:text-danger">
                    <Trash2 /> Hapus
                  </Button>
                ) : (
                  <span />
                )}
                {(detail ?? sel).status === "in_progress" ? (
                  <Button type="button" disabled={busy} onClick={markCompleted}>
                    Tandai Selesai
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={busy} onClick={markInProgress}>
                    Kembalikan ke In Progress
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
