"use client";

import { useState } from "react";
import { History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface HistoryEntry {
  kind: "assign" | "return" | "transfer";
  date: string;
  user_name: string | null;
  detail: string | null;
}

const KIND_LABEL: Record<HistoryEntry["kind"], string> = { assign: "Assign", return: "Return", transfer: "Transfer" };
const KIND_VARIANT: Record<HistoryEntry["kind"], "outline" | "secondary" | "destructive"> = { assign: "outline", return: "secondary", transfer: "outline" };

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export function GaAssetHistoryButton({ assetId, assetCode }: { assetId: string; assetCode: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  async function load() {
    setEntries(null);
    try {
      const res = await fetch(`/api/ga-assets/${assetId}/history`);
      const data = await res.json();
      setEntries(res.ok ? (data.history ?? []) : []);
    } catch {
      setEntries([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Riwayat assignment/transfer" />}>
        <History />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Riwayat — {assetCode}</DialogTitle>
          <DialogDescription>Gabungan assign/return/transfer, urut terbaru dulu.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {entries === null ? (
            <p className="text-muted-foreground text-sm">Memuat…</p>
          ) : entries.length === 0 ? (
            <EmptyState title="Belum ada riwayat" description="Aset ini belum pernah di-assign/transfer." />
          ) : (
            <ul className="space-y-2">
              {entries.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
                  <div>
                    <Badge variant={KIND_VARIANT[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
                    <div className="mt-1 text-sm">{e.user_name ?? "-"}</div>
                    {e.detail && <div className="text-muted-foreground text-xs">{e.detail}</div>}
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs">{fmtDate(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
