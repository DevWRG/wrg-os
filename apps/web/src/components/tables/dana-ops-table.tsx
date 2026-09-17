"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";

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

export interface DanaOpsRow {
  id: string;
  cabang: string | null;
  requested_by: string;
  purpose: string;
  amount_requested: number;
  request_date: string;
  status: "in_progress" | "realized";
  notes: string | null;
  realized_at: string | null;
  amount_realized: number;
  item_count: number;
  variance: number;
}

interface ItemRow {
  id: string;
  description: string;
  amount: number;
  receipt_date: string;
  notes: string | null;
}

interface Detail extends DanaOpsRow {
  items: ItemRow[];
}

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

const rupiah = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function StatusBadge({ row }: { row: DanaOpsRow }) {
  if (row.status === "realized") return <Badge className="bg-success/10 text-success">Direalisasi</Badge>;
  return <Badge variant="outline">Berjalan</Badge>;
}

const columns: DataColumn<DanaOpsRow>[] = [
  { id: "requested_by", header: "Pemohon", sortable: true, accessor: (r) => r.requested_by, cell: (r) => <span className="font-medium">{r.requested_by}</span> },
  { id: "purpose", header: "Keperluan", sortable: true, accessor: (r) => r.purpose, cell: (r) => <span className="line-clamp-1">{r.purpose}</span> },
  {
    id: "request_date",
    header: "Tgl Ajuan",
    sortable: true,
    accessor: (r) => r.request_date,
    cell: (r) => <span className="whitespace-nowrap">{tgl(r.request_date)}</span>,
  },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
  { id: "amount_requested", header: "Diajukan", align: "right", sortable: true, accessor: (r) => r.amount_requested, cell: (r) => <span className="tabular-nums font-medium">{rupiah(r.amount_requested)}</span> },
  { id: "amount_realized", header: "Realisasi", align: "right", sortable: true, accessor: (r) => r.amount_realized, cell: (r) => <span className="text-muted-foreground tabular-nums">{rupiah(r.amount_realized)}</span> },
  { id: "status", header: "Status", cell: (r) => <StatusBadge row={r} /> },
];

