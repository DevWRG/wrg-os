"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface TicketRow {
  id: string;
  complaint_text: string;
  status: string;
  needs_review?: boolean;
  assigned_teknisi_name?: string | null;
}

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Penugasan manual (uji E7, 13 Okt 2026): tiket "perlu review" dulu tak punya
// aksi lanjutan. Juga untuk mengganti teknisi tiket yang masih open.
function AssignTicketButton({ row }: { row: TicketRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [teknisi, setTeknisi] = useState<{ id: string; nama: string }[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perluReview = row.needs_review || !row.assigned_teknisi_name;

  useEffect(() => {
    if (!open || teknisi.length > 0) return;
    void fetch("/api/teknisi-capacity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setTeknisi(
          (d?.teknisi ?? [])
            .filter((t: { aktif?: boolean }) => t.aktif !== false)
            .map((t: { id: string; nama: string }) => ({ id: String(t.id), nama: String(t.nama) })),
        ),
      )
      .catch(() => {});
  }, [open, teknisi.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return setError("Pilih teknisi.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-tickets/${row.id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teknisi_id: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menugaskan");
      setOpen(false);
      setValue("");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setValue(""); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" variant={perluReview ? "default" : "outline"} title={perluReview ? "Tugaskan teknisi" : "Ganti teknisi"} />}>
        <UserCog /> {perluReview ? "Tugaskan" : "Ganti"}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{perluReview ? "Tugaskan teknisi" : "Ganti teknisi"}</DialogTitle>
          <DialogDescription>{row.complaint_text}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`st-tk-${row.id}`}>Teknisi</Label>
              <select id={`st-tk-${row.id}`} className={selectCls} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="" disabled>{teknisi.length === 0 ? "memuat roster…" : "pilih teknisi…"}</option>
                {teknisi.map((t) => <option key={t.id} value={t.id}>{t.nama}</option>)}
              </select>
              <p className="text-muted-foreground text-xs">Teknisi akan dikirimi WA ringkasan tiket; tanda &quot;perlu review&quot; dilepas.</p>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !value}>{busy ? "Menyimpan…" : "Tugaskan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TicketRowActions({ row }: { row: TicketRow }) {
  if (row.status === "resolved") return <Badge variant="secondary">Resolved</Badge>;
  return (
    <div className="flex justify-end gap-1.5">
      <AssignTicketButton row={row} />
      <ResolveTicketButton row={row} />
    </div>
  );
}

function ResolveTicketButton({ row }: { row: TicketRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-tickets/${row.id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setNote("");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setNote(""); setError(null); } }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <CheckCircle2 /> Tandai Selesai
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tandai ticket selesai</DialogTitle>
          <DialogDescription>{row.complaint_text}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`st-note-${row.id}`}>Catatan (opsional)</Label>
              <Textarea id={`st-note-${row.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="hasil penanganan…" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
