"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface TimelineEntry {
  kind: "status" | "comment";
  at: string;
  actor_name: string | null;
  from_status?: string;
  to_status?: string;
  note?: string;
  comment?: string;
  is_internal?: boolean;
}

const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Timeline progres (arahan Direktur) — union ga_ticket_status_log +
// ga_ticket_comments, sumbernya endpoint GET .../timeline (bukan cuma badge
// status terakhir) supaya reporter bisa lihat tiketnya lagi di tahap apa.
export function GaTicketTimelineButton({
  ticketId, ticketNo, status, rating,
}: { ticketId: string; ticketNo: string; status: string; rating: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [comment, setComment] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [ratingValue, setRatingValue] = useState("5");
  const [ratingComment, setRatingComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setEntries(null);
    try {
      const res = await fetch(`/api/ga-tickets/${ticketId}/timeline`);
      const data = await res.json();
      setEntries(res.ok ? (data.timeline ?? []) : []);
    } catch {
      setEntries([]);
    }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: comment.trim(), is_internal: isInternal }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan komentar");
      setComment("");
      await load();
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRating(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-tickets/${ticketId}/rate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: Number(ratingValue), comment: ratingComment.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal simpan rating");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const canRate = ["completed", "closed"].includes(status) && rating == null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="icon-sm" variant="ghost" title="Timeline & komentar" />}>
        <History />
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Timeline — {ticketNo}</DialogTitle>
          <DialogDescription>Riwayat progres tiket dari awal sampai sekarang.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {entries === null ? (
            <p className="text-muted-foreground text-sm">Memuat…</p>
          ) : entries.length === 0 ? (
            <EmptyState title="Belum ada riwayat" description="Tiket baru dibuka, belum ada perubahan status/komentar." />
          ) : (
            <ul className="space-y-2">
              {entries.map((e, i) => (
                <li key={i} className="border-b pb-2 text-sm last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      {e.kind === "status" ? (
                        <span>
                          Status <Badge variant="outline">{e.from_status}</Badge> → <Badge variant="secondary">{e.to_status}</Badge>
                        </span>
                      ) : (
                        <span>
                          {e.is_internal && <Badge variant="secondary" className="mr-1">Internal</Badge>}
                          {e.comment}
                        </span>
                      )}
                      <div className="text-muted-foreground text-xs">{e.actor_name ?? "-"}</div>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">{fmt(e.at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={submitComment} className="space-y-2 border-t pt-3">
            <Label htmlFor={`gt-comment-${ticketId}`}>Tambah komentar</Label>
            <Textarea id={`gt-comment-${ticketId}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Update progres, catatan, dst." />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={isInternal} onCheckedChange={(v: boolean) => setIsInternal(v)} />
                <Label className="text-muted-foreground text-xs">Internal (tak terlihat reporter)</Label>
              </div>
              <Button type="submit" size="sm" disabled={busy || !comment.trim()}>Kirim</Button>
            </div>
          </form>

          {canRate && (
            <form onSubmit={submitRating} className="space-y-2 border-t pt-3">
              <Label>Beri rating (1-5)</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRatingValue(String(n))} className="p-0.5">
                    <Star className={Number(ratingValue) >= n ? "fill-current text-yellow-500" : "text-muted-foreground"} />
                  </button>
                ))}
              </div>
              <Textarea value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} placeholder="Komentar rating, opsional" />
              <Button type="submit" size="sm" variant="outline" disabled={busy}>Kirim Rating</Button>
            </form>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
