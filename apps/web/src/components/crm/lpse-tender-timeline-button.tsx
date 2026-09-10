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

interface TimelineEntry {
  from_status: string;
  to_status: string;
  actor_name: string | null;
  note: string | null;
  at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pesan_masuk: "Pesan Masuk",
  barang_dikirim: "Barang Dikirim",
  selesai: "Selesai",
};

const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Timeline progres tender — sumbernya lpse_tender_status_log via endpoint
// GET /lpse-tender/:id (pola sama GaTicketTimelineButton F139, tanpa
// komentar/rating krn F20 tak punya keduanya).
export function LpseTenderTimelineButton({ tenderId, judul }: { tenderId: string; judul: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);

  async function load() {
    setEntries(null);
    try {
      const res = await fetch(`/api/lpse-tender/${tenderId}`);
      const data = await res.json();
      setEntries(res.ok ? (data.timeline ?? []) : []);
    } catch {
      setEntries([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger render={<Button size="icon-sm" variant="ghost" title="Timeline progres" />}>
        <History />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Timeline — {judul}</DialogTitle>
          <DialogDescription>Riwayat progres tender dari pesan masuk sampai sekarang.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {entries === null ? (
            <p className="text-muted-foreground text-sm">Memuat…</p>
          ) : entries.length === 0 ? (
            <EmptyState title="Belum ada riwayat" description="Tender baru dibuat, belum ada perubahan status." />
          ) : (
            <ul className="space-y-2">
              {entries.map((e, i) => (
                <li key={i} className="border-b pb-2 text-sm last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span>
                        <Badge variant="outline">{STATUS_LABEL[e.from_status] ?? e.from_status}</Badge>
                        {" → "}
                        <Badge variant="secondary">{STATUS_LABEL[e.to_status] ?? e.to_status}</Badge>
                      </span>
                      {e.note && <div className="text-muted-foreground text-xs">{e.note}</div>}
                      <div className="text-muted-foreground text-xs">{e.actor_name ?? "-"}</div>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">{fmt(e.at)}</span>
                  </div>
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
