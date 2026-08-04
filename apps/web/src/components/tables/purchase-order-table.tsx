"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type PurchaseOrderStatus = "ordered" | "partial_received" | "received" | "cancelled";

export interface PurchaseOrderRow {
  id: string;
  po_number: string;
  vendor_id: string | null;
  vendor_name: string;
  order_date: string;
  eta_date: string | null;
  cabang: string | null;
  pic: string | null;
  notes: string | null;
  cancelled_at: string | null;
  status: PurchaseOrderStatus;
  item_count: number;
  received_item_count: number;
}

interface ItemRow {
  id: string;
  item_desc: string;
  qty_ordered: number;
  unit: string | null;
  unit_price: number | null;
  notes: string | null;
  qty_received: number;
}

interface ReceiptRow {
  id: string;
  qty_received: number;
  received_date: string;
  received_by: string | null;
  condition_notes: string | null;
}

interface Detail extends PurchaseOrderRow {
  items: ItemRow[];
}

const today = () => new Date().toISOString().slice(0, 10);

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const isTelat = (r: Pick<PurchaseOrderRow, "status" | "eta_date">) =>
  (r.status === "ordered" || r.status === "partial_received") && !!r.eta_date && r.eta_date < today();

function StatusBadge({ row }: { row: Pick<PurchaseOrderRow, "status" | "eta_date"> }) {
  if (row.status === "cancelled") return <Badge variant="destructive">Dibatalkan</Badge>;
  if (row.status === "received") return <Badge className="bg-success/10 text-success">Diterima Penuh</Badge>;
  if (row.status === "partial_received") return <Badge className="bg-warning/10 text-warning">Sebagian Diterima</Badge>;
  if (isTelat(row)) return <Badge variant="destructive">Telat</Badge>;
  return <Badge variant="outline">Dipesan</Badge>;
}

function itemProgressLabel(it: ItemRow) {
  if (it.qty_received <= 0) return "Belum diterima";
  if (it.qty_received >= it.qty_ordered) return it.qty_received > it.qty_ordered ? "Melebihi qty order" : "Lengkap";
  return "Sebagian";
}

const columns: DataColumn<PurchaseOrderRow>[] = [
  { id: "po_number", header: "No. PO", sortable: true, accessor: (r) => r.po_number, cell: (r) => <span className="font-medium">{r.po_number}</span> },
  { id: "vendor_name", header: "Vendor", sortable: true, accessor: (r) => r.vendor_name },
  { id: "order_date", header: "Tgl Order", sortable: true, accessor: (r) => r.order_date, cell: (r) => <span className="whitespace-nowrap">{tgl(r.order_date)}</span> },
  {
    id: "eta_date",
    header: "ETA",
    sortable: true,
    accessor: (r) => r.eta_date ?? "",
    cell: (r) => <span className={`whitespace-nowrap ${isTelat(r) ? "text-destructive" : ""}`}>{r.eta_date ? tgl(r.eta_date) : "—"}</span>,
  },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
  {
    id: "items",
    header: "Barang",
    accessor: (r) => r.received_item_count,
    cell: (r) => <span className="text-muted-foreground tabular-nums">{r.received_item_count}/{r.item_count} lengkap</span>,
  },
  { id: "status", header: "Status", cell: (r) => <StatusBadge row={r} /> },
];

