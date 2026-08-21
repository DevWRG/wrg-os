"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
}

interface ItemRow {
  id: string;
  label: string;
  is_checked: boolean;
  notes: string | null;
}

interface Detail extends InboundReceivingRow {
  items: ItemRow[];
}

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

function StatusBadge({ row }: { row: InboundReceivingRow }) {
  if (row.status === "completed") return <Badge className="bg-success/10 text-success">Selesai</Badge>;
  if (row.item_count > 0 && row.checked_count === row.item_count) return <Badge className="bg-warning/10 text-warning">Siap ditutup</Badge>;
  return <Badge variant="outline">Proses</Badge>;
}

const columns: DataColumn<InboundReceivingRow>[] = [
  { id: "vendor", header: "Supplier", sortable: true, accessor: (r) => r.vendor_name, cell: (r) => <span className="font-medium">{r.vendor_name}</span> },
  { id: "po", header: "PO / SJ", sortable: true, accessor: (r) => r.po_number ?? "", cell: (r) => r.po_number ?? "—" },
  {
    id: "received_date",
    header: "Tgl Terima",
    sortable: true,
    accessor: (r) => r.received_date,
    cell: (r) => <span className="whitespace-nowrap">{tgl(r.received_date)}</span>,
  },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
  {
    id: "checklist",
    header: "Checklist",
    cell: (r) => <span className="text-muted-foreground text-xs tabular-nums">{r.checked_count}/{r.item_count} tercentang</span>,
  },
  { id: "status", header: "Status", cell: (r) => <StatusBadge row={r} /> },
];

export function InboundReceivingTable({ rows }: { rows: InboundReceivingRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<InboundReceivingRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const { confirm, dialog } = useConfirm();

  function openDetail(r: InboundReceivingRow) {
    setSel(r);
    setDetail(null);
    setDetailErr(false);
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
    try {
      const res = await fetch(`/api/inbound-receiving/${sel.id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_checked: !item.is_checked }),
      });
      if (!res.ok) throw new Error();
      reload(sel.id);
      router.refresh();
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
    try {
      const res = await fetch(`/api/inbound-receiving/${sel.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
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
      <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari supplier / PO / cabang…" pageSize={25} onRowClick={openDetail} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Inbound Receiving</div>
                <DialogTitle>{sel.vendor_name}</DialogTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{tgl(sel.received_date)}{sel.po_number ? ` · ${sel.po_number}` : ""}</span>
                  <StatusBadge row={detail ?? sel} />
                </div>
              </DialogHeader>
              <DialogBody className="space-y-4 text-sm">
                {detailErr ? (
                  <div className="text-muted-foreground py-1 text-xs">Gagal memuat detail.</div>
                ) : !detail ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Memuat checklist…
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Checklist</div>
                      <ul className="divide-border divide-y rounded-lg border">
                        {detail.items.map((it) => (
                          <li key={it.id} className="flex items-start gap-3 px-3 py-2">
                            <Checkbox checked={it.is_checked} disabled={busy} onCheckedChange={() => toggleItem(it)} className="mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <div className={it.is_checked ? "line-through text-muted-foreground" : ""}>{it.label}</div>
                              {it.notes && <div className="text-muted-foreground text-xs">{it.notes}</div>}
                            </div>
                            <Button variant="ghost" size="icon-sm" aria-label="Hapus poin" disabled={busy} onClick={() => removeItem(it)} className="text-danger hover:text-danger">
                              <Trash2 />
                            </Button>
                          </li>
                        ))}
                        {detail.items.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">Belum ada poin checklist.</li>}
                      </ul>
                      <div className="mt-2 flex gap-2">
                        <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Tambah poin checklist…" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())} />
                        <Button type="button" variant="outline" size="icon" disabled={busy || !newLabel.trim()} onClick={addItem} aria-label="Tambah poin">
                          <Plus />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Diterima oleh</Label>
                        <div>{sel.received_by ?? "—"}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Cabang</Label>
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
              <DialogFooter className="justify-between">
                <Button type="button" variant="ghost" disabled={busy} onClick={deleteReceiving} className="text-danger hover:text-danger">
                  <Trash2 /> Hapus
                </Button>
                {sel.status === "in_progress" && (
                  <Button type="button" disabled={busy} onClick={markCompleted}>
                    Tandai Selesai
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