export function DanaOpsTable({ rows }: { rows: DanaOpsRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<DanaOpsRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newItem, setNewItem] = useState({ description: "", amount: "", receipt_date: new Date().toISOString().slice(0, 10) });
  const [itemErr, setItemErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  function openDetail(r: DanaOpsRow) {
    setSel(r);
    setDetail(null);
    setDetailErr(false);
    setItemErr(null);
    setNewItem({ description: "", amount: "", receipt_date: new Date().toISOString().slice(0, 10) });
    reload(r.id);
  }

  function reload(id: string) {
    fetch(`/api/dana-ops/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: Detail) => setDetail(d))
      .catch(() => setDetailErr(true));
  }

  async function addItem() {
    if (!sel || !newItem.description.trim() || !newItem.amount) return;
    setBusy(true);
    setItemErr(null);
    try {
      const res = await fetch(`/api/dana-ops/${sel.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: newItem.description.trim(),
          amount: Number(newItem.amount),
          receipt_date: newItem.receipt_date,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Gagal menambah bukti realisasi");
      setNewItem({ description: "", amount: "", receipt_date: new Date().toISOString().slice(0, 10) });
      reload(sel.id);
      router.refresh();
    } catch (err) {
      setItemErr(err instanceof Error ? err.message : "Gagal menambah bukti realisasi");
    } finally {
      setBusy(false);
    }
  }

  function removeItem(item: ItemRow) {
    if (!sel) return;
    confirm({ title: "Hapus bukti realisasi?", description: `"${item.description}" akan dihapus.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/dana-ops/${sel.id}/items/${item.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        reload(sel.id);
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  async function markRealized() {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/dana-ops/${sel.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "realized" }),
      });
      if (!res.ok) throw new Error();
      reload(sel.id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // BUG-16 — backend (updateDanaOps) sudah dukung dua arah (realized_at
  // di-null-kan lagi saat balik in_progress), tapi sebelumnya tak ada tombol
  // ini di UI sehingga status "Direalisasi" tak bisa dibatalkan sama sekali.
  async function markInProgress() {
    if (!sel) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/dana-ops/${sel.id}`, {
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

  function deleteDanaOps() {
    if (!sel) return;
    confirm(
      { title: "Hapus pengajuan dana ops?", description: `Data "${sel.purpose}" dari ${sel.requested_by} akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/dana-ops/${sel.id}`, { method: "DELETE" });
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
      <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari pemohon / keperluan / cabang…" pageSize={25} onRowClick={openDetail} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Dana Ops</div>
                <DialogTitle>{sel.requested_by}</DialogTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{tgl(sel.request_date)} · {sel.purpose}</span>
                  <StatusBadge row={detail ?? sel} />
                </div>
              </DialogHeader>
              <DialogBody className="space-y-4 text-sm">
                {detailErr ? (
                  <div className="text-muted-foreground py-1 text-xs">Gagal memuat detail.</div>
                ) : !detail ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Memuat realisasi…
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Diajukan</Label>
                        <div className="tabular-nums font-medium">{rupiah(detail.amount_requested)}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Direalisasi</Label>
                        <div className="tabular-nums">{rupiah(detail.amount_realized)}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Selisih</Label>
                        <div className={`tabular-nums ${detail.variance !== 0 ? "text-warning" : ""}`}>{rupiah(detail.variance)}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Bukti Realisasi</div>
                      <ul className="divide-border divide-y rounded-lg border">
                        {detail.items.map((it) => (
                          <li key={it.id} className="flex items-start gap-3 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div>{it.description}</div>
                              <div className="text-muted-foreground text-xs">{tgl(it.receipt_date)}{it.notes ? ` · ${it.notes}` : ""}</div>
                            </div>
                            <div className="tabular-nums text-sm">{rupiah(it.amount)}</div>
                            <Button variant="ghost" size="icon-sm" aria-label="Hapus bukti" disabled={busy} onClick={() => removeItem(it)} className="text-danger hover:text-danger">
                              <Trash2 />
                            </Button>
                          </li>
                        ))}
                        {detail.items.length === 0 && <li className="text-muted-foreground px-3 py-2 text-xs">Belum ada bukti realisasi.</li>}
                      </ul>
                      <div className="mt-2 grid grid-cols-[1fr_auto_auto_auto] gap-2">
                        <Input value={newItem.description} onChange={(e) => setNewItem((p) => ({ ...p, description: e.target.value }))} placeholder="Keterangan pengeluaran…" />
                        <Input type="number" min="0" step="1" value={newItem.amount} onChange={(e) => setNewItem((p) => ({ ...p, amount: e.target.value }))} placeholder="Nominal" className="w-32" />
                        <Input type="date" value={newItem.receipt_date} onChange={(e) => setNewItem((p) => ({ ...p, receipt_date: e.target.value }))} className="w-40" />
                        <Button type="button" variant="outline" size="icon" disabled={busy || !newItem.description.trim() || !newItem.amount} onClick={addItem} aria-label="Tambah bukti">
                          <Plus />
                        </Button>
                      </div>
                      {itemErr && <p className="text-danger mt-1 text-xs">{itemErr}</p>}
                    </div>

                    {sel.notes && (
                      <div>
                        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Catatan</div>
                        <div>{sel.notes}</div>
                      </div>
                    )}
                  </>
                )}
              </DialogBody>
              <DialogFooter className="justify-between">
                <Button type="button" variant="ghost" disabled={busy} onClick={deleteDanaOps} className="text-danger hover:text-danger">
                  <Trash2 /> Hapus
                </Button>
                {(detail ?? sel).status === "in_progress" ? (
                  <Button type="button" disabled={busy} onClick={markRealized}>
                    Tandai Direalisasi
                  </Button>
                ) : (
                  <Button type="button" variant="outline" disabled={busy} onClick={markInProgress}>
                    Batalkan Realisasi
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