export function PurchaseOrderTable({ rows }: { rows: PurchaseOrderRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<PurchaseOrderRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState({ item_desc: "", qty_ordered: "", unit: "" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, ReceiptRow[]>>({});
  const [newReceipt, setNewReceipt] = useState({ qty_received: "", received_date: today(), received_by: "", condition_notes: "" });
  const { confirm, dialog } = useConfirm();

  function openDetail(r: PurchaseOrderRow) {
    setSel(r);
    setDetail(null);
    setDetailErr(false);
    setNewItem({ item_desc: "", qty_ordered: "", unit: "" });
    setExpanded(null);
    setReceipts({});
    reload(r.id);
  }

  function reload(id: string) {
    fetch(`/api/purchase-orders/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: Detail) => setDetail(d))
      .catch(() => setDetailErr(true));
  }

  function loadReceipts(itemId: string) {
    if (!sel) return;
    fetch(`/api/purchase-orders/${sel.id}/items/${itemId}/receipts`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: { rows: ReceiptRow[] }) => setReceipts((p) => ({ ...p, [itemId]: d.rows ?? [] })))
      .catch(() => {});
  }

  function toggleExpand(itemId: string) {
    const next = expanded === itemId ? null : itemId;
    setExpanded(next);
    setNewReceipt({ qty_received: "", received_date: today(), received_by: "", condition_notes: "" });
    if (next && !receipts[itemId]) loadReceipts(itemId);
  }

  async function addItem() {
    if (!sel || !newItem.item_desc.trim() || !newItem.qty_ordered) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/${sel.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_desc: newItem.item_desc.trim(),
          qty_ordered: Number(newItem.qty_ordered),
          unit: newItem.unit.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setNewItem({ item_desc: "", qty_ordered: "", unit: "" });
      reload(sel.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function removeItem(item: ItemRow) {
    if (!sel) return;
    confirm({ title: "Hapus barang?", description: `"${item.item_desc}" akan dihapus dari PO.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/purchase-orders/${sel.id}/items/${item.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        if (expanded === item.id) setExpanded(null);
        reload(sel.id);
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  async function addReceipt(itemId: string) {
    if (!sel || !newReceipt.qty_received) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/${sel.id}/items/${itemId}/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qty_received: Number(newReceipt.qty_received),
          received_date: newReceipt.received_date,
          received_by: newReceipt.received_by.trim() || undefined,
          condition_notes: newReceipt.condition_notes.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setNewReceipt({ qty_received: "", received_date: today(), received_by: "", condition_notes: "" });
      loadReceipts(itemId);
      reload(sel.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function removeReceipt(itemId: string, receipt: ReceiptRow) {
    if (!sel) return;
    confirm(
      { title: "Hapus catatan barang masuk?", description: `Penerimaan ${receipt.qty_received} pada ${tgl(receipt.received_date)} akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/purchase-orders/${sel.id}/items/${itemId}/receipts/${receipt.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error();
          loadReceipts(itemId);
          reload(sel.id);
          router.refresh();
        } finally {
          setBusy(false);
        }
      },
    );
  }

  async function toggleCancelled() {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/${sel.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancelled: (detail ?? sel).status !== "cancelled" }),
      });
      if (!res.ok) throw new Error();
      reload(sel.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function deletePurchaseOrder() {
    if (!sel) return;
    confirm(
      { title: "Hapus PO?", description: `PO "${sel.po_number}" akan dihapus. Tidak bisa dihapus jika sudah ada barang masuk tercatat.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/purchase-orders/${sel.id}`, { method: "DELETE" });
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
      <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari no. PO / vendor / cabang…" pageSize={25} onRowClick={openDetail} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">PO Tracker</div>
                <DialogTitle>{sel.po_number}</DialogTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{sel.vendor_name} · {tgl(sel.order_date)}</span>
                  <StatusBadge row={detail ?? sel} />
                </div>
              </DialogHeader>
              <DialogBody className="space-y-4 text-sm">
                {detailErr ? (
                  <div className="text-muted-foreground py-1 text-xs">Gagal memuat detail.</div>
                ) : !detail ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Memuat PO…
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">ETA</Label>
                        <div className={isTelat(detail) ? "text-destructive" : ""}>{detail.eta_date ? tgl(detail.eta_date) : "—"}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Cabang</Label>
                        <div>{detail.cabang ?? "—"}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">PIC</Label>
                        <div>{detail.pic ?? "—"}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Barang Dipesan</div>
                      <ul className="divide-border divide-y rounded-lg border">
                        {detail.items.map((it) => (
                          <li key={it.id} className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              <button type="button" onClick={() => toggleExpand(it.id)} className="text-muted-foreground mt-0.5 shrink-0" aria-label="Riwayat barang masuk">
                                {expanded === it.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                              </button>
                              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(it.id)}>
                                <div>{it.item_desc}</div>
                                <div className="text-muted-foreground text-xs tabular-nums">
                                  {it.qty_received}/{it.qty_ordered} {it.unit ?? ""} · {itemProgressLabel(it)}
                                </div>
                              </div>
                              <Button variant="ghost" size="icon-sm" aria-label="Hapus barang" disabled={busy} onClick={() => removeItem(it)} className="text-danger hover:text-danger">
                                <Trash2 />
                              </Button>
                            </div>
                            {expanded === it.id && (
                              <div className="mt-2 ml-6 space-y-2">
                                <ul className="divide-border divide-y rounded border">
                                  {(receipts[it.id] ?? []).map((rc) => (
                                    <li key={rc.id} className="flex items-start gap-3 px-2 py-1.5 text-xs">
                                      <div className="min-w-0 flex-1">
                                        <span className="tabular-nums font-medium">{rc.qty_received}</span> — {tgl(rc.received_date)}
                                        {rc.received_by ? ` · ${rc.received_by}` : ""}
                                        {rc.condition_notes ? <div className="text-muted-foreground">{rc.condition_notes}</div> : null}
                                      </div>
                                      <Button variant="ghost" size="icon-sm" aria-label="Hapus catatan" disabled={busy} onClick={() => removeReceipt(it.id, rc)} className="text-danger hover:text-danger">
                                        <Trash2 className="size-3.5" />
                                      </Button>
                                    </li>
                                  ))}
                                  {!(receipts[it.id] ?? []).length && <li className="text-muted-foreground px-2 py-1.5 text-xs">Belum ada barang masuk.</li>}
                                </ul>
                                <div className="grid grid-cols-[80px_1fr_1fr_auto] gap-2">
                                  <Input type="number" min="0" step="any" value={newReceipt.qty_received} onChange={(e) => setNewReceipt((p) => ({ ...p, qty_received: e.target.value }))} placeholder="Qty" />
                                  <Input type="date" value={newReceipt.received_date} onChange={(e) => setNewReceipt((p) => ({ ...p, received_date: e.target.value }))} />
                                  <Input value={newReceipt.received_by} onChange={(e) => setNewReceipt((p) => ({ ...p, received_by: e.target.value }))} placeholder="Diterima oleh" />
                                  <Button type="button" variant="outline" size="icon" disabled={busy || !newReceipt.qty_received} onClick={() => addReceipt(it.id)} aria-label="Catat barang masuk">
                                    <Plus />
                                  </Button>
                                </div>
                                <Input
                                  value={newReceipt.condition_notes}
                                  onChange={(e) => setNewReceipt((p) => ({ ...p, condition_notes: e.target.value }))}
                                  placeholder="Kondisi barang / catatan (opsional)"
                                />
                              </div>
                            )}
                          </li>
                        ))}
                        {detail.items.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">Belum ada barang.</li>}
                      </ul>
                      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
                        <Input value={newItem.item_desc} onChange={(e) => setNewItem((p) => ({ ...p, item_desc: e.target.value }))} placeholder="Tambah barang…" />
                        <Input type="number" min="0" step="any" value={newItem.qty_ordered} onChange={(e) => setNewItem((p) => ({ ...p, qty_ordered: e.target.value }))} placeholder="Qty" className="w-24" />
                        <Button type="button" variant="outline" size="icon" disabled={busy || !newItem.item_desc.trim() || !newItem.qty_ordered} onClick={addItem} aria-label="Tambah barang">
                          <Plus />
                        </Button>
                      </div>
                    </div>

                    {detail.notes && (
                      <div>
                        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Catatan</div>
                        <div>{detail.notes}</div>
                      </div>
                    )}
                  </>
                )}
              </DialogBody>
              <DialogFooter className="justify-between">
                <Button type="button" variant="ghost" disabled={busy} onClick={deletePurchaseOrder} className="text-danger hover:text-danger">
                  <Trash2 /> Hapus
                </Button>
                <Button type="button" variant={detail?.status === "cancelled" ? "default" : "outline"} disabled={busy} onClick={toggleCancelled}>
                  {detail?.status === "cancelled" ? "Batalkan Pembatalan" : "Batalkan PO"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
